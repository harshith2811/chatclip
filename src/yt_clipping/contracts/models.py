"""
Typed Data Contracts for YouTube Clipping Platform.
Strict type annotations, serialization, validation, and immutability where required.
"""

from __future__ import annotations
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
import hashlib
import json


class RightsBasis(str, Enum):
    OWNED = "OWNED"
    EXPLICIT_PERMISSION = "EXPLICIT_PERMISSION"
    CREATIVE_COMMONS = "CREATIVE_COMMONS"
    VERIFIED_LICENSE = "VERIFIED_LICENSE"
    COMMENTARY_TRANSFORM = "COMMENTARY_TRANSFORM"
    OPERATOR_ASSET = "OPERATOR_ASSET"
    AI_GENERATED_ORIGINAL = "AI_GENERATED_ORIGINAL"


VERIFIABLE_RIGHTS_BASES = {
    RightsBasis.OWNED,
    RightsBasis.EXPLICIT_PERMISSION,
    RightsBasis.CREATIVE_COMMONS,
    RightsBasis.VERIFIED_LICENSE,
    RightsBasis.AI_GENERATED_ORIGINAL,
}


class RightsStatus(str, Enum):
    UNKNOWN = "UNKNOWN"
    VERIFIED = "VERIFIED"
    PENDING_REVIEW = "PENDING_REVIEW"
    REJECTED = "REJECTED"
    REVOKED = "REVOKED"
    EXPIRED = "EXPIRED"


class ComplianceProfile(str, Enum):
    STRICT_LICENSED = "STRICT_LICENSED"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    COMMENTARY_REVIEW = "COMMENTARY_REVIEW"


class PipelineState(str, Enum):
    DISCOVERED = "DISCOVERED"
    VALIDATING = "VALIDATING"
    BLOCKED = "BLOCKED"
    READY_FOR_PROCESSING = "READY_FOR_PROCESSING"
    PROCESSING = "PROCESSING"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    APPROVED = "APPROVED"
    READY_TO_PUBLISH = "READY_TO_PUBLISH"
    PUBLISHING = "PUBLISHING"
    PUBLISHED = "PUBLISHED"
    FAILED = "FAILED"
    REVOKED = "REVOKED"
    OUTCOME_UNKNOWN = "OUTCOME_UNKNOWN"


PIPELINE_TRANSITIONS: Dict[PipelineState, set] = {
    PipelineState.DISCOVERED: {PipelineState.VALIDATING, PipelineState.BLOCKED, PipelineState.REVOKED, PipelineState.FAILED},
    PipelineState.VALIDATING: {PipelineState.READY_FOR_PROCESSING, PipelineState.BLOCKED, PipelineState.REVIEW_REQUIRED, PipelineState.REVOKED, PipelineState.FAILED},
    PipelineState.BLOCKED: {PipelineState.VALIDATING, PipelineState.REVOKED},
    PipelineState.READY_FOR_PROCESSING: {PipelineState.PROCESSING, PipelineState.BLOCKED, PipelineState.REVOKED, PipelineState.FAILED},
    PipelineState.PROCESSING: {PipelineState.REVIEW_REQUIRED, PipelineState.APPROVED, PipelineState.BLOCKED, PipelineState.REVOKED, PipelineState.FAILED},
    PipelineState.REVIEW_REQUIRED: {PipelineState.APPROVED, PipelineState.BLOCKED, PipelineState.REVOKED, PipelineState.FAILED},
    PipelineState.APPROVED: {PipelineState.READY_TO_PUBLISH, PipelineState.REVIEW_REQUIRED, PipelineState.BLOCKED, PipelineState.REVOKED},
    PipelineState.READY_TO_PUBLISH: {PipelineState.PUBLISHING, PipelineState.BLOCKED, PipelineState.REVOKED, PipelineState.FAILED},
    PipelineState.PUBLISHING: {PipelineState.PUBLISHED, PipelineState.FAILED, PipelineState.OUTCOME_UNKNOWN, PipelineState.REVOKED},
    PipelineState.PUBLISHED: {PipelineState.REVOKED},
    PipelineState.OUTCOME_UNKNOWN: {PipelineState.PUBLISHED, PipelineState.FAILED, PipelineState.REVOKED},
    PipelineState.FAILED: {PipelineState.VALIDATING, PipelineState.READY_FOR_PROCESSING, PipelineState.REVOKED},
    PipelineState.REVOKED: set(),
}


