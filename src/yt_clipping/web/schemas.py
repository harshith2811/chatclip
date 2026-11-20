"""
Pydantic Request & Response Schemas for YouTube Clipping Web API.
100% backward compatible data models for FastAPI routes.
"""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class MetadataRequest(BaseModel):
    video_id_or_url: str = Field(..., description="YouTube video ID or URL")


class PreviewRequest(BaseModel):
    video_id_or_url: str = Field(..., description="YouTube video ID or URL")
    min_duration: float = Field(15.0, description="Minimum clip duration in seconds")
    max_duration: float = Field(60.0, description="Maximum clip duration in seconds")


class BatchStartRequest(BaseModel):
    video_ids: Optional[List[str]] = None
    name: Optional[str] = "Overnight 10M+ Trending Batch"
    max_clips: Optional[int] = 3
    layout: Optional[str] = "active_speaker"
    subtitle_preset: Optional[str] = "hormozi"
    enable_polish: Optional[bool] = True
    enable_outro: Optional[bool] = True
    gpu: Optional[bool] = True


class RenderRequest(BaseModel):
    video_id_or_url: str = Field(..., description="YouTube video ID or URL")
    max_clips: int = Field(5, description="Number of solid shorts to extract (1-10)")
    layout: str = Field("active_speaker", description="Layout: active_speaker | blur_background | split_screen")
    subtitle_preset: str = Field("hormozi", description="Subtitle preset: hormozi | beast_bounce | neon_cyber | clean_editorial")
    enable_polish: bool = Field(True, description="Enable broadcast hook pacing and anti-pop audio transitions")
    enable_outro: bool = Field(True, description="Enable dedicated animated outro card with bell chime")
    outro_channel_name: Optional[str] = Field(None, description="Custom channel name for outro card")
    gpu: bool = Field(True, description="Use NVIDIA NVENC hardware acceleration if available")


class StreamToClipperRequest(BaseModel):
    video_id_or_url: str = Field(..., description="YouTube video ID or URL to clip and publish")
    max_clips: int = Field(1, description="Number of solid shorts to extract and publish (1-5)")
    layout: str = Field("active_speaker", description="Layout: active_speaker | blur_background | split_screen")
    subtitle_preset: str = Field("hormozi", description="Subtitle preset: hormozi | beast_bounce | neon_cyber | clean_editorial")
    enable_polish: bool = Field(True, description="Enable broadcast hook pacing polish")
    enable_outro: bool = Field(True, description="Enable animated outro card")
    gpu: bool = Field(True, description="Use NVENC GPU acceleration if available")
    auto_publish: bool = Field(False, description="Publish clip after explicit rights and human review verification")
    platforms: List[str] = Field(default_factory=lambda: ["youtube_shorts", "instagram_reels", "tiktok"])
    target: str = Field("watched_folder", description="Publish target: watched_folder | omnipost")
    approved_by_user: bool = Field(False, description="Mandatory explicit human authorization confirmation")


class FluxGenerateRequest(BaseModel):
    prompt: str = Field(..., description="Visual scene prompt")
    style_preset: Optional[str] = Field("cinematic_hook", description="Visual style preset")
    width: Optional[int] = Field(768, description="Target pixel width")
    height: Optional[int] = Field(1344, description="Target pixel height")
    steps: Optional[int] = Field(4, description="Inference steps (1-8)")
    animate_broll: Optional[bool] = Field(False, description="Render Ken Burns video clip")


class FluxBRollRequest(BaseModel):
    image_path: str = Field(..., description="Path to FLUX image")
    duration: Optional[float] = Field(3.5, description="Video clip duration in seconds")
    motion: Optional[str] = Field("zoom_in", description="Motion type: zoom_in | zoom_out | pan")


class FluxAutoBRollRequest(BaseModel):
    transcript_text: str = Field(..., description="Clip transcript dialogue to analyze")
    max_concepts: Optional[int] = Field(3, description="Maximum number of concepts")
    style_preset: Optional[str] = Field("cinematic_hook", description="Visual style preset")


class FluxSettingsRequest(BaseModel):
    account_id: str = Field(..., description="Cloudflare Account ID")
    api_token: str = Field(..., description="Cloudflare API Token")


class SavePosterRequest(BaseModel):
    video_path: str = Field(..., description="Video path or filename")
    timestamp: float = Field(0.0, description="Timestamp to capture")
    clip_id: Optional[str] = Field(None, description="Clip ID to attach poster to")


