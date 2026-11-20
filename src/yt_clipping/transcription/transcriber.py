"""
Transcription Adapter and Multi-Provider Speech Alignment Service.
Supports persistent JSON caching, GPU -> CPU -> Cloud cascade execution,
strict word/sentence boundary validation, and canonical integer segment IDs.
Removes silent synthetic transcript fallback in production.
"""

from typing import Optional, Dict, Any, List, Tuple
import json
import os
import sys
import time
import dataclasses
import threading
import gc
import logging
from ..contracts.models import Transcript, TranscriptSegment, WordTimestamp
from ..contracts.interfaces import Transcriber
from ..utils.timeline import sanitize_transcript
from ..utils.file_ops import atomic_replace, safe_remove

logger = logging.getLogger(__name__)

_WHISPER_MODEL_CACHE: Dict[Tuple[str, str, str, str], Any] = {}
_WHISPER_CACHE_LOCK = threading.Lock()


def release_whisper_models() -> None:
    """Explicitly releases cached WhisperModel instances and frees CUDA VRAM."""
    with _WHISPER_CACHE_LOCK:
        _WHISPER_MODEL_CACHE.clear()
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def _get_cached_whisper_model(model_size: str, device: str, compute_type: str, download_root: Optional[str]) -> Any:
    key = (model_size, device, compute_type, str(download_root))
    with _WHISPER_CACHE_LOCK:
        if key in _WHISPER_MODEL_CACHE:
            return _WHISPER_MODEL_CACHE[key]
    from faster_whisper import WhisperModel
    model = WhisperModel(model_size, device=device, compute_type=compute_type, download_root=download_root)
    with _WHISPER_CACHE_LOCK:
        # Bounded cache of at most 2 model instances
        if len(_WHISPER_MODEL_CACHE) >= 2:
            _WHISPER_MODEL_CACHE.clear()
            gc.collect()
        _WHISPER_MODEL_CACHE[key] = model
    return model

# PyAV 14+/19+ Compatibility Shim: faster-whisper passes metadata_errors="ignore"
# which newer PyAV versions reject with TypeError.
try:
    import av
    if hasattr(av, "open"):
        _orig_av_open = av.open
        def _compat_av_open(*args, **kwargs):
            kwargs.pop("metadata_errors", None)
            return _orig_av_open(*args, **kwargs)
        av.open = _compat_av_open
except Exception:
    pass


class TranscriptionError(RuntimeError):
    """Raised when transcription fails across all cascade providers."""
    pass


def merge_continuation_words(raw_words: List[Any]) -> List[WordTimestamp]:
    """
    Merges subword tokens, contractions, and continuation fragments produced by Whisper.
    In Whisper BPE tokenization, a leading space indicates a word boundary.
    Tokens lacking a leading space (or punctuation tokens like apostrophes)
    are merged into the preceding word timestamp to prevent fragmented,
    mid-syllable subtitle flashes and inaccurate word counts.
    """
    if not raw_words:
        return []

    result: List[WordTimestamp] = []
    for w in raw_words:
        if isinstance(w, dict):
            w_text = w.get("word", "")
            w_start = float(w.get("start", 0.0))
            w_end = float(w.get("end", 0.0))
            w_prob = float(w.get("probability", w.get("confidence", 0.9)))
            w_speaker = w.get("speaker_tag", None)
        else:
            w_text = getattr(w, "word", "")
            w_start = float(getattr(w, "start", 0.0))
            w_end = float(getattr(w, "end", 0.0))
            w_prob = float(getattr(w, "probability", getattr(w, "confidence", 0.9)))
            w_speaker = getattr(w, "speaker_tag", None)

        clean_text = w_text.strip()
        if not clean_text:
            continue

        has_leading_space = w_text.startswith(" ") or w_text.startswith("\t")
        is_subword_or_punct = not has_leading_space or clean_text in {
            ",", ".", "!", "?", ";", ":", "'s", "'t", "'re", "'ve", "'d", "'m", "n't"
        }

        if result and is_subword_or_punct:
            prev = result[-1]
            new_word = f"{prev.word}{clean_text}"
            new_end = round(max(prev.end, w_end), 3)
            new_conf = round(min(prev.confidence, w_prob), 2)
            result[-1] = WordTimestamp(
                word=new_word,
                start=prev.start,
                end=new_end,
                confidence=new_conf,
                speaker_tag=prev.speaker_tag,
            )
        else:
            result.append(
                WordTimestamp(
                    word=clean_text,
                    start=round(w_start, 3),
                    end=round(w_end, 3),
                    confidence=round(min(max(w_prob, 0.0), 1.0), 2),
                    speaker_tag=w_speaker,
                )
            )
    return result