class JobStage(str, Enum):
    DISCOVERED = "DISCOVERED"
    RIGHTS_CHECKED = "RIGHTS_CHECKED"
    ASSET_INGESTED = "ASSET_INGESTED"
    TRANSCRIBED = "TRANSCRIBED"
    SEGMENTED = "SEGMENTED"
    SCORED = "SCORED"
    REVIEWED = "REVIEWED"
    COMMENTARY_GENERATED = "COMMENTARY_GENERATED"
    RENDERED = "RENDERED"
    QA_VERIFIED = "QA_VERIFIED"
    HANDED_OFF = "HANDED_OFF"
    BLOCKED = "BLOCKED"
    REVOKED = "REVOKED"
    FAILED = "FAILED"


class JobStatus(str, Enum):
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    SUCCEEDED = "SUCCEEDED"
    BLOCKED = "BLOCKED"
    REVOKED = "REVOKED"
    OUTCOME_UNKNOWN = "OUTCOME_UNKNOWN"
    FAILED = "FAILED"
    RETRY_PENDING = "RETRY_PENDING"


@dataclass(frozen=True)
class CreatorSource:
    creator_id: str
    name: str
    channel_id: str
    channel_url: str
    baseline_views: float = 10000.0
    active: bool = True
    last_polled_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> CreatorSource:
        return cls(**data)


@dataclass
class VideoCandidate:
    video_id: str
    title: str
    url: str
    creator_id: str
    published_at: str
    retrieved_at: str
    duration_seconds: float
    view_count: int
    like_count: int = 0
    comment_count: int = 0
    discovery_score: float = 0.0
    rights_status: RightsStatus = RightsStatus.PENDING_REVIEW
    discovery_rationale: str = ""

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["rights_status"] = self.rights_status.value
        return d

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> VideoCandidate:
        data_copy = dict(data)
        if isinstance(data_copy.get("rights_status"), str):
            data_copy["rights_status"] = RightsStatus(data_copy["rights_status"])
        return cls(**data_copy)


@dataclass(frozen=True)
class MetricSnapshot:
    snapshot_id: str
    video_id: str
    timestamp: str
    view_count: int
    like_count: int = 0
    comment_count: int = 0
    calculated_velocity: float = 0.0  # views per hour since previous observation

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> MetricSnapshot:
        return cls(**data)


@dataclass
class RightsManifest:
    rights_id: str
    video_id: str
    basis: RightsBasis
    status: RightsStatus
    owner_name: str
    creator_id: str = ""
    license_id: str = ""
    license_url: str = ""
    proof_reference: str = ""
    evidence_type: str = ""
    permitted_platforms: List[str] = field(default_factory=lambda: ["YouTube Shorts", "TikTok", "Instagram Reels"])
    valid_until: Optional[str] = None  # ISO format string or None if indefinite
    verified_at: Optional[str] = None
    verified_by: str = ""
    revoked_at: Optional[str] = None
    revoked_by: str = ""
    revocation_reason: str = ""
    compliance_profile: str = ComplianceProfile.STRICT_LICENSED.value
    attribution_requirements: Dict[str, Any] = field(default_factory=dict)
    audit_notes: str = ""

    def effective_status(self, as_of: Optional[datetime] = None) -> RightsStatus:
        if self.revoked_at or self.status == RightsStatus.REVOKED:
            return RightsStatus.REVOKED
        if self.basis not in VERIFIABLE_RIGHTS_BASES:
            return RightsStatus.REJECTED if self.status == RightsStatus.REJECTED else RightsStatus.PENDING_REVIEW
        if self.valid_until and self.status == RightsStatus.VERIFIED:
            check_time = as_of or datetime.now(timezone.utc)
            try:
                dt = datetime.fromisoformat(self.valid_until.replace("Z", "+00:00"))
                if check_time > dt:
                    return RightsStatus.EXPIRED
            except ValueError:
                return RightsStatus.EXPIRED
        return self.status

    def is_valid(self, as_of: Optional[datetime] = None) -> bool:
        if self.revoked_at:
            return False
        if self.status != RightsStatus.VERIFIED:
            return False
        if self.basis not in VERIFIABLE_RIGHTS_BASES:
            return False
        if self.valid_until:
            check_time = as_of or datetime.now(timezone.utc)
            try:
                dt = datetime.fromisoformat(self.valid_until.replace("Z", "+00:00"))
                if check_time > dt:
                    return False
            except ValueError:
                return False
        return True

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["basis"] = self.basis.value
        d["status"] = self.status.value
        return d

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> RightsManifest:
        data_copy = {k: v for k, v in data.items() if k in cls.__dataclass_fields__}
        if isinstance(data_copy.get("basis"), str):
            data_copy["basis"] = RightsBasis(data_copy["basis"])
        if isinstance(data_copy.get("status"), str):
            data_copy["status"] = RightsStatus(data_copy["status"])
        return cls(**data_copy)


