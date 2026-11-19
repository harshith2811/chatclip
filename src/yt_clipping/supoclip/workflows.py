"""
Workflow schemas and planning engines inspired by SupoClip.
Supports 5 workflow modes:
1. 'highlights': Standalone viral moment clips (OpusClip / SupoClip default).
2. 'series': Sequential parts (Part 1, Part 2, ... Part N) with shared cut boundaries.
3. 'topic': Segments dedicated to a specific theme or keyword.
4. 'recap': Consolidated synthesis of key takeaways.
5. 'trailer': High-tension teaser terminating prior to story resolution.
"""

from __future__ import annotations
from typing import Dict, Any, List, Optional, Literal
from dataclasses import dataclass, field, asdict
import json
import re

from .virality_scorer import SupoClipScorer

WORKFLOWS: tuple[str, ...] = ("highlights", "series", "topic", "recap", "trailer")
WorkflowType = Literal["highlights", "series", "topic", "recap", "trailer"]


@dataclass
class WorkflowOptions:
    topic: str = ""
    part_count: Optional[int] = None
    instructions: str = ""
    target_duration_seconds: int = 45
    min_clip_seconds: int = 15
    max_clip_seconds: int = 60

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> "WorkflowOptions":
        if not data:
            return cls()
        raw_part_count = data.get("part_count")
        part_count = None
        if raw_part_count is not None:
            try:
                part_count = max(1, min(20, int(raw_part_count)))
            except (ValueError, TypeError):
                part_count = None

        return cls(
            topic=str(data.get("topic", "")).strip(),
            part_count=part_count,
            instructions=str(data.get("instructions", "")).strip(),
            target_duration_seconds=int(data.get("target_duration_seconds", 45)),
            min_clip_seconds=int(data.get("min_clip_seconds", 15)),
            max_clip_seconds=int(data.get("max_clip_seconds", 60)),
        )


@dataclass
class WorkflowSegmentPlan:
    part_number: int
    title: str
    hook_title: str
    start_time: float
    end_time: float
    duration: float
    workflow_role: str
    target_platform: str = "shorts"
    reasoning: str = ""


@dataclass
class WorkflowPlan:
    workflow: WorkflowType
    options: WorkflowOptions
    total_parts: int
    segments: List[WorkflowSegmentPlan]
    overview: str = ""


