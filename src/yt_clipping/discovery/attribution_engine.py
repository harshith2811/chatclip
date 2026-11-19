"""
Rights-Aware Creator Attribution & Policy Governance Engine.

Enforces default-deny creator policies (REVIEW_REQUIRED for unknown sources),
evidence-backed creator approvals/revocations in SQLite (`creator_registry` +
`monitored_channels`), Creative Commons (CC BY 3.0 / 4.0) & partner attribution
formatting/validation, and separated sponsor detection vs explicit-authorized
sponsor removal.
"""

from __future__ import annotations

import logging
import os
import re
import sqlite3
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


class CreatorPolicy(str, Enum):
    """Governance classifications for source creators/channels."""

    STRICT_COPYRIGHT = "STRICT_COPYRIGHT"       # Explicit deny: do not clip/publish
    REVIEW_REQUIRED = "REVIEW_REQUIRED"         # Default-deny for unverified/unknown creators
    APPROVED_PARTNER = "APPROVED_PARTNER"       # Evidence-backed partner / written permission
    VERIFIED_OPEN_LICENSE = "VERIFIED_OPEN_LICENSE"  # Verified CC BY / open-license source
    OWNED_SOURCE = "OWNED_SOURCE"               # Operator-owned channel
    # Legacy enum aliases retained only for backward-compatible DB deserialization.
    OPEN_AFFILIATE = "OPEN_AFFILIATE"
    CREATIVE_COMMONS = "CREATIVE_COMMONS"
    PARTNER_PROGRAM = "PARTNER_PROGRAM"


SAFE_CREATOR_POLICIES = frozenset({
    CreatorPolicy.APPROVED_PARTNER,
    CreatorPolicy.VERIFIED_OPEN_LICENSE,
    CreatorPolicy.OWNED_SOURCE,
    CreatorPolicy.OPEN_AFFILIATE,
    CreatorPolicy.CREATIVE_COMMONS,
    CreatorPolicy.PARTNER_PROGRAM,
})

CC_LICENSE_URLS: Dict[str, str] = {
    "CC BY 4.0": "https://creativecommons.org/licenses/by/4.0/",
    "CC-BY-4.0": "https://creativecommons.org/licenses/by/4.0/",
    "CC BY 3.0": "https://creativecommons.org/licenses/by/3.0/",
    "CC-BY-3.0": "https://creativecommons.org/licenses/by/3.0/",
    "CREATIVE_COMMONS": "https://creativecommons.org/licenses/by/4.0/",
    "CC BY": "https://creativecommons.org/licenses/by/4.0/",
}


@dataclass
class AttributionPackage:
    """Structured attribution metadata and formatted descriptions for clipped shorts."""

    video_id: str
    creator_name: str
    creator_handle: str
    original_url: str
    policy: CreatorPolicy
    caption_credit: str
    disclaimer: str
    hashtags: str
    full_description: str
    is_safe_to_clip: bool
    license_type: str = "UNVERIFIED"
    license_url: str = ""
    source_title: str = ""
    modifications_note: str = ""
    badge_text: str = ""
    compliance_notes: str = ""
    attribution_valid: bool = False
    validation_errors: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["policy"] = self.policy.value
        return d


def validate_attribution_package(
    pkg: AttributionPackage,
    require_safe_policy: bool = False,
) -> Tuple[bool, List[str]]:
    """
    Validates that an AttributionPackage contains every required legal and
    license-specific attribution element before rendering or publication.
    """
    errors: List[str] = []
    if not pkg.video_id or not str(pkg.video_id).strip():
        errors.append("Missing source video_id")
    if not pkg.creator_name or not str(pkg.creator_name).strip():
        errors.append("Missing source creator_name")
    if not pkg.original_url or not str(pkg.original_url).startswith(("http://", "https://")):
        errors.append("Missing valid original source URL")
    if not pkg.caption_credit or str(pkg.creator_name) not in pkg.caption_credit:
        errors.append("caption_credit must visibly credit the creator")

    lic_upper = (pkg.license_type or "").upper()
    if "CC" in lic_upper or pkg.policy in (
        CreatorPolicy.VERIFIED_OPEN_LICENSE,
        CreatorPolicy.CREATIVE_COMMONS,
    ):
        if not pkg.license_url or "creativecommons.org" not in pkg.license_url.lower():
            errors.append("Creative Commons attribution requires a valid creativecommons.org license URL")
        if not pkg.modifications_note or not pkg.modifications_note.strip():
            errors.append("Creative Commons attribution requires a modifications_note")

    if require_safe_policy and not pkg.is_safe_to_clip:
        errors.append(f"Creator policy '{pkg.policy.value}' is not authorized for autonomous processing/publishing")

    return (len(errors) == 0, errors)


