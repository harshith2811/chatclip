"""
Configurable High-Risk Source & License Classification Engine.

Classifies discovered YouTube videos/channels into structured compliance buckets
(`creative_commons_only`, `approved_creators`, `owned`, `standard_youtube`,
`unknown`, `restricted`) and flags high-risk source indicators (non-embeddable,
region-restricted, music labels, sports broadcasts, media conglomerates, madeForKids)
for review rather than relying on fragile hardcoded blanket bans.
"""

from __future__ import annotations

import os
import re
import sqlite3
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


DEFAULT_HIGH_RISK_PATTERNS = [
    ("music_label_vevo", "Major Music / VEVO", "music", r"(?i)\b(?:vevo|universal music|sony music|warner music|official music video)\b", "HIGH", "REVIEW_REQUIRED"),
    ("sports_broadcast", "Sports League Broadcast", "sports", r"(?i)\b(?:nfl|nba|fifa|uefa|mlb|formula 1|f1 highlights|ufc ppv)\b", "HIGH", "REVIEW_REQUIRED"),
    ("studio_trailer", "Film / TV Studio Broadcast", "broadcast", r"(?i)\b(?:warner bros|disney|netflix|hbo|paramount|universal pictures)\b", "HIGH", "REVIEW_REQUIRED"),
]


@dataclass
class SourceClassification:
    video_id: str
    compliance_bucket: str
    risk_level: str  # LOW, MEDIUM, HIGH, RESTRICTED
    risk_flags: List[str] = field(default_factory=list)
    review_required: bool = True
    matched_rules: List[str] = field(default_factory=list)


class RiskClassificationRegistry:
    """SQLite-backed configurable high-risk source rule registry and classifier."""

    def __init__(self, db_path: str = "data/jobs.db"):
        self.db_path = db_path
        self._ensure_schema_and_defaults()

    def _connect(self) -> sqlite3.Connection:
        os.makedirs(os.path.dirname(self.db_path) or ".", exist_ok=True)
        conn = sqlite3.connect(self.db_path, timeout=30.0)
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_schema_and_defaults(self) -> None:
        conn = self._connect()
        try:
            with conn:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS high_risk_sources (
                        rule_id TEXT PRIMARY KEY,
                        organization_name TEXT NOT NULL,
                        category TEXT NOT NULL,
                        channel_id TEXT,
                        keyword_pattern TEXT,
                        risk_level TEXT NOT NULL DEFAULT 'HIGH',
                        default_action TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED',
                        notes TEXT,
                        active INTEGER DEFAULT 1,
                        created_at TEXT NOT NULL
                    )
                    """
                )
                count = conn.execute("SELECT COUNT(*) FROM high_risk_sources").fetchone()[0]
                if count == 0:
                    now_iso = datetime.now(timezone.utc).isoformat()
                    for rid, org, cat, pat, risk, act in DEFAULT_HIGH_RISK_PATTERNS:
                        conn.execute(
                            """
                            INSERT OR IGNORE INTO high_risk_sources (
                                rule_id, organization_name, category, channel_id,
                                keyword_pattern, risk_level, default_action, notes, active, created_at
                            ) VALUES (?, ?, ?, NULL, ?, ?, ?, 'Default configurable risk indicator rule', 1, ?)
                            """,
                            (rid, org, cat, pat, risk, act, now_iso),
                        )
        finally:
            conn.close()

    def add_rule(
        self,
        organization_name: str,
        category: str,
        *,
        channel_id: Optional[str] = None,
        keyword_pattern: Optional[str] = None,
        risk_level: str = "HIGH",
        default_action: str = "REVIEW_REQUIRED",
        notes: str = "",
    ) -> str:
        rule_id = f"hrs-{uuid.uuid4().hex[:10]}"
        now_iso = datetime.now(timezone.utc).isoformat()
        conn = self._connect()
        try:
            with conn:
                conn.execute(
                    """
                    INSERT INTO high_risk_sources (
                        rule_id, organization_name, category, channel_id,
                        keyword_pattern, risk_level, default_action, notes, active, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                    """,
                    (
                        rule_id,
                        organization_name,
                        category,
                        channel_id,
                        keyword_pattern,
                        risk_level.upper(),
                        default_action,
                        notes,
                        now_iso,
                    ),
                )
        finally:
            conn.close()
        return rule_id

    def list_rules(self, active_only: bool = True) -> List[Dict[str, Any]]:
        conn = self._connect()
        try:
            q = "SELECT * FROM high_risk_sources"
            if active_only:
                q += " WHERE active = 1"
            rows = conn.execute(q + " ORDER BY created_at ASC").fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def classify_source(
        self,
        video_id: str,
        *,
        title: str = "",
        channel_id: Optional[str] = None,
        channel_name: str = "",
        license_status: str = "unknown",
        embeddable: bool = True,
        privacy_status: str = "public",
        made_for_kids: bool = False,
        category_id: str = "",
        region_restriction: Optional[Dict[str, Any]] = None,
        creator_policy: Optional[str] = None,
    ) -> SourceClassification:
        risk_flags: List[str] = []
        matched_rules: List[str] = []
        risk_level = "LOW"

        lic = (license_status or "unknown").strip()
        if not embeddable:
            risk_flags.append("non_embeddable")
            risk_level = "RESTRICTED"
        if (privacy_status or "public").lower() not in ("public", "unlisted"):
            risk_flags.append(f"privacy:{privacy_status}")
            risk_level = "RESTRICTED"
        if made_for_kids:
            risk_flags.append("made_for_kids")
            if risk_level == "LOW":
                risk_level = "MEDIUM"
        if region_restriction and (region_restriction.get("blocked") or region_restriction.get("allowed")):
            risk_flags.append("region_restricted")
            if risk_level == "LOW":
                risk_level = "MEDIUM"
        if str(category_id) == "10":
            risk_flags.append("music_category")
            risk_level = "HIGH" if risk_level != "RESTRICTED" else risk_level

        combined_text = f"{title} {channel_name}"
        for rule in self.list_rules(active_only=True):
            ch_match = bool(rule.get("channel_id") and channel_id and rule["channel_id"] == channel_id)
            pat = rule.get("keyword_pattern") or ""
            kw_match = False
            if pat:
                try:
                    kw_match = bool(re.search(pat, combined_text))
                except re.error:
                    kw_match = False
            if ch_match or kw_match:
                matched_rules.append(rule["rule_id"])
                risk_flags.append(f"rule:{rule['category']}:{rule['organization_name']}")
                if rule.get("risk_level") == "HIGH" and risk_level != "RESTRICTED":
                    risk_level = "HIGH"

        if risk_level == "RESTRICTED":
            bucket = "restricted"
        elif creator_policy == "OWNED_SOURCE":
            bucket = "owned"
        elif creator_policy in ("APPROVED_PARTNER", "OPEN_AFFILIATE", "PARTNER_PROGRAM"):
            bucket = "approved_creators"
        elif lic == "creativeCommon":
            bucket = "creative_commons_only"
        elif lic == "youtube":
            bucket = "standard_youtube"
        else:
            bucket = "unknown"

        review_required = bucket not in ("owned", "approved_creators") or bool(risk_flags)
        return SourceClassification(
            video_id=video_id,
            compliance_bucket=bucket,
            risk_level=risk_level,
            risk_flags=risk_flags,
            review_required=review_required,
            matched_rules=matched_rules,
        )
