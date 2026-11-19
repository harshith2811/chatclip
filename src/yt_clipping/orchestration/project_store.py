"""
Durable Project and Clip Sidecar Storage Service.
Provides atomic disk persistence, project lifecycle tracking, clip sidecars with full AI intelligence,
automatic reconciliation across restarts, and backward compatibility with data/rendered_clips.
"""

from __future__ import annotations
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
import os
import json
import logging
import hashlib
import glob
import re
import shutil

from ..discovery.video_metadata import EnrichedVideoInfo
from ..scoring.caption_synthesizer import ShortCaptionPackage, ClipIntelligence

logger = logging.getLogger(__name__)


def sanitize_filesystem_name(name: str, max_length: int = 40) -> str:
    """Produces clean, alphanumeric filesystem names without spaces, emojis, or illegal symbols."""
    if not name:
        return "video"
    cleaned = re.sub(r"[^\w\s-]", "", name)
    cleaned = re.sub(r"[\s-]+", "_", cleaned).strip("_")
    return cleaned[:max_length] if cleaned else "video"


@dataclass
class ClipSidecarRecord:
    """
    Comprehensive persistent sidecar record for an exported vertical Short.
    Saved atomically as clip_<id>.json beside the MP4.
    """
    clip_id: str
    project_id: str
    video_id: str
    file_path: str
    relative_url: str
    start_seconds: float
    end_seconds: float
    duration_seconds: float
    score: float
    candidate_data: Dict[str, Any] = field(default_factory=dict)
    source_metadata: Dict[str, Any] = field(default_factory=dict)
    intelligence: Dict[str, Any] = field(default_factory=dict)
    caption_package: Dict[str, Any] = field(default_factory=dict)
    render_settings: Dict[str, Any] = field(default_factory=dict)
    file_size_bytes: int = 0
    file_hash: str = ""
    render_timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    qa_report: Optional[Dict[str, Any]] = None
    status: str = "COMPLETED"
    error_details: Optional[str] = None
    thumbnail_path: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> ClipSidecarRecord:
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class ProjectRecord:
    """
    Persistent project descriptor tracking source video metadata and exported clips.
    """
    project_id: str
    video_id: str
    title: str
    canonical_url: str
    source_metadata: Dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    clips_count: int = 0
    status: str = "ACTIVE"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> ProjectRecord:
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


