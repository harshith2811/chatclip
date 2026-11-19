"""
SupoClip Integration Module for YouTube Clipping Intelligence Platform.
Exports:
- SupoClipAdapter
- get_supoclip_adapter
- get_template, get_all_templates, get_template_names, get_template_info
- WorkflowPlanner, WorkflowOptions, WorkflowPlan
- SupoClipScorer, SupoClipViralityScore
- AssSubtitleBuilder
- SupoClipReframer
- SupoClipEditorEngine
"""

from .caption_templates import (
    CAPTION_TEMPLATES,
    get_template,
    get_all_templates,
    get_template_names,
    get_template_info,
)
from .workflows import (
    WORKFLOWS,
    WorkflowType,
    WorkflowOptions,
    WorkflowSegmentPlan,
    WorkflowPlan,
    WorkflowPlanner,
)
from .virality_scorer import (
    SupoClipScorer,
    SupoClipViralityScore,
)
from .subtitles import (
    AssSubtitleBuilder,
    format_ass_timestamp,
    hex_to_ass_color,
)
from .reframer import (
    SupoClipReframer,
)
from .editor import (
    PLATFORM_PRESETS,
    SupoClipEditorEngine,
)
from .adapter import (
    SupoClipAdapter,
    get_supoclip_adapter,
)

__all__ = [
    "CAPTION_TEMPLATES",
    "get_template",
    "get_all_templates",
    "get_template_names",
    "get_template_info",
    "WORKFLOWS",
    "WorkflowType",
    "WorkflowOptions",
    "WorkflowSegmentPlan",
    "WorkflowPlan",
    "WorkflowPlanner",
    "SupoClipScorer",
    "SupoClipViralityScore",
    "AssSubtitleBuilder",
    "format_ass_timestamp",
    "hex_to_ass_color",
    "SupoClipReframer",
    "PLATFORM_PRESETS",
    "SupoClipEditorEngine",
    "SupoClipAdapter",
    "get_supoclip_adapter",
]
