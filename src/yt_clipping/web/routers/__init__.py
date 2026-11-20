"""
Domain-specific APIRouters for YouTube Clipping Intelligence Studio API.
"""

from .health import router as health_router
from .video import router as video_router
from .clips import router as clips_router
from .trending import router as trending_router
from .editor import router as editor_router
from .flux import router as flux_router
from .publish import router as publish_router
from .batch import router as batch_router
from .rights import router as rights_router
from .external import router as external_router
from .supoclip import router as supoclip_router
from .auth import router as auth_router
from .pages import router as pages_router

__all__ = [
    "health_router",
    "video_router",
    "clips_router",
    "trending_router",
    "editor_router",
    "flux_router",
    "publish_router",
    "batch_router",
    "rights_router",
    "external_router",
    "supoclip_router",
    "auth_router",
    "pages_router",
]