class AttributionEngine:
    """
    Manages creator rights policies, evidence-backed approvals/revocations,
    license-specific attribution packages, and safe sponsor handling.
    """

    # Never pre-approve unverified third-party creators. Kept empty intentionally.
    KNOWN_OPEN_CREATORS: Dict[str, Dict[str, Any]] = {}

    SPONSOR_PATTERNS = [
        r"(?i).*?\bsponsored\s+by\b.*",
        r"(?i).*?\bsponsor(?:s|ed)?\b.*https?://.*",
        r"(?i).*?\bspecial\s+thanks\s+to\b.*\bsponsors?\b.*",
        r"(?i).*?\bthanks\s+to\b.*\bsponsors?\b.*",
        r"(?i).*?\buse\s+link\s+for\s+\d+%\s+discount\b.*",
        r"(?i).*?\baffiliate\s+link\b.*",
        r"(?i).*?\buse\s+(?:code|promo)\b.*",
        r"(?i).*?\bpromo\s+code\b.*",
        r"(?i).*?\bget\s+\d+%\s+off\b.*",
        r"(?i).*?\bcheck\s+out\s+today'?s\s+sponsor\b.*",
        r"(?i).*?\bthanks\s+to\s+.*\s+for\s+sponsoring\b.*",
        r"(?i).*?\blink\s+in\s+(?:the\s+)?description\s+below\s+for\b.*",
        r"(?i).*?\bexpressvpn\b.*",
        r"(?i).*?\bnordvpn\b.*",
        r"(?i).*?\bag1\b.*",
        r"(?i).*?\bathletic\s+greens\b.*",
        r"(?i).*?\bsquarespace\b.*",
        r"(?i).*?\bbetterhelp\b.*",
        r"(?i).*?\bhelix\s+sleep\b.*",
    ]

    def __init__(self, db_path: str = "data/jobs.db"):
        self.db_path = db_path
        self._init_registry()

    def _connect(self) -> sqlite3.Connection:
        os.makedirs(os.path.dirname(self.db_path) or ".", exist_ok=True)
        conn = sqlite3.connect(self.db_path, timeout=30.0)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_registry(self) -> None:
        conn = self._connect()
        try:
            with conn:
                conn.execute("PRAGMA journal_mode=WAL;")
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS monitored_channels (
                        channel_id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        handle TEXT,
                        url TEXT,
                        baseline_views REAL DEFAULT 10000.0,
                        baseline_views_updated_at TEXT,
                        etag TEXT,
                        last_modified TEXT,
                        last_polled_at TEXT,
                        last_video_id TEXT,
                        active INTEGER DEFAULT 1,
                        paused INTEGER DEFAULT 0,
                        clipping_policy TEXT DEFAULT 'REVIEW_REQUIRED',
                        attribution_template TEXT,
                        created_at TEXT DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS creator_registry (
                        creator_key TEXT PRIMARY KEY,
                        creator_id TEXT,
                        channel_id TEXT UNIQUE,
                        channel_name TEXT NOT NULL,
                        creator_handle TEXT,
                        handle TEXT,
                        policy TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED',
                        approval_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
                        approval_evidence TEXT DEFAULT '',
                        approved_by TEXT,
                        approved_at TEXT,
                        expires_at TEXT,
                        revoked_at TEXT,
                        revocation_reason TEXT,
                        notes TEXT DEFAULT '',
                        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
                for col_sql in (
                    "ALTER TABLE creator_registry ADD COLUMN creator_key TEXT",
                    "ALTER TABLE creator_registry ADD COLUMN creator_id TEXT",
                    "ALTER TABLE creator_registry ADD COLUMN channel_id TEXT",
                    "ALTER TABLE creator_registry ADD COLUMN creator_handle TEXT",
                    "ALTER TABLE creator_registry ADD COLUMN handle TEXT",
                    "ALTER TABLE creator_registry ADD COLUMN approval_status TEXT DEFAULT 'UNVERIFIED'",
                    "ALTER TABLE creator_registry ADD COLUMN approval_evidence TEXT DEFAULT ''",
                    "ALTER TABLE creator_registry ADD COLUMN approved_by TEXT",
                    "ALTER TABLE creator_registry ADD COLUMN approved_at TEXT",
                    "ALTER TABLE creator_registry ADD COLUMN expires_at TEXT",
                    "ALTER TABLE creator_registry ADD COLUMN revoked_at TEXT",
                    "ALTER TABLE creator_registry ADD COLUMN revocation_reason TEXT",
                    "ALTER TABLE creator_registry ADD COLUMN notes TEXT DEFAULT ''",
                    "ALTER TABLE creator_registry ADD COLUMN updated_at TEXT",
                    "ALTER TABLE monitored_channels ADD COLUMN attribution_template TEXT",
                    "ALTER TABLE monitored_channels ADD COLUMN clipping_policy TEXT DEFAULT 'REVIEW_REQUIRED'",
                ):
                    try:
                        conn.execute(col_sql)
                    except sqlite3.OperationalError:
                        pass
        finally:
            conn.close()

    def get_creator_record(self, channel_id: str, handle: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Fetches the full stored creator governance record if present."""
        conn = self._connect()
        try:
            row = conn.execute(
                """
                SELECT * FROM creator_registry
                WHERE creator_key = ? OR channel_id = ? OR creator_id = ?
                   OR (handle IS NOT NULL AND LOWER(handle) = LOWER(?))
                   OR (creator_handle IS NOT NULL AND LOWER(creator_handle) = LOWER(?))
                LIMIT 1
                """,
                (channel_id, channel_id, channel_id, handle or "", handle or ""),
            ).fetchone()
            if row:
                return dict(row)

            mc = conn.execute(
                """
                SELECT channel_id, name AS channel_name, handle, clipping_policy AS policy,
                       active, attribution_template AS notes
                FROM monitored_channels
                WHERE channel_id = ? OR (handle IS NOT NULL AND LOWER(handle) = LOWER(?))
                LIMIT 1
                """,
                (channel_id, handle or ""),
            ).fetchone()
            if mc:
                rec = dict(mc)
                rec["approval_status"] = "LEGACY_MONITORED"
                return rec
            return None
        finally:
            conn.close()

    def get_creator_policy(self, channel_id: str, handle: Optional[str] = None) -> CreatorPolicy:
        """
        Resolves the creator's clipping policy using a strict default-deny posture.
        Unknown creators ALWAYS resolve to CreatorPolicy.REVIEW_REQUIRED.
        """
        conn = self._connect()
        try:
            row = conn.execute(
                """
                SELECT policy, approval_status, approval_evidence, expires_at, revoked_at
                FROM creator_registry
                WHERE creator_key = ? OR channel_id = ? OR creator_id = ?
                   OR (handle IS NOT NULL AND LOWER(handle) = LOWER(?))
                   OR (creator_handle IS NOT NULL AND LOWER(creator_handle) = LOWER(?))
                LIMIT 1
                """,
                (channel_id, channel_id, channel_id, handle or "", handle or ""),
            ).fetchone()
            if row:
                if row["revoked_at"] or (row["approval_status"] or "").upper() == "REVOKED":
                    return CreatorPolicy.STRICT_COPYRIGHT
                if row["expires_at"]:
                    try:
                        exp = datetime.fromisoformat(str(row["expires_at"]).replace("Z", "+00:00"))
                        if exp.tzinfo is None:
                            exp = exp.replace(tzinfo=timezone.utc)
                        if exp <= datetime.now(timezone.utc):
                            return CreatorPolicy.REVIEW_REQUIRED
                    except ValueError:
                        return CreatorPolicy.REVIEW_REQUIRED
                pol_str = row["policy"] or CreatorPolicy.REVIEW_REQUIRED.value
                try:
                    pol = CreatorPolicy(pol_str)
                except ValueError:
                    return CreatorPolicy.REVIEW_REQUIRED
                if pol in SAFE_CREATOR_POLICIES and (
                    (row["approval_status"] or "").upper() != "APPROVED"
                    or not (row["approval_evidence"] or "").strip()
                ):
                    return CreatorPolicy.REVIEW_REQUIRED
                return pol

            mc = conn.execute(
                """
                SELECT clipping_policy, active
                FROM monitored_channels
                WHERE channel_id = ? OR (handle IS NOT NULL AND LOWER(handle) = LOWER(?))
                LIMIT 1
                """,
                (channel_id, handle or ""),
            ).fetchone()
            if mc and mc["active"] == 1 and mc["clipping_policy"]:
                try:
                    pol = CreatorPolicy(mc["clipping_policy"])
                    # Legacy monitored channels without creator_registry evidence require review
                    if pol in SAFE_CREATOR_POLICIES:
                        return CreatorPolicy.REVIEW_REQUIRED
                    return pol
                except ValueError:
                    return CreatorPolicy.REVIEW_REQUIRED
        finally:
            conn.close()

        return CreatorPolicy.REVIEW_REQUIRED

    def approve_creator(
        self,
        channel_id: str,
        channel_name: str,
        policy: CreatorPolicy,
        approval_evidence: str,
        creator_handle: Optional[str] = None,
        approved_by: str = "operator",
        expires_at: Optional[str] = None,
        notes: str = "",
    ) -> Dict[str, Any]:
        """Registers an evidence-backed creator approval in creator_registry."""
        if not channel_id or not str(channel_id).strip():
            raise ValueError("channel_id is required")
        if policy not in SAFE_CREATOR_POLICIES:
            raise ValueError(f"approve_creator requires an authorized CreatorPolicy, got '{policy.value}'")
        evidence_clean = (approval_evidence or "").strip()
        if len(evidence_clean) < 3:
            raise ValueError(
                f"Cannot approve creator '{channel_id}' with policy '{policy.value}' without approval_evidence"
            )

        now_iso = datetime.now(timezone.utc).isoformat()
        clean_handle = creator_handle if not creator_handle or creator_handle.startswith("@") else f"@{creator_handle}"

        conn = self._connect()
        try:
            with conn:
                conn.execute(
                    """
                    INSERT INTO creator_registry (
                        creator_key, creator_id, channel_id, channel_name, creator_handle, handle,
                        policy, approval_status, approval_evidence, approved_by, approved_at, expires_at,
                        revoked_at, revocation_reason, notes, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'APPROVED', ?, ?, ?, ?, NULL, NULL, ?, ?)
                    ON CONFLICT(creator_key) DO UPDATE SET
                        creator_id = excluded.creator_id,
                        channel_id = excluded.channel_id,
                        channel_name = excluded.channel_name,
                        creator_handle = COALESCE(excluded.creator_handle, creator_registry.creator_handle),
                        handle = COALESCE(excluded.handle, creator_registry.handle),
                        policy = excluded.policy,
                        approval_status = 'APPROVED',
                        approval_evidence = excluded.approval_evidence,
                        approved_by = excluded.approved_by,
                        approved_at = excluded.approved_at,
                        expires_at = excluded.expires_at,
                        revoked_at = NULL,
                        revocation_reason = NULL,
                        notes = excluded.notes,
                        updated_at = excluded.updated_at
                    """,
                    (
                        channel_id,
                        channel_id,
                        channel_id,
                        channel_name,
                        clean_handle,
                        clean_handle,
                        policy.value,
                        evidence_clean,
                        approved_by,
                        now_iso,
                        expires_at,
                        notes,
                        now_iso,
                    ),
                )
                conn.execute(
                    """
                    UPDATE monitored_channels
                    SET clipping_policy = ?
                    WHERE channel_id = ?
                    """,
                    (policy.value, channel_id),
                )
        finally:
            conn.close()

        return {
            "channel_id": channel_id,
            "channel_name": channel_name,
            "handle": clean_handle,
            "policy": policy.value,
            "approval_status": "APPROVED",
            "approval_evidence": evidence_clean,
            "approved_by": approved_by,
            "approved_at": now_iso,
        }

    def revoke_creator(
        self,
        channel_id: str,
        reason: str,
        revoked_by: str = "operator",
    ) -> Dict[str, Any]:
        """Revokes a creator's clipping permission and enforces STRICT_COPYRIGHT."""
        if not reason or not reason.strip():
            raise ValueError("Revocation reason is required")
        now_iso = datetime.now(timezone.utc).isoformat()
        conn = self._connect()
        try:
            with conn:
                existing = conn.execute(
                    "SELECT channel_name, handle FROM creator_registry WHERE channel_id = ?",
                    (channel_id,),
                ).fetchone()
                name = existing["channel_name"] if existing else channel_id
                handle = existing["handle"] if existing else None
                conn.execute(
                    """
                    INSERT INTO creator_registry (
                        creator_key, creator_id, channel_id, channel_name, creator_handle, handle,
                        policy, approval_status, approval_evidence, revoked_at, revocation_reason, notes, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, 'STRICT_COPYRIGHT', 'REVOKED', '', ?, ?, ?, ?)
                    ON CONFLICT(creator_key) DO UPDATE SET
                        policy = 'STRICT_COPYRIGHT',
                        approval_status = 'REVOKED',
                        revoked_at = excluded.revoked_at,
                        revocation_reason = excluded.revocation_reason,
                        notes = excluded.notes,
                        updated_at = excluded.updated_at
                    """,
                    (
                        channel_id,
                        channel_id,
                        channel_id,
                        name,
                        handle,
                        handle,
                        now_iso,
                        reason.strip(),
                        f"Revoked by {revoked_by}: {reason.strip()}",
                        now_iso,
                    ),
                )
                conn.execute(
                    """
                    UPDATE monitored_channels
                    SET clipping_policy = 'STRICT_COPYRIGHT', active = 0
                    WHERE channel_id = ? OR (handle IS NOT NULL AND LOWER(handle) = LOWER(?))
                    """,
                    (channel_id, channel_id),
                )
        finally:
            conn.close()

        return {
            "channel_id": channel_id,
            "policy": CreatorPolicy.STRICT_COPYRIGHT.value,
            "approval_status": "REVOKED",
            "revoked_at": now_iso,
            "revocation_reason": reason.strip(),
            "revoked_by": revoked_by,
        }

    def set_creator_policy(
        self,
        channel_id: str,
        channel_name: str,
        creator_handle: Optional[str] = None,
        policy: CreatorPolicy = CreatorPolicy.REVIEW_REQUIRED,
        notes: str = "",
        approval_evidence: str = "",
        approved_by: str = "operator",
        expires_at: Optional[str] = None,
    ) -> None:
        """
        Persists creator policy governance cleanly. Setting an authorized safe
        policy requires explicit `approval_evidence`.
        """
        if policy in SAFE_CREATOR_POLICIES:
            if not (approval_evidence or "").strip():
                raise ValueError(
                    f"Setting safe policy '{policy.value}' requires non-empty approval_evidence"
                )
            self.approve_creator(
                channel_id=channel_id,
                channel_name=channel_name,
                policy=policy,
                approval_evidence=approval_evidence,
                creator_handle=creator_handle,
                approved_by=approved_by,
                expires_at=expires_at,
                notes=notes,
            )
            return

        now_iso = datetime.now(timezone.utc).isoformat()
        clean_handle = creator_handle if not creator_handle or creator_handle.startswith("@") else f"@{creator_handle}"
        status = "REVOKED" if policy == CreatorPolicy.STRICT_COPYRIGHT else "PENDING_REVIEW"

        conn = self._connect()
        try:
            with conn:
                conn.execute(
                    """
                    INSERT INTO creator_registry (
                        creator_key, creator_id, channel_id, channel_name, creator_handle, handle,
                        policy, approval_status, approval_evidence, notes, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)
                    ON CONFLICT(creator_key) DO UPDATE SET
                        channel_name = excluded.channel_name,
                        creator_handle = COALESCE(excluded.creator_handle, creator_registry.creator_handle),
                        handle = COALESCE(excluded.handle, creator_registry.handle),
                        policy = excluded.policy,
                        approval_status = excluded.approval_status,
                        notes = excluded.notes,
                        updated_at = excluded.updated_at
                    """,
                    (channel_id, channel_id, channel_id, channel_name, clean_handle, clean_handle, policy.value, status, notes, now_iso),
                )
                conn.execute(
                    """
                    INSERT INTO monitored_channels (channel_id, name, handle, clipping_policy, attribution_template, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(channel_id) DO UPDATE SET
                        clipping_policy = excluded.clipping_policy,
                        attribution_template = excluded.attribution_template,
                        name = excluded.name,
                        handle = COALESCE(excluded.handle, monitored_channels.handle)
                    """,
                    (channel_id, channel_name, clean_handle, policy.value, notes, now_iso),
                )
        finally:
            conn.close()

    def format_attribution(
        self,
        video_id: str,
        creator_name: str,
        creator_handle: Optional[str] = None,
        video_title: Optional[str] = None,
        category_tags: Optional[List[str]] = None,
        channel_id: Optional[str] = None,
        policy_override: Optional[CreatorPolicy] = None,
        license_type: Optional[str] = None,
        license_url: Optional[str] = None,
        modifications_note: Optional[str] = None,
    ) -> AttributionPackage:
        """
        Generates compliant, license-aware credit blocks and source attribution
        for a clip, enforcing default-deny creator safety checks.
        """
        clean_handle = creator_handle or ""
        if clean_handle and not clean_handle.startswith("@"):
            clean_handle = f"@{clean_handle}"

        lookup_id = channel_id or creator_name
        policy = policy_override or self.get_creator_policy(lookup_id, clean_handle or None)
        is_safe = policy in SAFE_CREATOR_POLICIES

        resolved_license = (license_type or "").strip()
        if not resolved_license:
            if policy in (CreatorPolicy.VERIFIED_OPEN_LICENSE, CreatorPolicy.CREATIVE_COMMONS):
                resolved_license = "CC BY 4.0"
            elif policy == CreatorPolicy.OWNED_SOURCE:
                resolved_license = "OWNED"
            elif policy in (CreatorPolicy.APPROVED_PARTNER, CreatorPolicy.OPEN_AFFILIATE, CreatorPolicy.PARTNER_PROGRAM):
                resolved_license = "APPROVED_PARTNER"
            else:
                resolved_license = "REVIEW_REQUIRED"

        resolved_url = (license_url or "").strip() or CC_LICENSE_URLS.get(resolved_license.upper(), "")
        resolved_mod = (modifications_note or "").strip()
        if not resolved_mod and ("CC" in resolved_license.upper() or policy in (CreatorPolicy.VERIFIED_OPEN_LICENSE, CreatorPolicy.CREATIVE_COMMONS)):
            resolved_mod = "Vertical 9:16 crop, captions, and commentary adaptation."

        original_url = f"https://youtu.be/{video_id}"
        handle_str = clean_handle if clean_handle else creator_name
        title_line = f'"{video_title}" — ' if video_title else ""

        caption_credit = (
            f"Original Content by: {handle_str} ({creator_name}) | "
            f"{title_line}Watch the full episode: {original_url}"
        )
        badge_text = f"Source: {handle_str} ({resolved_license})"

        if "CC" in resolved_license.upper() and resolved_url:
            disclaimer = (
                f"License: {resolved_license} ({resolved_url}) | "
                f"Modifications: {resolved_mod} | "
                f"Curated for educational discussion & commentary; does not waive platform/creator policies."
            )
        elif policy == CreatorPolicy.OWNED_SOURCE:
            disclaimer = "Published directly from operator-owned source catalog."
        elif is_safe:
            disclaimer = (
                f"Authorized under verified policy ({policy.value}). "
                "Curated for educational discussion and audience commentary."
            )
        else:
            disclaimer = (
                f"RIGHTS HOLD ({policy.value}): Curated for educational discussion preview only; "
                "requires verified license or written permission prior to publication."
            )

        base_tags = ["shorts", "insights", "highlights"]
        if category_tags:
            for t in category_tags:
                clean_t = re.sub(r"[^a-zA-Z0-9_]", "", t).lower()
                if clean_t and clean_t not in base_tags:
                    base_tags.append(clean_t)
        hashtags = " ".join(f"#{t}" for t in base_tags[:8])

        desc_lines = [caption_credit, ""]
        if "CC" in resolved_license.upper() and resolved_url:
            desc_lines.append(f"License: {resolved_license} ({resolved_url})")
            desc_lines.append(f"Changes Made: {resolved_mod}")
        desc_lines.extend([disclaimer, "", hashtags])
        full_description = "\n".join(desc_lines)

        comp_notes = (
            f"CLEARED: Policy '{policy.value}' approved."
            if is_safe
            else f"BLOCKED: Policy '{policy.value}' does not permit autonomous clipping without verified clearance."
        )

        pkg = AttributionPackage(
            video_id=video_id,
            creator_name=creator_name,
            creator_handle=clean_handle,
            original_url=original_url,
            policy=policy,
            caption_credit=caption_credit,
            disclaimer=disclaimer,
            hashtags=hashtags,
            full_description=full_description,
            is_safe_to_clip=is_safe,
            license_type=resolved_license,
            license_url=resolved_url,
            source_title=video_title or "",
            modifications_note=resolved_mod,
            badge_text=badge_text,
            compliance_notes=comp_notes,
        )
        valid, errors = validate_attribution_package(pkg, require_safe_policy=False)
        pkg.attribution_valid = valid
        pkg.validation_errors = errors
        return pkg

    @classmethod
    def detect_sponsor_segments(cls, text: str) -> Tuple[bool, List[str], List[int]]:
        """Non-destructively identifies sponsor/affiliate segments in source text."""
        if not text:
            return False, [], []

        found_keywords: List[str] = []
        matched_line_indices: List[int] = []
        for idx, line in enumerate(text.splitlines()):
            for pat in cls.SPONSOR_PATTERNS:
                m = re.search(pat, line)
                if m:
                    kw_match = re.search(
                        r"(?i)(sponsored\s+by|sponsor|affiliate\s+link|promo\s+code|use\s+code|expressvpn|nordvpn|ag1|athletic\s+greens|squarespace|betterhelp|helix\s+sleep)",
                        line,
                    )
                    kw = kw_match.group(1) if kw_match else "sponsor_block"
                    if kw not in found_keywords:
                        found_keywords.append(kw)
                    if idx not in matched_line_indices:
                        matched_line_indices.append(idx)
                    break

        return len(matched_line_indices) > 0, found_keywords, matched_line_indices

    @classmethod
    def label_sponsor_segments(cls, text: str) -> Tuple[str, bool, List[str]]:
        """Labels detected sponsor/promotional lines without deleting source text."""
        if not text:
            return "", False, []

        has_sponsor, found_keywords, matched_indices = cls.detect_sponsor_segments(text)
        if not has_sponsor:
            return text, False, []

        matched_set = set(matched_indices)
        labeled_lines: List[str] = []
        for idx, line in enumerate(text.splitlines()):
            if idx in matched_set and not line.startswith("[SPONSOR_SEGMENT]"):
                labeled_lines.append(f"[SPONSOR_SEGMENT] {line}")
            else:
                labeled_lines.append(line)
        return "\n".join(labeled_lines), True, found_keywords

    @classmethod
    def remove_sponsor_segments(
        cls,
        text: str,
        authorized: bool = False,
    ) -> Tuple[str, bool, List[str]]:
        """
        Strips sponsor/promo lines ONLY when explicitly authorized by rights policy.
        Raises PermissionError when called without explicit authorization.
        """
        if not authorized:
            raise PermissionError(
                "Removing third-party sponsor/disclosure lines is prohibited unless authorized=True"
            )
        if not text:
            return "", False, []

        has_sponsor, found_keywords, matched_indices = cls.detect_sponsor_segments(text)
        if not has_sponsor:
            return text, False, []

        matched_set = set(matched_indices)
        cleaned_lines = [
            line for idx, line in enumerate(text.splitlines()) if idx not in matched_set
        ]
        cleaned_text = re.sub(r"\n{3,}", "\n\n", "\n".join(cleaned_lines)).strip()
        return cleaned_text, True, found_keywords

    @classmethod
    def purge_sponsor_segments(
        cls,
        text: str,
        authorized: bool = False,
    ) -> Tuple[str, bool, List[str]]:
        """
        Backward-compatible wrapper: detects and labels sponsor segments by default,
        and deletes them ONLY when `authorized=True`.
        """
        if authorized:
            return cls.remove_sponsor_segments(text, authorized=True)
        return cls.label_sponsor_segments(text)