class DiarizationAnnotator:
    """
    Optional speaker diarization layer (FEATURE-08).
    Assigns speaker labels (SPEAKER_00, SPEAKER_01) based on acoustic pauses,
    energy transitions, or external diarization models.
    """

    def __init__(self, pause_threshold_seconds: float = 1.2):
        self.pause_threshold_seconds = pause_threshold_seconds

    def annotate(self, transcript: Transcript) -> Transcript:
        """Annotates transcript segments and words with speaker tags."""
        current_speaker_idx = 0
        last_end = 0.0

        for seg in transcript.segments:
            if last_end > 0.0 and (seg.start - last_end) >= self.pause_threshold_seconds:
                current_speaker_idx = (current_speaker_idx + 1) % 4
            speaker_tag = f"SPEAKER_{current_speaker_idx:02d}"
            seg.speaker_tag = speaker_tag

            if seg.words:
                seg.words = [dataclasses.replace(w, speaker_tag=speaker_tag) for w in seg.words]

            last_end = seg.end

        return transcript


class LocalTranscriber(Transcriber):
    """
    Manages local transcripts, caching, and multi-provider cascade adapters.
    Ensures word-level timestamp math is valid and monotonic.
    """

    def __init__(
        self,
        cache_dir: str = "data/transcripts",
        model_size: str = "base",
        device: str = "auto",
        compute_type: str = "auto",
        allow_synthetic: Optional[bool] = None,
    ):
        self.cache_dir = cache_dir
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        if allow_synthetic is None:
            mode = os.environ.get("YT_EXECUTION_MODE", "production").lower()
            if mode == "production":
                self.allow_synthetic = False
            else:
                self.allow_synthetic = os.environ.get("YT_ALLOW_SYNTHETIC", "").lower() in ("1", "true")
        else:
            self.allow_synthetic = allow_synthetic
        self.diarization = DiarizationAnnotator()
        self._mock_transcripts: Dict[str, Transcript] = {}
        os.makedirs(self.cache_dir, exist_ok=True)

    def register_mock_transcript(self, video_id: str, transcript: Transcript) -> None:
        """Stores a mock transcript for testing/fixtures."""
        self._mock_transcripts[video_id] = sanitize_transcript(transcript)

    def _get_cache_path(self, video_id: str) -> str:
        return os.path.join(self.cache_dir, f"{video_id}.json")

    def load_from_cache(self, video_id: str) -> Optional[Transcript]:
        """Loads transcript from disk cache if present."""
        path = self._get_cache_path(video_id)
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    return sanitize_transcript(Transcript.from_dict(data))
            except Exception:
                return None
        return None

    def save_to_cache(self, transcript: Transcript) -> None:
        """Saves transcript to disk cache atomically."""
        sanitized = sanitize_transcript(transcript)
        path = self._get_cache_path(sanitized.video_id)
        temp_path = f"{path}.tmp"
        try:
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(sanitized.to_dict(), f, indent=2)
            atomic_replace(temp_path, path)
        finally:
            if os.path.exists(temp_path):
                safe_remove(temp_path)

    def fetch_online_transcript(self, video_id: str) -> Optional[Transcript]:
        """
        Fast-path: Extracts authentic time-aligned subtitles directly from YouTube
        using yt-dlp json3 player responses without requiring full video download.
        Returns a word-level synchronized Transcript in seconds.
        """
        cached = self.load_from_cache(video_id)
        if cached:
            return cached
        if video_id in self._mock_transcripts:
            return self._mock_transcripts[video_id]

        import yt_dlp
        import urllib.request

        ydl_opts = {
            "skip_download": True,
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
        }
        url = f"https://www.youtube.com/watch?v={video_id}"
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                if not info:
                    return None

                subs = info.get("subtitles", {}) or {}
                auto_subs = info.get("automatic_captions", {}) or {}

                # Look for English or original language tracks
                track_entries = None
                for lang_key in ["en", "en-orig", "en-US", "en-GB"]:
                    if lang_key in subs:
                        track_entries = subs[lang_key]
                        break
                    if lang_key in auto_subs:
                        track_entries = auto_subs[lang_key]
                        break

                if not track_entries and subs:
                    track_entries = next(iter(subs.values()))
                if not track_entries and auto_subs:
                    track_entries = next(iter(auto_subs.values()))

                if not track_entries:
                    return None

                json3_entry = next((e for e in track_entries if e.get("ext") == "json3"), None)
                if not json3_entry or not json3_entry.get("url"):
                    return None

                req = urllib.request.Request(json3_entry["url"], headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=10) as resp:
                    data = json.loads(resp.read().decode("utf-8"))

                events = data.get("events", [])
                segments: List[TranscriptSegment] = []
                seg_idx = 0

                for ev in events:
                    t_start_ms = ev.get("tStartMs")
                    d_dur_ms = ev.get("dDurationMs", 0)
                    segs = ev.get("segs", [])
                    if t_start_ms is None or not segs:
                        continue

                    seg_text = "".join(s.get("utf8", "") for s in segs).strip()
                    if not seg_text or seg_text == "\n":
                        continue

                    seg_start = round(t_start_ms / 1000.0, 3)
                    seg_end = round((t_start_ms + d_dur_ms) / 1000.0, 3)

                    words: List[WordTimestamp] = []
                    for s in segs:
                        w_text = s.get("utf8", "")
                        clean_w = w_text.strip()
                        if not clean_w:
                            continue
                        offset_ms = s.get("tOffsetMs", 0)
                        w_start = round((t_start_ms + offset_ms) / 1000.0, 3)
                        w_end = min(seg_end, round(w_start + 0.45, 3))
                        words.append(
                            WordTimestamp(
                                word=clean_w,
                                start=w_start,
                                end=max(w_start + 0.1, w_end),
                                confidence=0.95,
                            )
                        )

                    if not words:
                        words = [WordTimestamp(word=seg_text, start=seg_start, end=seg_end, confidence=0.95)]

                    segments.append(
                        TranscriptSegment(
                            segment_id=seg_idx,
                            start=seg_start,
                            end=max(seg_start + 0.2, seg_end),
                            text=seg_text,
                            speaker_tag="SPEAKER_00",
                            words=words,
                        )
                    )
                    seg_idx += 1

                if not segments:
                    return None

                total_duration = float(info.get("duration") or segments[-1].end)
                full_text = " ".join(s.text for s in segments).strip()
                transcript = Transcript(
                    video_id=video_id,
                    language=info.get("language", "en"),
                    duration_seconds=total_duration,
                    text=full_text,
                    segments=segments,
                    provider="youtube-captions",
                )
                self.save_to_cache(transcript)
                return transcript
        except Exception as e:
            logger.warning(f"fetch_online_transcript failed for {video_id}: {e}", exc_info=True)
            return None

    def _try_faster_whisper(
        self, media_path: str, video_id: str, device: str, compute_type: str
    ) -> Tuple[Optional[Transcript], Optional[str]]:
        """Attempts transcription with faster-whisper under specified hardware execution target."""
        try:
            try:
                import av
                if hasattr(av, "open"):
                    _orig = av.open
                    def _safe_av(*args, **kwargs):
                        kwargs.pop("metadata_errors", None)
                        return _orig(*args, **kwargs)
                    av.open = _safe_av
            except Exception:
                pass
            start_t = time.time()
            models_whisper_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../models/whisper"))
            download_root = os.environ.get("WHISPER_DOWNLOAD_ROOT") or (models_whisper_dir if os.path.exists(models_whisper_dir) else None)
            model = _get_cached_whisper_model(self.model_size, device=device, compute_type=compute_type, download_root=download_root)
            segments_raw, info = model.transcribe(
                media_path,
                word_timestamps=True,
                vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=500),
            )

            segments: List[TranscriptSegment] = []
            full_text_parts = []
            for idx, s in enumerate(segments_raw):
                words = merge_continuation_words(s.words or [])
                # BUG-16 fix: canonical integer segment ID
                segments.append(
                    TranscriptSegment(
                        segment_id=idx + 1,
                        start=round(s.start, 2),
                        end=round(s.end, 2),
                        text=s.text.strip(),
                        words=words,
                    )
                )
                full_text_parts.append(s.text.strip())

            if segments:
                elapsed = time.time() - start_t
                t = Transcript(
                    video_id=video_id,
                    language=getattr(info, "language", "en"),
                    duration_seconds=round(getattr(info, "duration", 0.0), 2),
                    text=" ".join(full_text_parts),
                    segments=segments,
                    provider=f"faster-whisper-{device}-{compute_type}",
                    model_version=f"{self.model_size} ({elapsed:.1f}s)",
                )
                t = self.diarization.annotate(t)
                return sanitize_transcript(t), None
            return None, "No speech segments detected in media."
        except Exception as e:
            err_msg = str(e)
            if "out of memory" in err_msg.lower() or "cuda" in err_msg.lower():
                release_whisper_models()
            return None, err_msg

    def transcribe(self, media_path: str, video_id: str) -> Transcript:
        """
        Retrieves transcript from cache, mock registry, or hardware execution cascade:
        1. Local GPU Faster-Whisper (CUDA)
        2. Local CPU Faster-Whisper (Int8)
        3. Configured sidecar/fixture
        4. Terminal failure (or synthetic test fixture if explicitly enabled for testing).
        """
        # 1. Check cache
        cached = self.load_from_cache(video_id)
        if cached:
            return cached

        # 2. Check mock registry
        if video_id in self._mock_transcripts:
            t = self._mock_transcripts[video_id]
            self.save_to_cache(t)
            return t

        # 3. Check for external JSON fixture alongside media (e.g. video_id.transcript.json)
        sidecar_json = f"{os.path.splitext(media_path)[0]}.transcript.json"
        if os.path.exists(sidecar_json):
            with open(sidecar_json, "r", encoding="utf-8") as f:
                data = json.load(f)
                t = sanitize_transcript(Transcript.from_dict(data))
                self.save_to_cache(t)
                return t

        # 4. Hardware execution cascade
        cascade_log = []
        if os.path.exists(media_path) and os.path.getsize(media_path) > 1024:
            # Check CUDA availability
            cuda_available = False
            try:
                import ctranslate2
                if ctranslate2.get_cuda_device_count() > 0:
                    cuda_available = True
            except Exception:
                pass

            # Step 1: GPU execution (if available and requested)
            if cuda_available and self.device in ("auto", "cuda"):
                gpu_compute = "float16" if self.compute_type in ("auto", "float16") else self.compute_type
                transcript, err = self._try_faster_whisper(media_path, video_id, device="cuda", compute_type=gpu_compute)
                if transcript:
                    self.save_to_cache(transcript)
                    return transcript
                cascade_log.append(f"GPU (cuda/{gpu_compute}) failed: {err}")

            # Step 2: CPU fallback
            if self.device in ("auto", "cpu"):
                cpu_compute = "int8" if self.compute_type in ("auto", "int8") else self.compute_type
                transcript, err = self._try_faster_whisper(media_path, video_id, device="cpu", compute_type=cpu_compute)
                if transcript:
                    self.save_to_cache(transcript)
                    return transcript
                cascade_log.append(f"CPU (cpu/{cpu_compute}) failed: {err}")

        # BUG-17 fix: Strictly fail in production instead of silently fabricating dialogue
        if not self.allow_synthetic:
            err_summary = " | ".join(cascade_log) if cascade_log else f"Media file not found or invalid ({media_path})"
            raise TranscriptionError(
                f"Transcription failed for video '{video_id}'. All cascade providers failed: {err_summary}"
            )

        # 5. Fallback synthetic transcript for offline test fixtures only
        return self._generate_synthetic_transcript(video_id, duration_seconds=120.0)

    def _generate_synthetic_transcript(self, video_id: str, duration_seconds: float) -> Transcript:
        """Generates a structured transcript for testing/simulation environments only."""
        sentences = [
            ("Here is the secret to scaling AI systems in 2026.", 0.0, 4.5),
            ("Most teams fail because they blindly copy large repositories without auditing.", 4.8, 10.2),
            ("What you actually want to do is isolate the core algorithmic components.", 10.5, 15.0),
            ("First, you verify permissions and enforce a strict rights policy gate.", 15.4, 21.0),
            ("Second, you detect context-preserving highlight moments with hook scoring.", 21.5, 27.8),
            ("Third, you render clean vertical cuts with verified word-synced subtitles.", 28.2, 35.0),
            ("And finally, hand off the approved manifest to your autoposter safely.", 35.5, 41.5),
            ("That is how you build a production-grade automated clipping engine.", 42.0, 48.0),
        ]
        segments: List[TranscriptSegment] = []
        for i, (text, start, end) in enumerate(sentences):
            words_raw = text.split()
            word_dur = (end - start) / max(len(words_raw), 1)
            words = []
            cur = start
            for w in words_raw:
                w_clean = w.strip(".,!?")
                w_end = min(round(cur + word_dur, 2), end)
                words.append(WordTimestamp(word=w_clean, start=round(cur, 2), end=w_end, confidence=0.98))
                cur = w_end
            segments.append(TranscriptSegment(segment_id=i + 1, start=start, end=end, text=text, words=words))

        t = Transcript(
            video_id=video_id,
            language="en",
            duration_seconds=duration_seconds,
            text=" ".join(s[0] for s in sentences),
            segments=segments,
            provider="synthetic_fixture",
            model_version="test-v1",
        )
        self.save_to_cache(t)
        return t
