r"""
Advanced ASS subtitle and hook title generator inspired by SupoClip.
Produces stylized .ass subtitle files with:
- Word-level karaoke animation (`{\k...}` tags)
- Color highlighting of active words
- Word pop / pill box styling
- Upper/lower case transforms
- Hook Title banners burned into the top safe area (first 3-5 seconds)
"""

from __future__ import annotations
from typing import Dict, Any, List, Optional, Tuple
import os
import re

from .caption_templates import get_template


def escape_ass_text(text: str) -> str:
    """Escapes transcript text to prevent ASS syntax/override block injection."""
    if not text:
        return ""
    cleaned = "".join(ch for ch in text if ch >= " " or ch in "\n\r\t")
    cleaned = cleaned.replace("\\", "\\\\")
    cleaned = re.sub(r"\r?\n", "\\\\N", cleaned)
    cleaned = cleaned.replace("{", "(").replace("}", ")")
    return cleaned.strip()


def format_ass_timestamp(seconds: float) -> str:
    """Format seconds into ASS timestamp string: H:MM:SS.cc"""
    if seconds < 0:
        seconds = 0.0
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int(round((seconds - int(seconds)) * 100))
    if cs >= 100:
        cs = 99
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def hex_to_ass_color(hex_color: Optional[str], alpha_hex: str = "00") -> str:
    """
    Convert #RRGGBB or #RRGGBBAA hex color into ASS format &HAABBGGRR.
    """
    if not hex_color:
        return "&H00FFFFFF"
    
    clean = hex_color.strip().lstrip("#")
    if len(clean) == 8:
        # RRGGBBAA -> AA is alpha, BB, GG, RR
        r = clean[0:2]
        g = clean[2:4]
        b = clean[4:6]
        a = clean[6:8]
        return f"&H{a.upper()}{b.upper()}{g.upper()}{r.upper()}"
    elif len(clean) == 6:
        r = clean[0:2]
        g = clean[2:4]
        b = clean[4:6]
        return f"&H{alpha_hex.upper()}{b.upper()}{g.upper()}{r.upper()}"
    return "&H00FFFFFF"


class AssSubtitleBuilder:
    """Constructs ASS subtitle scripts supporting SupoClip animation styles."""

    @classmethod
    def generate_ass(
        cls,
        words: List[Dict[str, Any]],
        template_name: str = "default",
        video_width: int = 1080,
        video_height: int = 1920,
        hook_title: Optional[str] = None,
        hook_duration: float = 4.0,
    ) -> str:
        """
        words format: [{'word': str, 'start': float, 'end': float}]
        """
        tmpl = get_template(template_name)
        font = tmpl.get("font_family", "THEBOLDFONT")
        font_size = int(tmpl.get("font_size", 32) * 2.2)  # scale for 1080x1920
        primary_color = hex_to_ass_color(tmpl.get("font_color", "#FFFFFF"))
        highlight_color = hex_to_ass_color(tmpl.get("highlight_color", "#FFE000"))
        box_color = hex_to_ass_color(tmpl.get("word_box_color", "#00BF49")) if tmpl.get("word_box") else None
        outline_color = hex_to_ass_color(tmpl.get("stroke_color", "#000000"))
        outline_width = tmpl.get("stroke_width", 3) * 2
        pos_y = int(video_height * tmpl.get("position_y", 0.78))
        pos_x = int(video_width // 2)
        uppercase = tmpl.get("uppercase", False)
        word_pop = tmpl.get("word_pop", True)
        word_box = tmpl.get("word_box", False)

        header = f"""[Script Info]
Title: SupoClip Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: {video_width}
PlayResY: {video_height}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font},{font_size},{highlight_color},{primary_color},{outline_color},&H00000000,-1,0,0,0,100,100,1,0,1,{outline_width},2,2,40,40,60,1
Style: HookTitle,THEBOLDFONT,76,&H00FFFFFF,&H00FFE000,&H00000000,&H80000000,-1,0,0,0,100,100,2,0,1,6,3,8,60,60,180,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
        events: List[str] = []

        # 1. Hook Title Event (burned into top safe area for first ~4 seconds)
        if hook_title:
            ht_clean = escape_ass_text(hook_title)
            if uppercase or True:
                ht_clean = ht_clean.upper()
            # Line break if longer than 4 words
            words_ht = ht_clean.split()
            if len(words_ht) > 4:
                mid = len(words_ht) // 2
                ht_clean = " ".join(words_ht[:mid]) + "\\N" + " ".join(words_ht[mid:])
            st_str = format_ass_timestamp(0.0)
            et_str = format_ass_timestamp(hook_duration)
            # Fade in 150ms, fade out 300ms
            events.append(
                f"Dialogue: 1,{st_str},{et_str},HookTitle,,0,0,0,,{{\\fad(150,300)\\pos({pos_x},220)}}{ht_clean}"
            )

        # 2. Word Subtitles Grouped by Line with Active Word Karaoke Highlighting
        if not words:
            return header + "\n".join(events) + "\n"

        max_words = tmpl.get("max_words_per_line", 4)
        word_chunks = [words[i : i + max_words] for i in range(0, len(words), max_words)]

        for chunk in word_chunks:
            if not chunk:
                continue
            chunk_start = float(chunk[0].get("start", 0))
            chunk_end = float(chunk[-1].get("end", chunk_start + 1.0))
            if chunk_end <= chunk_start:
                chunk_end = chunk_start + 1.0

            for local_i, w in enumerate(chunk):
                w_start = float(w.get("start", chunk_start))
                w_end = float(chunk[local_i + 1].get("start", chunk_end)) if local_i + 1 < len(chunk) else chunk_end
                if w_end <= w_start:
                    w_end = w_start + 0.3

                parts = []
                for local_j, other in enumerate(chunk):
                    raw_text = escape_ass_text(other.get("word", ""))
                    if uppercase:
                        raw_text = raw_text.upper()
                    if local_j == local_i:
                        dur_cs = max(10, int(round((w_end - w_start) * 100)))
                        if word_box and box_color:
                            parts.append(f"{{\\k{dur_cs}\\c{highlight_color}\\3c{box_color}\\bord{outline_width + 4}}}{raw_text}")
                        else:
                            parts.append(f"{{\\k{dur_cs}\\c{highlight_color}}}{raw_text}")
                    else:
                        parts.append(f"{{\\c{primary_color}}}{raw_text}")

                line_text = " ".join(parts)
                st_ass = format_ass_timestamp(w_start)
                et_ass = format_ass_timestamp(w_end)
                pop_tag = "\\fscx90\\fscy90\\t(0,120,\\fscx100\\fscy100)" if (word_pop and local_i == 0) else ""
                events.append(
                    f"Dialogue: 0,{st_ass},{et_ass},Default,,0,0,0,,{{\\pos({pos_x},{pos_y}){pop_tag}}}{line_text}"
                )

        return header + "\n".join(events) + "\n"
