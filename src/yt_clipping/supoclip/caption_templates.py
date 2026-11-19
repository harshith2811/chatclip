"""
Caption template definitions for animated subtitles inspired by SupoClip.
Each template defines styling and animation properties for different caption styles:
default, hormozi, mrbeast, minimal, tiktok, neon, podcast.
"""

from typing import Dict, Any, List, Optional

CAPTION_TEMPLATES: Dict[str, Dict[str, Any]] = {
    "default": {
        "name": "Default",
        "description": "Punchy word-by-word captions with a pop highlight and emojis",
        "font_family": "THEBOLDFONT",
        "font_size": 32,
        "font_color": "#FFFFFF",
        "highlight_color": "#FFE000",  # Bright yellow for active word
        "emphasis_color": "#FFE000",
        "stroke_color": "#000000",
        "stroke_width": 3,
        "background": False,
        "background_color": None,
        "word_box": False,
        "word_box_color": None,
        "animation": "karaoke",
        "word_pop": True,
        "emoji": True,
        "uppercase": False,
        "shadow": True,
        "glow": False,
        "max_words_per_line": 4,
        "position_y": 0.80,
    },
    "hormozi": {
        "name": "Hormozi",
        "description": "Bold green highlight with a pill box behind active word",
        "font_family": "THEBOLDFONT",
        "font_size": 32,
        "font_color": "#FFFFFF",
        "highlight_color": "#00FF66",  # Bright green
        "emphasis_color": "#FFE000",
        "stroke_color": "#000000",
        "stroke_width": 4,
        "background": False,
        "background_color": None,
        "word_box": True,
        "word_box_color": "#00BF49",  # Green pill behind active word
        "animation": "karaoke",
        "word_pop": True,
        "emoji": True,
        "uppercase": True,
        "shadow": True,
        "glow": False,
        "max_words_per_line": 3,
        "position_y": 0.74,
    },
    "mrbeast": {
        "name": "MrBeast",
        "description": "Large yellow text with red pop highlights and expressive emojis",
        "font_family": "THEBOLDFONT",
        "font_size": 34,
        "font_color": "#FFFF00",  # Yellow
        "highlight_color": "#FF2D2D",  # Red
        "emphasis_color": "#FFFFFF",
        "stroke_color": "#000000",
        "stroke_width": 5,
        "background": False,
        "background_color": None,
        "word_box": False,
        "word_box_color": None,
        "animation": "karaoke",
        "word_pop": True,
        "emoji": True,
        "uppercase": True,
        "shadow": True,
        "glow": False,
        "max_words_per_line": 3,
        "position_y": 0.70,
    },
    "minimal": {
        "name": "Minimal",
        "description": "Clean, subtle captions with a soft translucent background",
        "font_family": "TikTokSans-Regular",
        "font_size": 26,
        "font_color": "#FFFFFF",
        "highlight_color": "#FFFFFF",
        "emphasis_color": None,
        "stroke_color": None,
        "stroke_width": 0,
        "background": True,
        "background_color": "#00000080",
        "word_box": False,
        "word_box_color": None,
        "animation": "fade",
        "word_pop": False,
        "emoji": False,
        "uppercase": False,
        "shadow": False,
        "glow": False,
        "max_words_per_line": 6,
        "position_y": 0.82,
    },
    "tiktok": {
        "name": "TikTok",
        "description": "TikTok-style with signature pink pop highlights",
        "font_family": "TikTokSans-Bold",
        "font_size": 28,
        "font_color": "#FFFFFF",
        "highlight_color": "#FE2C55",  # TikTok pink
        "emphasis_color": "#FE2C55",
        "stroke_color": "#000000",
        "stroke_width": 3,
        "background": False,
        "background_color": None,
        "word_box": False,
        "word_box_color": None,
        "animation": "karaoke",
        "word_pop": True,
        "emoji": True,
        "uppercase": False,
        "shadow": True,
        "glow": False,
        "max_words_per_line": 4,
        "position_y": 0.78,
    },
    "neon": {
        "name": "Neon",
        "description": "Glowing cyan neon text with magenta highlights",
        "font_family": "THEBOLDFONT",
        "font_size": 30,
        "font_color": "#00FFFF",  # Cyan
        "highlight_color": "#FF00FF",  # Magenta
        "emphasis_color": "#FF00FF",
        "stroke_color": "#002A6B",
        "stroke_width": 2,
        "background": False,
        "background_color": None,
        "word_box": False,
        "word_box_color": None,
        "animation": "karaoke",
        "word_pop": True,
        "emoji": False,
        "uppercase": False,
        "shadow": False,
        "glow": True,
        "max_words_per_line": 4,
        "position_y": 0.76,
    },
    "podcast": {
        "name": "Podcast",
        "description": "Professional podcast-style captions with warm gold accents",
        "font_family": "TikTokSans-Regular",
        "font_size": 28,
        "font_color": "#FFFFFF",
        "highlight_color": "#FFB800",  # Warm gold
        "emphasis_color": "#FFB800",
        "stroke_color": "#1A1A1A",
        "stroke_width": 2,
        "background": True,
        "background_color": "#1A1A1ACC",
        "word_box": False,
        "word_box_color": None,
        "animation": "karaoke",
        "word_pop": False,
        "emoji": False,
        "uppercase": False,
        "shadow": False,
        "glow": False,
        "max_words_per_line": 5,
        "position_y": 0.80,
    },
}

TEMPLATE_DEFAULTS: Dict[str, Any] = {
    "highlight_color": "#FFE000",
    "emphasis_color": None,
    "stroke_color": "#000000",
    "stroke_width": 3,
    "background": False,
    "background_color": None,
    "word_box": False,
    "word_box_color": None,
    "animation": "karaoke",
    "word_pop": True,
    "emoji": True,
    "uppercase": False,
    "shadow": True,
    "glow": False,
    "max_words_per_line": 4,
    "position_y": 0.80,
}


def get_template(template_name: str) -> Dict[str, Any]:
    """Get a caption template by name, returns default if not found."""
    template = CAPTION_TEMPLATES.get(template_name.lower(), CAPTION_TEMPLATES["default"])
    merged = dict(TEMPLATE_DEFAULTS)
    merged.update(template)
    return merged


def get_all_templates() -> Dict[str, Dict[str, Any]]:
    """Get all available caption templates."""
    return CAPTION_TEMPLATES


def get_template_names() -> List[str]:
    """Get list of all template names."""
    return list(CAPTION_TEMPLATES.keys())


def get_template_info() -> List[Dict[str, Any]]:
    """Get list of template info for API response."""
    return [
        {
            "id": name,
            "name": template["name"],
            "description": template["description"],
            "animation": template["animation"],
            "font_family": template["font_family"],
            "font_size": template["font_size"],
            "font_color": template["font_color"],
            "highlight_color": template["highlight_color"],
            "word_box": template.get("word_box", False),
            "uppercase": template.get("uppercase", False),
            "glow": template.get("glow", False),
            "emoji": template.get("emoji", True),
        }
        for name, template in CAPTION_TEMPLATES.items()
    ]