@dataclass
class LicenseMetadata:
    license_id: str = "youtube"  # e.g., "creativeCommon", "youtube", "unknown"
    license_name: str = "Standard YouTube License"
    license_url: str = ""
    license_version: str = ""
    embeddable: bool = True
    made_for_kids: bool = False
    privacy_status: str = "public"
    category_id: str = ""
    region_restrictions: Dict[str, Any] = field(default_factory=dict)
    source_url: str = ""
    creator_id: str = ""
    verified_at: Optional[str] = None
    verification_status: str = "UNVERIFIED"
    attribution_required: bool = True
    changes_notice_required: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> LicenseMetadata:
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class AttributionRequirements:
    creator_name: str
    creator_handle: str = ""
    creator_id: str = ""
    source_title: str = ""
    source_url: str = ""
    license_id: str = ""
    license_url: str = ""
    changes_made: str = ""
    required_credit_line: str = ""
    required_notices: List[str] = field(default_factory=list)
    validated: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> AttributionRequirements:
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class AudioRiskAssessment:
    assessment_id: str
    video_id: str
    clip_id: str = ""
    match_status: str = "UNABLE_TO_ANALYZE"  # DETECTED_MATCH | POSSIBLE_MATCH | NO_MATCH_DETECTED | UNABLE_TO_ANALYZE
    risk_level: str = "REVIEW_REQUIRED"      # HIGH | MEDIUM | LOW | REVIEW_REQUIRED
    flagged_segments: List[Dict[str, Any]] = field(default_factory=list)
    detected_tracks: List[Dict[str, Any]] = field(default_factory=list)
    review_required: bool = True
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[str] = None
    replacement_audio_path: Optional[str] = None
    disclaimer: str = "A missing match is not proof that the audio is copyright-free."
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> AudioRiskAssessment:
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class AssetManifest:
    """Canonical cross-service manifest shared between clipping engine and OmniPost."""
    asset_id: str
    source_id: str
    original_source_url: str
    creator_id: str
    license_metadata: LicenseMetadata = field(default_factory=LicenseMetadata)
    rights_basis: RightsBasis = RightsBasis.OPERATOR_ASSET
    rights_status: RightsStatus = RightsStatus.PENDING_REVIEW
    rights_id: str = ""
    evidence_references: List[str] = field(default_factory=list)
    compliance_profile: ComplianceProfile = ComplianceProfile.STRICT_LICENSED
    processing_history: List[Dict[str, Any]] = field(default_factory=list)
    transformation_history: List[Dict[str, Any]] = field(default_factory=list)
    attribution_requirements: Optional[AttributionRequirements] = None
    audio_risk: Optional[AudioRiskAssessment] = None
    approval_status: str = "PENDING_REVIEW"  # PENDING_REVIEW | APPROVED | REJECTED | REVOKED
    approved_by: Optional[str] = None
    approved_at: Optional[str] = None
    content_hash: str = ""
    generated_outputs: List[Dict[str, Any]] = field(default_factory=list)
    pipeline_state: PipelineState = PipelineState.DISCOVERED
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["rights_basis"] = self.rights_basis.value
        d["rights_status"] = self.rights_status.value
        d["compliance_profile"] = self.compliance_profile.value
        d["pipeline_state"] = self.pipeline_state.value
        return d

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> AssetManifest:
        d = {k: v for k, v in data.items() if k in cls.__dataclass_fields__}
        if isinstance(d.get("license_metadata"), dict):
            d["license_metadata"] = LicenseMetadata.from_dict(d["license_metadata"])
        if isinstance(d.get("rights_basis"), str):
            d["rights_basis"] = RightsBasis(d["rights_basis"])
        if isinstance(d.get("rights_status"), str):
            d["rights_status"] = RightsStatus(d["rights_status"])
        if isinstance(d.get("compliance_profile"), str):
            d["compliance_profile"] = ComplianceProfile(d["compliance_profile"])
        if isinstance(d.get("pipeline_state"), str):
            d["pipeline_state"] = PipelineState(d["pipeline_state"])
        if isinstance(d.get("attribution_requirements"), dict):
            d["attribution_requirements"] = AttributionRequirements.from_dict(d["attribution_requirements"])
        if isinstance(d.get("audio_risk"), dict):
            d["audio_risk"] = AudioRiskAssessment.from_dict(d["audio_risk"])
        return cls(**d)


