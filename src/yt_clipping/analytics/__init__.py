"""
Analytics and Scoring Feedback Calibration System.
Tracks historical clip engagement, viewer retention, and user ratings to dynamically
calibrate future candidate scoring and hook selection weights.
"""

from .feedback_loop import (
    AnalyticsFeedbackLoop,
    ClipPerformanceRecord,
    FeedbackSummary,
    get_feedback_loop,
)

__all__ = [
    "AnalyticsFeedbackLoop",
    "ClipPerformanceRecord",
    "FeedbackSummary",
    "get_feedback_loop",
]