class FeedbackRequest(BaseModel):
    clip_id: str = Field(..., description="Clip identifier")
    rating: float = Field(..., description="User star rating 1.0 to 5.0")
    notes: Optional[str] = Field("", description="Optional creator feedback notes")
    hook_type: Optional[str] = Field("General", description="Hook type classification")
    video_id: Optional[str] = Field("", description="Source video ID")
    hook_title: Optional[str] = Field("", description="Hook title")
    duration_seconds: Optional[float] = Field(30.0, description="Clip duration")
    score: Optional[float] = Field(80.0, description="Initial predicted score")


class EditorFrameRequest(BaseModel):
    file_path: str
    timestamp: float = 0.0


class EditorExportClipSpec(BaseModel):
    title: str = "Edited Clip"
    start_seconds: float = 0.0
    end_seconds: float = 30.0
    aspect_ratio: str = "9:16"
    center_x: float = 0.5
    center_y: float = 0.5
    layout_mode: str = "crop"
    text_overlay: Optional[str] = None
    text_position: str = "top"
    description: Optional[str] = None


class EditorExportRequest(BaseModel):
    source_path: str
    project_id: str
    clips: List[EditorExportClipSpec]


class PublishSubmitRequest(BaseModel):
    clip_id: Optional[str] = None
    clip_ids: Optional[List[str]] = None
    target: str = "youtube_dedicated"
    channel_id: Optional[str] = None
    platforms: List[str] = Field(default_factory=lambda: ["youtube"])
    title: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    thumbnail_path: Optional[str] = None
    scheduled_time: Optional[str] = None
    approved_by_user: bool = False


class RightsRegisterRequest(BaseModel):
    video_id: str
    basis: str
    owner: str
    status: str = "PENDING_REVIEW"
    proof_reference: str = ""
    license_url: str = ""
    license_id: str = ""
    creator_id: str = ""
    evidence_type: str = ""
    verified_by: str = "studio_operator"
    valid_until: Optional[str] = None
    audit_notes: str = ""
    allow_regrant_revoked: bool = False


class RightsRevokeRequest(BaseModel):
    video_id: Optional[str] = None
    creator_id: Optional[str] = None
    reason: str
    actor: str = "studio_operator"


class CreatorApproveRequest(BaseModel):
    channel_id: str
    channel_name: str
    policy: str
    approval_evidence: str
    creator_handle: Optional[str] = None
    approved_by: str = "studio_operator"
    expires_at: Optional[str] = None
    notes: str = ""


class CreatorRevokeRequest(BaseModel):
    channel_id: str
    reason: str
    revoked_by: str = "studio_operator"


class ExternalAIVideoIngestRequest(BaseModel):
    project_id: str
    video_url: str
    source_engine: str = "custom_ai_pipeline"
    prompt_metadata: Optional[Dict[str, Any]] = None
    transcript: Optional[List[Dict[str, Any]]] = None
    target_aspect_ratio: str = "9:16"
    audio_treatment: Optional[Dict[str, Any]] = None
    omnipost_routing: Optional[Dict[str, Any]] = None


class SupoClipScoreRequest(BaseModel):
    text: str
    duration: float = Field(default=30.0, ge=1.0)
    pacing_wpm: float = Field(default=140.0, ge=10.0)
    audio_energy: float = Field(default=0.7, ge=0.0, le=1.0)


class SupoClipPlanRequest(BaseModel):
    workflow: str = Field(default="highlights")
    duration: float = Field(default=180.0, ge=5.0)
    transcript_segments: Optional[List[Dict[str, Any]]] = None
    options: Optional[Dict[str, Any]] = None


class SupoClipRenderRequest(BaseModel):
    source_path: Optional[str] = None
    clip_id: Optional[str] = None
    output_filename: Optional[str] = None
    start_time: float = Field(default=0.0, ge=0.0)
    end_time: float = Field(default=30.0, gt=0.0)
    template_name: str = Field(default="default")
    words: Optional[List[Dict[str, Any]]] = None
    hook_title: Optional[str] = None
    layout: str = Field(default="talking_head")
    ken_burns_zoom: bool = Field(default=True)
    platform_preset: Optional[str] = None


class SupoClipTrimRequest(BaseModel):
    source_path: Optional[str] = None
    clip_id: Optional[str] = None
    start_time: float = Field(ge=0.0)
    end_time: float = Field(gt=0.0)
    output_filename: Optional[str] = None


class SupoClipSplitRequest(BaseModel):
    source_path: Optional[str] = None
    clip_id: Optional[str] = None
    split_timestamp: float = Field(gt=0.0)
    base_name: Optional[str] = "split"


class SupoClipMergeRequest(BaseModel):
    clip_ids: Optional[List[str]] = None
    clip_paths: Optional[List[str]] = None
    target_filename: Optional[str] = None
