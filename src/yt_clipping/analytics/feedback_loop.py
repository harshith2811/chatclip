"""
Analytics Performance Ledger and Real-Time Scoring Feedback Calibration Loop.
Closes the loop between post-publish performance and candidate scoring:
1. Records genuine engagement signals (views, likes, retention, ratings) per clip.
2. Computes empirical performance multipliers per hook category and duration window.
3. Automatically calibrates candidate virality scoring so the platform improves over time.
"""

from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
import os
import sqlite3
import threading
import logging

logger = logging.getLogger("yt_clipping.analytics.feedback_loop")


@dataclass
class ClipPerformanceRecord:
    clip_id: str
    video_id: str
    hook_title: str
    hook_type: str                  # e.g. "Question", "Bold Absolute", "Contrast", "Provocative", "General"
    duration_seconds: float
    score: float                    # Initial AI predicted virality score (0-100)
    views: int = 0
    likes: int = 0
    shares: int = 0
    completion_rate: float = 0.0    # 0.0 - 1.0 (average % of short watched)
    user_rating: Optional[float] = None  # 1.0 - 5.0 creator feedback rating
    feedback_notes: str = ""
    published_platform: str = "local"
    recorded_at: str = ""


@dataclass
class FeedbackSummary:
    total_clips_tracked: int
    total_views: int
    average_retention: float
    top_performing_hook_types: List[Dict[str, Any]]
    optimal_duration_range: Tuple[float, float]
    calibration_active: bool