class ProjectStore:
    """
    Manages persistent filesystem storage for projects, sidecar JSONs, and media assets.
    Guarantees atomic file writes and crash resilience.
    """

    def __init__(self, base_data_dir: str = "data"):
        self.base_data_dir = os.path.abspath(base_data_dir)
        self.projects_dir = os.path.join(self.base_data_dir, "projects")
        self.rendered_clips_dir = os.path.join(self.base_data_dir, "rendered_clips")
        os.makedirs(self.projects_dir, exist_ok=True)
        os.makedirs(self.rendered_clips_dir, exist_ok=True)

    def get_project_dir(self, identifier: str, title: Optional[str] = None) -> str:
        """
        Resolves or creates the structured project folder:
        data/projects/{Clean_Title}_{video_id}
        Matches existing directories by video_id, clean name, or title.
        """
        clean_id = identifier.replace("project_", "").replace("proj_", "")

        # 1. Check if an existing directory matches this video_id
        if os.path.exists(self.projects_dir):
            for d in os.listdir(self.projects_dir):
                full_d = os.path.join(self.projects_dir, d)
                if not os.path.isdir(full_d):
                    continue
                if d == identifier or d == clean_id or d == f"proj_{clean_id}" or d.endswith(f"_{clean_id}") or f"_{clean_id}_" in d:
                    os.makedirs(os.path.join(full_d, "clips"), exist_ok=True)
                    return full_d

        # 2. If new directory, construct structured folder name: {clean_title}_{clean_id}
        folder_title = sanitize_filesystem_name(title) if title else "Project"
        folder_name = f"{folder_title}_{clean_id}"
        pdir = os.path.join(self.projects_dir, folder_name)
        os.makedirs(pdir, exist_ok=True)
        os.makedirs(os.path.join(pdir, "clips"), exist_ok=True)
        return pdir

    def create_or_get_project(
        self,
        video_id: str,
        source_metadata: Optional[EnrichedVideoInfo] = None,
    ) -> ProjectRecord:
        """Finds an existing project for a video_id or instantiates a new one."""
        clean_vid = video_id.replace("project_", "").replace("proj_", "")
        title = source_metadata.title if source_metadata else f"Project {clean_vid}"
        project_dir = self.get_project_dir(clean_vid, title=title)
        project_path = os.path.join(project_dir, "project.json")

        if os.path.exists(project_path):
            try:
                with open(project_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return ProjectRecord.from_dict(data)
            except Exception as e:
                logger.warning(f"Corrupted project file {project_path}: {e}. Rebuilding...")

        canonical_url = (
            source_metadata.canonical_url
            if source_metadata
            else f"https://www.youtube.com/watch?v={clean_vid}"
        )
        meta_dict = source_metadata.to_dict() if source_metadata else {"video_id": clean_vid}

        proj = ProjectRecord(
            project_id=f"proj_{clean_vid}",
            video_id=clean_vid,
            title=title,
            canonical_url=canonical_url,
            source_metadata=meta_dict,
        )
        self.save_project(proj)

        # Link source video from data/assets if present
        assets_dir = os.path.join(self.base_data_dir, "assets")
        src_asset = os.path.join(assets_dir, f"{clean_vid}.mp4")
        proj_source = os.path.join(project_dir, "source.mp4")
        if os.path.exists(src_asset) and not os.path.exists(proj_source):
            try:
                try:
                    os.link(src_asset, proj_source)
                except Exception:
                    shutil.copyfile(src_asset, proj_source)
            except Exception:
                pass

        return proj

    def save_project(self, project: ProjectRecord) -> None:
        """Atomically persists project.json."""
        project.updated_at = datetime.now(timezone.utc).isoformat()
        pdir = self.get_project_dir(project.video_id or project.project_id, title=project.title)
        path = os.path.join(pdir, "project.json")
        self._write_json_atomic(path, project.to_dict())

    def get_project(self, project_id: str) -> Optional[ProjectRecord]:
        """Loads a project record from disk, matching direct, titled, or prefixed project directories."""
        clean_id = project_id.replace("project_", "").replace("proj_", "")

        # Try resolving directory directly
        pdir = self.get_project_dir(clean_id)
        path = os.path.join(pdir, "project.json")
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return ProjectRecord.from_dict(json.load(f))
            except Exception as e:
                logger.error(f"Failed to read project {path}: {e}")

        # Fallback candidate search
        if os.path.exists(self.projects_dir):
            for d in os.listdir(self.projects_dir):
                if d == project_id or d == clean_id or d.endswith(f"_{clean_id}"):
                    cpath = os.path.join(self.projects_dir, d, "project.json")
                    if os.path.exists(cpath):
                        try:
                            with open(cpath, "r", encoding="utf-8") as f:
                                return ProjectRecord.from_dict(json.load(f))
                        except Exception:
                            pass
        return None

    def list_projects(self) -> List[ProjectRecord]:
        """Lists all projects ordered by most recent update."""
        projects = []
        if not os.path.exists(self.projects_dir):
            return []

        for d in os.listdir(self.projects_dir):
            pdir = os.path.join(self.projects_dir, d)
            if not os.path.isdir(pdir):
                continue
            proj_file = os.path.join(pdir, "project.json")
            if os.path.exists(proj_file):
                try:
                    with open(proj_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    clips_dir = os.path.join(pdir, "clips")
                    actual_count = len(glob.glob(os.path.join(clips_dir, "*.json")))
                    data["clips_count"] = actual_count
                    projects.append(ProjectRecord.from_dict(data))
                except Exception as e:
                    logger.warning(f"Error loading project {proj_file}: {e}")

        projects.sort(key=lambda p: p.updated_at, reverse=True)
        return projects

    def save_clip_sidecar(self, sidecar: ClipSidecarRecord) -> str:
        """
        Atomically saves the sidecar JSON file and ensures the MP4 is stored
        in the project's structured clips folder with a descriptive human-readable name,
        while maintaining mirrors for backward compatibility.
        """
        pdir = self.get_project_dir(sidecar.project_id)
        clips_dir = os.path.join(pdir, "clips")
        os.makedirs(clips_dir, exist_ok=True)

        hook_title = (
            sidecar.caption_package.get("hook_title")
            or sidecar.candidate_data.get("hook_title")
            or sidecar.clip_id
        )
        clean_hook = sanitize_filesystem_name(hook_title, max_length=40)
        start_s = round(sidecar.start_seconds)
        end_s = round(sidecar.end_seconds)

        existing_clips = len(glob.glob(os.path.join(clips_dir, "*.json"))) + 1
        descriptive_base = f"{existing_clips:02d}_{clean_hook}_{start_s}s_{end_s}s"

        # If source MP4 exists, ensure it is copied/linked inside project clips directory
        if sidecar.file_path and os.path.exists(sidecar.file_path):
            project_mp4 = os.path.join(clips_dir, f"{descriptive_base}.mp4")
            if not os.path.exists(project_mp4) and os.path.abspath(sidecar.file_path) != os.path.abspath(project_mp4):
                try:
                    try:
                        os.link(sidecar.file_path, project_mp4)
                    except Exception:
                        shutil.copyfile(sidecar.file_path, project_mp4)
                except Exception as e:
                    logger.warning(f"Could not link MP4 to project clips: {e}")

        sidecar_path = os.path.join(clips_dir, f"{descriptive_base}.json")
        self._write_json_atomic(sidecar_path, sidecar.to_dict())

        # Also save legacy mirror in clips_dir for clip_<id>.json lookup
        base_cid = sidecar.clip_id[5:] if sidecar.clip_id.startswith("clip_") else sidecar.clip_id
        legacy_sidecar_path = os.path.join(clips_dir, f"clip_{base_cid}.json")
        if legacy_sidecar_path != sidecar_path:
            try:
                self._write_json_atomic(legacy_sidecar_path, sidecar.to_dict())
            except Exception:
                pass

        # Mirror in rendered_clips_dir for direct file lookup
        mirror_name = os.path.splitext(os.path.basename(sidecar.file_path))[0]
        mirror_path = os.path.join(self.rendered_clips_dir, f"{mirror_name}.json")
        try:
            self._write_json_atomic(mirror_path, sidecar.to_dict())
        except Exception:
            pass

        # Update parent project clip count
        proj = self.get_project(sidecar.project_id)
        if proj:
            self.save_project(proj)

        return sidecar_path

    def get_clip_sidecar(self, clip_id: str) -> Optional[ClipSidecarRecord]:
        """Retrieves clip sidecar by clip_id with robust fallback patterns."""
        base_cid = clip_id[5:] if clip_id.startswith("clip_") else clip_id

        # 1. Search in projects directory
        candidate_patterns = [
            os.path.join(self.projects_dir, "*", "clips", f"clip_{base_cid}.json"),
            os.path.join(self.projects_dir, "*", "clips", f"{clip_id}.json"),
            os.path.join(self.projects_dir, "*", "clips", f"clip_{clip_id}.json"),
            os.path.join(self.projects_dir, "*", "clips", f"*{base_cid}*.json"),
        ]
        for pattern in candidate_patterns:
            matches = glob.glob(pattern)
            if matches:
                try:
                    with open(matches[0], "r", encoding="utf-8") as f:
                        return ClipSidecarRecord.from_dict(json.load(f))
                except Exception as e:
                    logger.warning(f"Corrupted sidecar {matches[0]}: {e}")

        # 2. Search in rendered_clips directory
        mirror_patterns = [
            os.path.join(self.rendered_clips_dir, f"*{base_cid}*.json"),
            os.path.join(self.rendered_clips_dir, f"*{clip_id}*.json"),
        ]
        for mp in mirror_patterns:
            mirror_matches = glob.glob(mp)
            if mirror_matches:
                try:
                    with open(mirror_matches[0], "r", encoding="utf-8") as f:
                        return ClipSidecarRecord.from_dict(json.load(f))
                except Exception as e:
                    logger.warning(f"Corrupted mirror sidecar {mirror_matches[0]}: {e}")

        return None

    def list_clips(self, project_id: Optional[str] = None) -> List[ClipSidecarRecord]:
        """
        Returns all persisted clips, combining project sidecars and legacy rendered_clips.
        Reconciles missing media and filters duplicates.
        """
        seen_clips = {}

        # 1. Search projects directory
        if project_id:
            proj = self.get_project(project_id)
            if proj:
                pdir = self.get_project_dir(proj.video_id or proj.project_id)
                search_paths = [os.path.join(pdir, "clips", "*.json")]
            else:
                clean_id = project_id.replace("project_", "").replace("proj_", "")
                search_paths = [
                    os.path.join(self.projects_dir, f"*{clean_id}*", "clips", "*.json"),
                ]
        else:
            search_paths = [os.path.join(self.projects_dir, "*", "clips", "*.json")]

        sidecar_files = []
        for sp in search_paths:
            sidecar_files.extend(glob.glob(sp))

        for s_file in set(sidecar_files):
            try:
                with open(s_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                record = ClipSidecarRecord.from_dict(data)
                # Check media existence on disk
                if not os.path.exists(record.file_path) or os.path.getsize(record.file_path) == 0:
                    # Check if present in rendered_clips_dir
                    alt_path = os.path.join(self.rendered_clips_dir, os.path.basename(record.file_path))
                    if os.path.exists(alt_path) and os.path.getsize(alt_path) > 0:
                        record.file_path = alt_path
                    else:
                        record.status = "MISSING_MEDIA"
                seen_clips[record.clip_id] = record
            except Exception as e:
                logger.warning(f"Error reading sidecar {s_file}: {e}")

        # 2. Scan rendered_clips directory for legacy clips without project sidecar
        if not project_id:
            for mp4_file in glob.glob(os.path.join(self.rendered_clips_dir, "*.mp4")):
                if os.path.getsize(mp4_file) < 1024:
                    continue
                fname = os.path.basename(mp4_file)
                base_name = os.path.splitext(fname)[0]
                cid = base_name.replace("clip_", "")
                if cid not in seen_clips and fname not in [os.path.basename(c.file_path) for c in seen_clips.values()]:
                    # Check for companion JSON
                    json_path = os.path.join(self.rendered_clips_dir, f"{base_name}.json")
                    if os.path.exists(json_path):
                        try:
                            with open(json_path, "r", encoding="utf-8") as f:
                                data = json.load(f)
                            seen_clips[cid] = ClipSidecarRecord.from_dict(data)
                            continue
                        except Exception:
                            pass
                    # Synthesize basic sidecar for legacy unattached clip
                    size = os.path.getsize(mp4_file)
                    seen_clips[cid] = ClipSidecarRecord(
                        clip_id=cid,
                        project_id="legacy",
                        video_id="unknown",
                        file_path=mp4_file,
                        relative_url=f"/clips/{fname}",
                        start_seconds=0.0,
                        end_seconds=0.0,
                        duration_seconds=0.0,
                        score=75.0,
                        file_size_bytes=size,
                        render_timestamp=datetime.fromtimestamp(os.path.getmtime(mp4_file), timezone.utc).isoformat(),
                        status="COMPLETED",
                    )

        # Sort clips by render timestamp descending
        result = list(seen_clips.values())
        result.sort(key=lambda c: c.render_timestamp, reverse=True)
        return result

    def _write_json_atomic(self, path: str, data: Dict[str, Any]) -> None:
        """Writes JSON to a temporary file and atomically replaces destination."""
        tmp_path = f"{path}.tmp.{os.getpid()}"
        os.makedirs(os.path.dirname(path), exist_ok=True)
        try:
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            os.replace(tmp_path, path)
        except Exception:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass
            raise