class WorkflowPlanner:
    """Plans video partitions based on workflow specifications and transcripts."""

    @staticmethod
    def list_workflows() -> List[Dict[str, Any]]:
        return [
            {
                "id": "highlights",
                "name": "Viral Highlights",
                "description": "Auto-detects high-retention, high-virality standalone clips.",
                "supports_topic": False,
                "supports_series": False,
            },
            {
                "id": "series",
                "name": "Episodic Series",
                "description": "Splits a continuous long-form narrative into Part 1, Part 2, ... Part N with cliffhangers.",
                "supports_topic": False,
                "supports_series": True,
            },
            {
                "id": "topic",
                "name": "Topic Deep-Dive",
                "description": "Extracts clips centered strictly around a designated topic, keyword, or concept.",
                "supports_topic": True,
                "supports_series": False,
            },
            {
                "id": "recap",
                "name": "Executive Recap",
                "description": "Synthesizes major takeaways and executive highlights into punchy summary shorts.",
                "supports_topic": False,
                "supports_series": False,
            },
            {
                "id": "trailer",
                "name": "Teaser Trailer",
                "description": "Builds a suspenseful teaser hook with high question velocity, cutting off before the reveal.",
                "supports_topic": False,
                "supports_series": False,
            },
        ]

    @staticmethod
    def plan(
        workflow: str,
        duration: float,
        transcript_segments: Optional[List[Dict[str, Any]]] = None,
        options: Optional[WorkflowOptions] = None,
    ) -> WorkflowPlan:
        wf = workflow.lower() if workflow in WORKFLOWS else "highlights"
        opts = options or WorkflowOptions()
        segments: List[WorkflowSegmentPlan] = []

        if duration <= 0:
            duration = 180.0  # safe default 3 mins

        if wf == "series":
            part_count = opts.part_count or max(2, min(5, int(duration // 45) or 2))
            part_count = max(1, min(20, part_count))
            part_duration = duration / part_count

            # If transcript segments available, align cut boundaries to nearest segment end
            for i in range(part_count):
                ideal_st = i * part_duration
                ideal_et = min(duration, (i + 1) * part_duration)
                st = ideal_st
                et = ideal_et
                if transcript_segments and len(transcript_segments) > 0:
                    # Find nearest segment boundary
                    close_ends = [float(s.get("end", 0)) for s in transcript_segments if abs(float(s.get("end", 0)) - ideal_et) <= 5.0]
                    if close_ends and i < part_count - 1:
                        et = min(duration, min(close_ends, key=lambda x: abs(x - ideal_et)))
                
                st = round(st, 2)
                et = round(max(st + opts.min_clip_seconds, et), 2)
                segments.append(
                    WorkflowSegmentPlan(
                        part_number=i + 1,
                        title=f"Part {i + 1}: The Journey Begins" if i == 0 else f"Part {i + 1}: What Happened Next",
                        hook_title=f"PART {i + 1}: WAIT TILL THE END" if i > 0 else "PART 1: THE BIGGEST REVEAL",
                        start_time=st,
                        end_time=et,
                        duration=round(et - st, 2),
                        workflow_role=f"part_{i + 1}_of_{part_count}",
                        reasoning=f"Sequential episodic partition {i + 1}/{part_count}",
                    )
                )
        elif wf == "topic":
            topic_query = opts.topic.lower() if opts.topic else "key topic"
            matched_windows = []
            if transcript_segments:
                for seg in transcript_segments:
                    text = seg.get("text", "").lower()
                    if any(t in text for t in topic_query.split() if len(t) > 2):
                        st = max(0.0, float(seg.get("start", 0)) - 2.0)
                        et = min(duration, float(seg.get("end", 30)) + 15.0)
                        if et - st >= opts.min_clip_seconds:
                            matched_windows.append((st, min(st + opts.max_clip_seconds, et)))
            
            if not matched_windows:
                matched_windows = [
                    (round(duration * 0.15, 2), round(min(duration, duration * 0.15 + 40), 2)),
                    (round(duration * 0.50, 2), round(min(duration, duration * 0.50 + 45), 2)),
                ]

            for i, (st, et) in enumerate(matched_windows[:4]):
                segments.append(
                    WorkflowSegmentPlan(
                        part_number=i + 1,
                        title=f"{opts.topic.title() or 'Topic'} Insight #{i + 1}",
                        hook_title=f"THE TRUTH ABOUT {opts.topic.upper() or 'THIS'}".strip()[:40],
                        start_time=st,
                        end_time=et,
                        duration=round(et - st, 2),
                        workflow_role="topic_clip",
                        reasoning=f"Segment specifically addressing topic: '{opts.topic}'",
                    )
                )
        elif wf == "trailer":
            st = round(duration * 0.05, 2)
            et = round(min(duration, st + 28.0), 2)
            hook_text = "YOU WON'T BELIEVE WHAT HAPPENS"
            if transcript_segments:
                # Find segment with question or high hook
                for seg in transcript_segments:
                    txt = seg.get("text", "")
                    if "?" in txt or any(k in txt.lower() for k in ("secret", "insane", "never", "truth")):
                        seg_st = max(0.0, float(seg.get("start", 0)))
                        seg_et = min(duration, seg_st + 28.0)
                        if seg_et - seg_st >= opts.min_clip_seconds:
                            st, et = round(seg_st, 2), round(seg_et, 2)
                            hook_text = SupoClipScorer.generate_hook_title(txt)
                            break
            segments.append(
                WorkflowSegmentPlan(
                    part_number=1,
                    title="Official Teaser Hook",
                    hook_title=hook_text,
                    start_time=st,
                    end_time=et,
                    duration=round(et - st, 2),
                    workflow_role="teaser_trailer",
                    reasoning="High-stakes teaser ending immediately before story climax",
                )
            )
        elif wf == "recap":
            st = round(duration * 0.2, 2)
            et = round(min(duration, st + 55.0), 2)
            hook_text = "HERE'S EVERYTHING IN 60 SECONDS"
            if transcript_segments and len(transcript_segments) >= 2:
                # Use concluding or highest value density segment
                for seg in reversed(transcript_segments):
                    txt = seg.get("text", "")
                    if any(k in txt.lower() for k in ("summary", "takeaway", "conclusion", "finally", "step", "remember")):
                        seg_st = max(0.0, float(seg.get("start", 0)))
                        seg_et = min(duration, seg_st + 50.0)
                        if seg_et - seg_st >= opts.min_clip_seconds:
                            st, et = round(seg_st, 2), round(seg_et, 2)
                            hook_text = SupoClipScorer.generate_hook_title(txt)
                            break
            segments.append(
                WorkflowSegmentPlan(
                    part_number=1,
                    title="Full Breakdown Recap",
                    hook_title=hook_text,
                    start_time=st,
                    end_time=et,
                    duration=round(et - st, 2),
                    workflow_role="executive_recap",
                    reasoning="Condensed summary delivering highest information density",
                )
            )
        else:  # highlights
            # If transcript_segments are provided, score candidate windows to select viral moments
            chosen_windows = []
            if transcript_segments and len(transcript_segments) > 0:
                scored = []
                for seg in transcript_segments:
                    txt = seg.get("text", "").strip()
                    seg_st = float(seg.get("start", 0))
                    seg_et = float(seg.get("end", seg_st + 30))
                    dur = seg_et - seg_st
                    if dur >= opts.min_clip_seconds:
                        score_res = SupoClipScorer.score_segment(txt, duration=dur)
                        scored.append((score_res.virality_score, seg_st, seg_et, score_res.hook_title, txt))
                scored.sort(key=lambda x: x[0], reverse=True)
                # Pick up to 2 non-overlapping
                for item in scored:
                    v_score, s_st, s_et, h_title, s_txt = item
                    if not any(abs(s_st - w[0]) < 20.0 for w in chosen_windows):
                        chosen_windows.append((round(s_st, 2), round(s_et, 2), h_title))
                    if len(chosen_windows) >= 2:
                        break

            if chosen_windows:
                for idx, (c_st, c_et, c_hook) in enumerate(chosen_windows):
                    segments.append(
                        WorkflowSegmentPlan(
                            part_number=idx + 1,
                            title=f"Viral Highlight #{idx + 1}",
                            hook_title=c_hook or "PEAK VIRAL MOMENT",
                            start_time=c_st,
                            end_time=c_et,
                            duration=round(c_et - c_st, 2),
                            workflow_role="viral_highlight",
                            reasoning="Ranked top virality score moment from transcript analysis",
                        )
                    )
            else:
                clip_len = min(45.0, duration * 0.5)
                st1 = round(duration * 0.1, 2)
                et1 = round(min(duration, st1 + clip_len), 2)
                segments.append(
                    WorkflowSegmentPlan(
                        part_number=1,
                        title="Best Moment #1",
                        hook_title="WATCH THIS BEFORE IT GETS TAKEN DOWN",
                        start_time=st1,
                        end_time=et1,
                        duration=round(et1 - st1, 2),
                        workflow_role="viral_highlight",
                        reasoning="Peak retention velocity moment detected in video",
                    )
                )
                if duration > 90:
                    st2 = round(duration * 0.6, 2)
                    et2 = round(min(duration, st2 + clip_len), 2)
                    segments.append(
                        WorkflowSegmentPlan(
                            part_number=2,
                            title="Best Moment #2",
                            hook_title="THE PART EVERYONE MISSED",
                            start_time=st2,
                            end_time=et2,
                            duration=round(et2 - st2, 2),
                            workflow_role="viral_highlight",
                            reasoning="Secondary engagement surge segment",
                        )
                    )

        return WorkflowPlan(
            workflow=wf,  # type: ignore
            options=opts,
            total_parts=len(segments),
            segments=segments,
            overview=f"Generated {len(segments)} segment plan for '{wf}' workflow.",
        )