@dataclass(frozen=True)
class WordTimestamp:
    word: str
    start: float
    end: float
    confidence: float = 1.0
    speaker_tag: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> WordTimestamp:
        return cls(**data)


@dataclass
class TranscriptSegment:
    segment_id: int
    start: float
    end: float
    text: str
    words: List[WordTimestamp] = field(default_factory=list)
    speaker_tag: Optional[str] = None

    def __post_init__(self):
        if isinstance(self.segment_id, str):
            import re
            digits = re.findall(r"\d+", self.segment_id)
            if digits:
                self.segment_id = int(digits[0])
            else:
                self.segment_id = abs(hash(self.segment_id)) % 1000000
        elif not isinstance(self.segment_id, int):
            try:
                self.segment_id = int(self.segment_id)
            except Exception:
                self.segment_id = 1

    def to_dict(self) -> Dict[str, Any]:
        return {
            "segment_id": int(self.segment_id),
            "start": self.start,
            "end": self.end,
            "text": self.text,
            "words": [w.to_dict() for w in self.words],
            "speaker_tag": self.speaker_tag,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> TranscriptSegment:
        words = [WordTimestamp.from_dict(w) for w in data.get("words", [])]
        raw_id = data.get("segment_id", 1)
        return cls(
            segment_id=raw_id,
            start=float(data["start"]),
            end=float(data["end"]),
            text=data["text"],
            words=words,
            speaker_tag=data.get("speaker_tag"),
        )


@dataclass
class Transcript:
    video_id: str
    language: str
    duration_seconds: float
    text: str
    segments: List[TranscriptSegment] = field(default_factory=list)
    provider: str = "faster-whisper"
    model_version: str = "base"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "video_id": self.video_id,
            "language": self.language,
            "duration_seconds": self.duration_seconds,
            "text": self.text,
            "segments": [s.to_dict() for s in self.segments],
            "provider": self.provider,
            "model_version": self.model_version,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> Transcript:
        segments = [TranscriptSegment.from_dict(s) for s in data.get("segments", [])]
        return cls(
            video_id=data["video_id"],
            language=data["language"],
            duration_seconds=data["duration_seconds"],
            text=data["text"],
            segments=segments,
            provider=data.get("provider", "faster-whisper"),
            model_version=data.get("model_version", "base"),
        )

    def get_all_words(self) -> List[WordTimestamp]:
        """Returns all word timestamps flattened across all segments in chronological order."""
        words: List[WordTimestamp] = []
        for s in self.segments:
            if s.words:
                words.extend(s.words)
        return words


@dataclass
class HeatmapPoint:
    start_time: float
    end_time: float
    value: float  # Normalized 0.0 to 1.0 viewer replay intensity

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> HeatmapPoint:
        return cls(**data)


@dataclass
class HeatmapPeak:
    peak_id: str
    start_time: float
    end_time: float
    center_time: float
    intensity: float  # 0.0 to 1.0 (local maximum height)
    prominence: float  # Topological prominence over baseline valleys
    width_seconds: float
    classification: str  # GLOBAL_MAXIMA, SPIKE_PAYOFF, SUSTAINED_ENGAGEMENT, RETENTION_VALLEY
    suggested_clip_start: float
    suggested_clip_end: float

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> HeatmapPeak:
        return cls(**data)


@dataclass
class HeatmapData:
    video_id: str
    source: str  # YOUTUBE_HEATMAP, COMMENT_DENSITY, AUDIO_ENERGY
    points: List[HeatmapPoint] = field(default_factory=list)
    peaks: List[HeatmapPeak] = field(default_factory=list)
    global_peak: Optional[HeatmapPeak] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "video_id": self.video_id,
            "source": self.source,
            "points": [p.to_dict() for p in self.points],
            "peaks": [pk.to_dict() for pk in self.peaks],
            "global_peak": self.global_peak.to_dict() if self.global_peak else None,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> HeatmapData:
        pts = [HeatmapPoint.from_dict(p) for p in data.get("points", [])]
        pks = [HeatmapPeak.from_dict(pk) for pk in data.get("peaks", [])]
        gpk = HeatmapPeak.from_dict(data["global_peak"]) if data.get("global_peak") else None
        return cls(video_id=data["video_id"], source=data["source"], points=pts, peaks=pks, global_peak=gpk)


@dataclass
class TrendReport:
    video_id: str
    title: str
    channel_id: str
    channel_title: str
    published_at: str
    view_count: int
    like_count: int
    comment_count: int
    view_velocity_per_hour: float
    channel_baseline_velocity: float
    velocity_multiplier: float
    like_ratio_pct: float
    comment_ratio_pct: float
    virality_index: float  # 0 to 100
    classification: str  # VIRAL_EXPLOSION, TRENDING_HIGH, ABOVE_AVERAGE, STEADY, UNDERPERFORMING
    rationale: str
    search_momentum_score: float = 50.0
    is_search_breakout: bool = False
    trending_search_queries: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> TrendReport:
        valid_keys = {f.name for f in fields(cls)}
        filtered = {k: v for k, v in data.items() if k in valid_keys}
        return cls(**filtered)


@dataclass
class ScoreBreakdown:
    hook_score: float = 0.0          # 0.0 to 10.0 (opening 3-5 seconds capture)
    moment_score: float = 0.0        # 0.0 to 10.0 (core payoff/insight)
    coherence_score: float = 0.0     # 0.0 to 10.0 (self-contained thought)
    pacing_score: float = 0.0        # 0.0 to 10.0 (cadence, filler control)
    audio_energy_score: float = 0.0  # 0.0 to 10.0 (measured acoustic volume/inflection)
    visual_score: float = 0.0        # 0.0 to 10.0 (crop legibility/framing clarity)
    heatmap_score: float = 0.0       # 0.0 to 10.0 (audience replay curve / retention hotspot)
    confidence: float = 0.8          # 0.0 to 1.0 (model confidence)
    rationale: str = ""

    def compute_composite_score(self) -> float:
        """
        Calculates a calibrated composite score (0 to 100).
        Dynamically incorporates heatmap/retention signals when available.
        """
        if self.heatmap_score > 0.0:
            weighted_sum = (
                self.hook_score * 2.5 +
                self.heatmap_score * 2.5 +
                self.moment_score * 2.0 +
                self.coherence_score * 1.5 +
                self.pacing_score * 1.0 +
                self.audio_energy_score * 0.5
            )
        else:
            weighted_sum = (
                self.hook_score * 3.0 +
                self.moment_score * 2.5 +
                self.coherence_score * 2.0 +
                self.pacing_score * 1.0 +
                self.audio_energy_score * 1.0 +
                self.visual_score * 0.5
            )
        return round(min(weighted_sum, 100.0), 2)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> ScoreBreakdown:
        return cls(**data)


@dataclass
class HighlightCandidate:
    candidate_id: str
    video_id: str
    start_seconds: float
    end_seconds: float
    duration_seconds: float
    score: float
    breakdown: ScoreBreakdown
    hook_title: str
    suggested_description: str = ""
    rationale: str = ""
    approval_status: str = "PENDING_APPROVAL"  # PENDING_APPROVAL, APPROVED, REJECTED
    transcript_text: str = ""
    loop_affinity_score: float = 0.0

    def validate_bounds(self, source_duration: float) -> bool:
        if self.start_seconds < 0.0:
            return False
        if self.end_seconds <= self.start_seconds:
            return False
        if self.end_seconds > source_duration + 0.5:  # small floating-point tolerance
            return False
        if abs(self.duration_seconds - (self.end_seconds - self.start_seconds)) > 0.05:
            return False
        return True

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["breakdown"] = self.breakdown.to_dict()
        return d

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> HighlightCandidate:
        data_copy = dict(data)
        data_copy.setdefault("loop_affinity_score", 0.0)
        if isinstance(data_copy.get("breakdown"), dict):
            data_copy["breakdown"] = ScoreBreakdown.from_dict(data_copy["breakdown"])
        return cls(**data_copy)


@dataclass
class RenderProfile:
    name: str = "vertical_9_16"
    width: int = 1080
    height: int = 1920
    aspect_ratio: str = "9:16"
    fps: int = 30
    vcodec: str = "libx264"
    acodec: str = "aac"
    crf: int = 22
    burn_subtitles: bool = True
    layout_mode: str = "blur_background"  # blur_background, crop_center, split_screen, active_speaker, auto
    subtitle_preset: str = "hormozi"      # hormozi, beast_bounce, neon_cyber, karaoke_gold, bold_social
    # Self-Contained CTA Overlay Engine
    enable_cta: bool = False
    cta_text: str = "Subscribe to this channel for more"
    cta_timing: str = "end"               # end, intro, persistent
    cta_style: str = "modern_pill"        # modern_pill, neon_banner, minimal
    cta_duration: float = 3.5
    cta_margin_bottom: int = 440
    # Dedicated Animated Outro Card & Bell Chime Engine
    enable_outro_card: bool = False
    outro_duration: float = 2.5
    outro_channel_name: Optional[str] = None
    outro_sub_heading: str = "Thanks for watching!"
    outro_prompt: str = "Turn on notifications for more clips!"
    enable_outro_chime: bool = True
    outro_chime_style: str = "soft_zen"   # soft_zen, soft_double, classic_bell
    # Pacing and Broadcast Polish
    enable_pacing_polish: bool = True
    enable_flux: bool = False              # Strategic FLUX creative visual asset generation (purged/disabled)
    audio_fade_in_seconds: float = 0.02   # 20ms anti-pop audio transition
    audio_fade_out_seconds: float = 0.25  # 250ms outro audio transition
    video_fade_in_seconds: float = 0.15   # 150ms subtle hook fade-in
    video_fade_out_seconds: float = 0.25  # 250ms outro video transition
    split_top_x: Optional[int] = None     # Dynamic centroid offset for top speaker in split_screen
    split_bot_x: Optional[int] = None     # Dynamic centroid offset for bottom speaker in split_screen
    fast_blur: bool = False               # High-efficiency bokeh pyramid downsampled blur (5x-8x faster rendering)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> RenderProfile:
        data_copy = dict(data)
        data_copy.setdefault("subtitle_preset", "hormozi")
        data_copy.setdefault("enable_cta", False)
        data_copy.setdefault("cta_text", "Subscribe to this channel for more")
        data_copy.setdefault("cta_timing", "end")
        data_copy.setdefault("cta_style", "modern_pill")
        data_copy.setdefault("cta_duration", 3.5)
        data_copy.setdefault("cta_margin_bottom", 440)
        data_copy.setdefault("enable_outro_card", False)
        data_copy.setdefault("outro_duration", 2.5)
        data_copy.setdefault("outro_channel_name", None)
        data_copy.setdefault("outro_sub_heading", "Thanks for watching!")
        data_copy.setdefault("outro_prompt", "Turn on notifications for more clips!")
        data_copy.setdefault("enable_outro_chime", True)
        data_copy.setdefault("outro_chime_style", "soft_zen")
        data_copy.setdefault("enable_pacing_polish", True)
        data_copy.setdefault("audio_fade_in_seconds", 0.02)
        data_copy.setdefault("audio_fade_out_seconds", 0.25)
        data_copy.setdefault("video_fade_in_seconds", 0.15)
        data_copy.setdefault("video_fade_out_seconds", 0.25)
        data_copy.setdefault("split_top_x", None)
        data_copy.setdefault("split_bot_x", None)
        data_copy.setdefault("fast_blur", False)
        return cls(**data_copy)


@dataclass
class QAReport:
    qa_id: str
    clip_id: str
    status: str  # PASSED, FAILED, WARNING
    video_stream_ok: bool
    audio_stream_ok: bool
    duration_ok: bool
    actual_duration: float
    expected_duration: float
    aspect_ratio_ok: bool
    actual_aspect_ratio: str
    file_size_bytes: int
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    checksum_sha256: str = ""
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> QAReport:
        return cls(**data)


@dataclass
class RenderedClip:
    clip_id: str
    job_id: str
    candidate_id: str
    file_path: str
    file_hash: str
    duration_seconds: float
    width: int
    height: int
    manifest_path: str
    rendered_at: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> RenderedClip:
        return cls(**data)


@dataclass
class HandoffReceipt:
    receipt_id: str
    clip_id: str
    idempotency_key: str
    status: str  # DELIVERED, DRY_RUN_SIMULATED, REJECTED, DUPLICATE_SKIPPED
    timestamp: str
    target_mode: str  # webhook, watched_folder
    dry_run: bool = True
    response_payload: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> HandoffReceipt:
        return cls(**data)


def compute_canonical_idempotency_key(
    video_id: str,
    start_seconds: float,
    end_seconds: float,
    rights_id: Optional[str] = None,
) -> str:
    """
    Computes a canonical SHA-256 idempotency key across all pipeline operations.
    Enforces 3-decimal fixed point rounding for deterministic repeatability.
    """
    rid = rights_id or "unspecified"
    raw = f"{video_id}:{start_seconds:.3f}:{end_seconds:.3f}:{rid}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


@dataclass
class ClipJob:
    job_id: str
    video_id: str
    current_stage: JobStage
    status: JobStatus
    retry_count: int = 0
    max_retries: int = 3
    rights_manifest: Optional[RightsManifest] = None
    asset_manifest: Optional[AssetManifest] = None
    source_metadata: Optional[Dict[str, Any]] = None
    candidate: Optional[HighlightCandidate] = None
    rendered_clip: Optional[RenderedClip] = None
    qa_report: Optional[QAReport] = None
    handoff_receipt: Optional[HandoffReceipt] = None
    checkpoints: Dict[str, Any] = field(default_factory=dict)
    error_message: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def record_checkpoint(self, stage: JobStage, data: Dict[str, Any]) -> None:
        self.current_stage = stage
        self.updated_at = datetime.now(timezone.utc).isoformat()
        self.checkpoints[stage.value] = {
            "timestamp": self.updated_at,
            "data": data,
        }

    def compute_idempotency_key(self) -> str:
        if not self.candidate:
            raw = f"{self.job_id}:{self.video_id}"
            return hashlib.sha256(raw.encode("utf-8")).hexdigest()
        rights_id = self.rights_manifest.rights_id if self.rights_manifest else None
        return compute_canonical_idempotency_key(
            video_id=self.video_id,
            start_seconds=self.candidate.start_seconds,
            end_seconds=self.candidate.end_seconds,
            rights_id=rights_id,
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "job_id": self.job_id,
            "video_id": self.video_id,
            "current_stage": self.current_stage.value,
            "status": self.status.value,
            "retry_count": self.retry_count,
            "max_retries": self.max_retries,
            "rights_manifest": self.rights_manifest.to_dict() if self.rights_manifest else None,
            "asset_manifest": self.asset_manifest.to_dict() if self.asset_manifest else None,
            "source_metadata": self.source_metadata,
            "candidate": self.candidate.to_dict() if self.candidate else None,
            "rendered_clip": self.rendered_clip.to_dict() if self.rendered_clip else None,
            "qa_report": self.qa_report.to_dict() if self.qa_report else None,
            "handoff_receipt": self.handoff_receipt.to_dict() if self.handoff_receipt else None,
            "checkpoints": self.checkpoints,
            "error_message": self.error_message,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> ClipJob:
        return cls(
            job_id=data["job_id"],
            video_id=data["video_id"],
            current_stage=JobStage(data["current_stage"]),
            status=JobStatus(data["status"]),
            retry_count=data.get("retry_count", 0),
            max_retries=data.get("max_retries", 3),
            rights_manifest=RightsManifest.from_dict(data["rights_manifest"]) if data.get("rights_manifest") else None,
            asset_manifest=AssetManifest.from_dict(data["asset_manifest"]) if data.get("asset_manifest") else None,
            source_metadata=data.get("source_metadata"),
            candidate=HighlightCandidate.from_dict(data["candidate"]) if data.get("candidate") else None,
            rendered_clip=RenderedClip.from_dict(data["rendered_clip"]) if data.get("rendered_clip") else None,
            qa_report=QAReport.from_dict(data["qa_report"]) if data.get("qa_report") else None,
            handoff_receipt=HandoffReceipt.from_dict(data["handoff_receipt"]) if data.get("handoff_receipt") else None,
            checkpoints=data.get("checkpoints", {}),
            error_message=data.get("error_message"),
            created_at=data.get("created_at", datetime.now(timezone.utc).isoformat()),
            updated_at=data.get("updated_at", datetime.now(timezone.utc).isoformat()),
        )
