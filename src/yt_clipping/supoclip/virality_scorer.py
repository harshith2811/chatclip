"""
SupoClip 4-metric virality scoring engine and hook title generator.
Computes:
- hook_score (0-25)
- engagement_score (0-25)
- value_score (0-25)
- shareability_score (0-25)
- virality_score (0-100, the sum of the four dimensions)
- hook_title (3-9 words, high-tension headline for clip openings)
"""

from __future__ import annotations
from typing import Dict, Any, List, Optional
from dataclasses import dataclass, asdict
import re


@dataclass
class SupoClipViralityScore:
    hook_score: float        # 0 - 25
    engagement_score: float  # 0 - 25
    value_score: float       # 0 - 25
    shareability_score: float # 0 - 25
    virality_score: float    # 0 - 100
    hook_title: str          # 3-9 words
    explanation: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class SupoClipScorer:
    """Calculates virality scores along SupoClip's 4 dimensions and synthesizes hook titles."""

    HOOK_TRIGGER_WORDS = {
        "secret", "insane", "never", "always", "mistake", "truth", "shocking",
        "exposed", "stop", "why", "how", "warning", "crazy", "illegal", "hidden",
        "million", "billion", "ruined", "saved", "best", "worst", "hate", "love",
    }

    ENGAGEMENT_TRIGGER_WORDS = {
        "you", "think", "believe", "agree", "disagree", "comment", "tell",
        "question", "actually", "realize", "notice", "wait", "listen", "look",
    }

    VALUE_TRIGGER_WORDS = {
        "step", "hack", "tip", "framework", "strategy", "method", "guide",
        "learn", "advice", "result", "money", "growth", "build", "scale",
    }

    SHARE_TRIGGER_WORDS = {
        "everyone", "friends", "share", "tag", "send", "need", "relatable",
        "world", "future", "mind-blowing", "unbelievable", "proof",
    }

    @classmethod
    def generate_hook_title(cls, text: str, default_topic: str = "This Moment") -> str:
        """Synthesize a 3-9 word hook title in ALL CAPS."""
        words = re.findall(r"\b[A-Za-z0-9']+\b", text.strip())
        if not words:
            return f"THE SECRET TO {default_topic.upper()}"

        first_few = [w.lower() for w in words[:15]]
        
        # Look for questions or strong triggers
        if "?" in text[:100] or any(w in ("why", "how", "what", "is") for w in first_few[:2]):
            candidates = [w for w in words[:7] if len(w) > 2]
            return "HOW THIS CHANGED EVERYTHING" if len(candidates) < 3 else " ".join(candidates[:6]).upper()
        
        # Look for warning / mistakes
        if any(w in ("mistake", "never", "stop", "wrong", "danger") for w in first_few):
            return "THE BIGGEST MISTAKE PEOPLE MAKE"
        
        # Look for wealth / secrets
        if any(w in ("money", "dollar", "million", "secret", "hack") for w in first_few):
            return "THE MILLION DOLLAR SECRET"

        # General high-curiosity default
        return f"WHY NOBODY TALKS ABOUT THIS"

    @classmethod
    def score_segment(
        cls,
        text: str,
        duration: float,
        pacing_wpm: float = 140.0,
        audio_energy: float = 0.7,
    ) -> SupoClipViralityScore:
        """
        Calculates scores (0-25 each, sum to 0-100) based on transcript signals,
        tempo/pacing, audio energy, and curiosity gaps.
        Gracefully handles empty or degenerate transcripts.
        """
        raw_text = (text or "").strip()
        words = re.findall(r"\b\w+\b", raw_text.lower())
        word_count = len(words)
        
        if word_count == 0:
            return SupoClipViralityScore(
                hook_score=0.0,
                engagement_score=0.0,
                value_score=0.0,
                shareability_score=0.0,
                virality_score=0.0,
                hook_title="",
                explanation="Insufficient transcript content to evaluate virality.",
            )

        duration = max(1.0, float(duration))
        pacing_wpm = max(0.0, float(pacing_wpm))
        audio_energy = max(0.0, min(1.0, float(audio_energy)))

        # 1. Hook Score (0 - 25)
        # Evaluates first 5 seconds or first 15 words
        first_words = set(words[:min(15, word_count)])
        hook_hits = len(first_words.intersection(cls.HOOK_TRIGGER_WORDS))
        base_hook = 14.0 + min(8.0, hook_hits * 3.0)
        if "?" in raw_text[:60] or "!" in raw_text[:60]:
            base_hook += 2.0
        hook_score = round(max(5.0, min(25.0, base_hook)), 1)

        # 2. Engagement Score (0 - 25)
        eng_hits = len(set(words).intersection(cls.ENGAGEMENT_TRIGGER_WORDS))
        # Good pacing is between 120 and 170 WPM
        pacing_bonus = 3.0 if 120 <= pacing_wpm <= 170 else (1.0 if 100 <= pacing_wpm <= 190 else 0.0)
        base_eng = 12.0 + min(7.0, eng_hits * 1.5) + pacing_bonus + (audio_energy * 3.0)
        engagement_score = round(max(5.0, min(25.0, base_eng)), 1)

        # 3. Value Score (0 - 25)
        val_hits = len(set(words).intersection(cls.VALUE_TRIGGER_WORDS))
        # Optimal duration for shorts is 25-50s
        dur_bonus = 3.0 if 20 <= duration <= 55 else 1.0
        base_val = 13.0 + min(8.0, val_hits * 2.0) + dur_bonus
        value_score = round(max(5.0, min(25.0, base_val)), 1)

        # 4. Shareability Score (0 - 25)
        share_hits = len(set(words).intersection(cls.SHARE_TRIGGER_WORDS))
        base_share = 13.0 + min(9.0, share_hits * 2.5) + (2.0 if word_count > 30 else 0.0)
        shareability_score = round(max(5.0, min(25.0, base_share)), 1)

        virality_score = round(hook_score + engagement_score + value_score + shareability_score, 1)
        hook_title = cls.generate_hook_title(raw_text)

        reasons = []
        if hook_score >= 20:
            reasons.append("Strong curiosity gap in opening")
        if engagement_score >= 20:
            reasons.append("High direct audience engagement and dialogue tempo")
        if value_score >= 20:
            reasons.append("Actionable insight delivery")
        if shareability_score >= 20:
            reasons.append("High emotional shareability")
        if not reasons:
            reasons.append("Solid overall narrative cohesion")

        return SupoClipViralityScore(
            hook_score=hook_score,
            engagement_score=engagement_score,
            value_score=value_score,
            shareability_score=shareability_score,
            virality_score=virality_score,
            hook_title=hook_title,
            explanation="; ".join(reasons),
        )