class AnalyticsFeedbackLoop:
    """
    Thread-safe SQLite-backed engagement analytics ledger and adaptive scoring calibrator.
    """

    def __init__(self, db_path: Optional[str] = None):
        if db_path is None:
            base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
            cache_dir = os.path.join(base_dir, "data", "cache")
            os.makedirs(cache_dir, exist_ok=True)
            db_path = os.path.join(cache_dir, "analytics_feedback.db")

        self.db_path = db_path
        self._lock = threading.Lock()
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=15.0)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._lock:
            with self._get_connection() as conn:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS clip_performance (
                        clip_id TEXT PRIMARY KEY,
                        video_id TEXT NOT NULL,
                        hook_title TEXT NOT NULL,
                        hook_type TEXT NOT NULL,
                        duration_seconds REAL NOT NULL,
                        score REAL NOT NULL,
                        views INTEGER DEFAULT 0,
                        likes INTEGER DEFAULT 0,
                        shares INTEGER DEFAULT 0,
                        completion_rate REAL DEFAULT 0.0,
                        user_rating REAL,
                        feedback_notes TEXT DEFAULT '',
                        published_platform TEXT DEFAULT 'local',
                        recorded_at TEXT NOT NULL
                    )
                    """
                )
                conn.execute("CREATE INDEX IF NOT EXISTS idx_perf_video ON clip_performance(video_id)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_perf_hook ON clip_performance(hook_type)")
                conn.commit()

    def record_clip_performance(self, record: ClipPerformanceRecord) -> bool:
        """Upserts a clip's engagement and evaluation telemetry."""
        now_iso = datetime.now(timezone.utc).isoformat()
        rec_time = record.recorded_at or now_iso

        with self._lock:
            try:
                with self._get_connection() as conn:
                    conn.execute(
                        """
                        INSERT INTO clip_performance (
                            clip_id, video_id, hook_title, hook_type, duration_seconds,
                            score, views, likes, shares, completion_rate,
                            user_rating, feedback_notes, published_platform, recorded_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(clip_id) DO UPDATE SET
                            views = excluded.views,
                            likes = excluded.likes,
                            shares = excluded.shares,
                            completion_rate = excluded.completion_rate,
                            user_rating = COALESCE(excluded.user_rating, clip_performance.user_rating),
                            feedback_notes = CASE WHEN excluded.feedback_notes != '' THEN excluded.feedback_notes ELSE clip_performance.feedback_notes END,
                            recorded_at = excluded.recorded_at
                        """,
                        (
                            record.clip_id,
                            record.video_id,
                            record.hook_title,
                            record.hook_type,
                            record.duration_seconds,
                            record.score,
                            record.views,
                            record.likes,
                            record.shares,
                            record.completion_rate,
                            record.user_rating,
                            record.feedback_notes,
                            record.published_platform,
                            rec_time,
                        ),
                    )
                    conn.commit()
                return True
            except Exception as e:
                logger.error(f"Failed to record clip performance {record.clip_id}: {e}")
                return False

    def record_user_feedback(self, clip_id: str, rating: float, notes: str = "") -> bool:
        """Records creator feedback (1.0 to 5.0 stars) for a rendered or previewed cut."""
        with self._lock:
            try:
                with self._get_connection() as conn:
                    cursor = conn.execute(
                        """
                        UPDATE clip_performance
                        SET user_rating = ?, feedback_notes = ?
                        WHERE clip_id = ?
                        """,
                        (max(1.0, min(5.0, rating)), notes.strip(), clip_id),
                    )
                    conn.commit()
                    return cursor.rowcount > 0
            except Exception as e:
                logger.error(f"Failed to record feedback for clip {clip_id}: {e}")
                return False

    def get_calibrated_multipliers(self) -> Dict[str, Any]:
        """
        Analyzes performance history across hook types and duration bands.
        Returns weight calibration factors to feed forward into future candidate selection.
        """
        with self._lock:
            try:
                with self._get_connection() as conn:
                    # Calculate empirical performance per hook type
                    rows = conn.execute(
                        """
                        SELECT
                            hook_type,
                            COUNT(*) as sample_count,
                            AVG(views) as avg_views,
                            AVG(completion_rate) as avg_retention,
                            AVG(user_rating) as avg_rating
                        FROM clip_performance
                        GROUP BY hook_type
                        HAVING COUNT(*) >= 1
                        """
                    ).fetchall()

                    hook_multipliers: Dict[str, float] = {}
                    global_retention_sum = 0.0
                    global_count = 0

                    for r in rows:
                        retention = r["avg_retention"] or 0.0
                        rating = r["avg_rating"]
                        count = r["sample_count"]

                        # Effective performance score combining completion rate (70%) and user rating (30%)
                        perf_score = retention
                        if rating is not None:
                            perf_score = (retention * 0.70) + ((rating / 5.0) * 0.30)

                        global_retention_sum += perf_score * count
                        global_count += count

                    global_baseline = (global_retention_sum / max(global_count, 1)) if global_count > 0 else 0.65
                    if global_baseline <= 0:
                        global_baseline = 0.65

                    for r in rows:
                        ht = r["hook_type"]
                        retention = r["avg_retention"] or 0.0
                        rating = r["avg_rating"]
                        perf_score = retention
                        if rating is not None:
                            perf_score = (retention * 0.70) + ((rating / 5.0) * 0.30)

                        # Bounded calibration multiplier: 0.90 to 1.15
                        rel_ratio = perf_score / global_baseline
                        mult = max(0.90, min(1.15, 1.0 + (rel_ratio - 1.0) * 0.25))
                        hook_multipliers[ht] = round(mult, 3)

                    return {
                        "global_baseline_retention": round(global_baseline, 3),
                        "total_samples": global_count,
                        "hook_multipliers": hook_multipliers,
                        "calibration_active": global_count >= 3,
                    }
            except Exception as e:
                logger.error(f"Failed to compute calibration multipliers: {e}")
                return {"hook_multipliers": {}, "calibration_active": False, "total_samples": 0}

    def calibrate_candidate_score(
        self,
        base_score: float,
        hook_type: str,
        duration_seconds: float,
    ) -> Tuple[float, float, str]:
        """
        Applies empirical feedback multiplier to raw candidate score.
        Returns: (calibrated_score, multiplier_applied, rationale)
        """
        multipliers = self.get_calibrated_multipliers()
        if not multipliers.get("calibration_active", False):
            return base_score, 1.0, "Baseline (Uncalibrated - building historical profile)"

        hook_map = multipliers.get("hook_multipliers", {})
        mult = hook_map.get(hook_type, 1.0)

        # Subtle duration sweet-spot factor (22s to 45s has highest social retention)
        dur_factor = 1.0
        if 22.0 <= duration_seconds <= 42.0:
            dur_factor = 1.03
        elif duration_seconds < 15.0 or duration_seconds > 58.0:
            dur_factor = 0.97

        total_mult = mult * dur_factor
        calibrated = max(0.0, min(100.0, base_score * total_mult))

        pct_change = round((total_mult - 1.0) * 100, 1)
        sign = "+" if pct_change >= 0 else ""
        rationale = f"Calibrated via Feedback Loop ({sign}{pct_change}% adjustment based on {multipliers['total_samples']} historical clips)"

        return round(calibrated, 1), round(total_mult, 3), rationale

    def get_summary(self) -> Dict[str, Any]:
        """Returns executive overview of analytics ledger and top performing patterns."""
        with self._lock:
            try:
                with self._get_connection() as conn:
                    total = conn.execute("SELECT COUNT(*) FROM clip_performance").fetchone()[0]
                    views = conn.execute("SELECT SUM(views) FROM clip_performance").fetchone()[0] or 0
                    avg_ret = conn.execute("SELECT AVG(completion_rate) FROM clip_performance").fetchone()[0] or 0.0

                    hook_stats = conn.execute(
                        """
                        SELECT hook_type, COUNT(*) as count, AVG(completion_rate) as retention, AVG(user_rating) as rating
                        FROM clip_performance
                        GROUP BY hook_type
                        ORDER BY retention DESC
                        """
                    ).fetchall()

                    return {
                        "total_clips_tracked": total,
                        "total_views": views,
                        "average_retention": round(avg_ret, 3),
                        "top_hooks": [
                            {
                                "hook_type": h["hook_type"],
                                "count": h["count"],
                                "retention": round(h["retention"] or 0.0, 3),
                                "rating": round(h["rating"] or 0.0, 1) if h["rating"] else None,
                            }
                            for h in hook_stats
                        ],
                        "calibration_status": "ONLINE" if total >= 3 else "CALIBRATING",
                    }
            except Exception as e:
                logger.error(f"Failed to generate analytics summary: {e}")
                return {"total_clips_tracked": 0, "total_views": 0, "average_retention": 0.0, "top_hooks": []}


# Singleton accessor
_GLOBAL_FEEDBACK_LOOP: Optional[AnalyticsFeedbackLoop] = None


def get_feedback_loop() -> AnalyticsFeedbackLoop:
    global _GLOBAL_FEEDBACK_LOOP
    if _GLOBAL_FEEDBACK_LOOP is None:
        _GLOBAL_FEEDBACK_LOOP = AnalyticsFeedbackLoop()
    return _GLOBAL_FEEDBACK_LOOP
