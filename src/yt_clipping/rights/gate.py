"""
Rights Policy Enforcement Gate.
Strictly verifies that any source asset has explicit verified rights before entering media retrieval,
transcription, rendering, scheduling, or publishing pipelines.
Enforces strict state transitions, evidence requirements, compliance profiles, revocation propagation,
and an append-only SQLite audit log (rights_audit_log).
"""

from typing import Dict, Optional, List, Any
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from ..contracts.models import (
    RightsManifest,
    RightsStatus,
    RightsBasis,
    VERIFIABLE_RIGHTS_BASES,
    ComplianceProfile,
)
from ..contracts.interfaces import RightsPolicy, RightsPolicyViolationError
from ..orchestration.db import DatabaseManager
from ..config import is_legal_officer_enabled


VALID_STATUS_TRANSITIONS: Dict[RightsStatus, set] = {
    RightsStatus.UNKNOWN: {
        RightsStatus.PENDING_REVIEW,
        RightsStatus.VERIFIED,
        RightsStatus.REJECTED,
        RightsStatus.REVOKED,
    },
    RightsStatus.PENDING_REVIEW: {
        RightsStatus.PENDING_REVIEW,
        RightsStatus.VERIFIED,
        RightsStatus.REJECTED,
        RightsStatus.REVOKED,
        RightsStatus.EXPIRED,
    },
    RightsStatus.VERIFIED: {
        RightsStatus.VERIFIED,
        RightsStatus.PENDING_REVIEW,
        RightsStatus.REJECTED,
        RightsStatus.REVOKED,
        RightsStatus.EXPIRED,
    },
    RightsStatus.REJECTED: {
        RightsStatus.PENDING_REVIEW,
        RightsStatus.VERIFIED,
        RightsStatus.REJECTED,
        RightsStatus.REVOKED,
    },
    RightsStatus.EXPIRED: {
        RightsStatus.PENDING_REVIEW,
        RightsStatus.VERIFIED,
        RightsStatus.REJECTED,
        RightsStatus.REVOKED,
    },
    RightsStatus.REVOKED: {
        RightsStatus.REVOKED,  # Revocation is terminal without an explicit new rights grant audit cycle
    },
}


def get_default_compliance_profile() -> ComplianceProfile:
    raw = (
        os.getenv("RIGHTS_COMPLIANCE_PROFILE")
        or os.getenv("COMPLIANCE_PROFILE")
        or ComplianceProfile.STRICT_LICENSED.value
    ).strip().upper()
    try:
        return ComplianceProfile(raw)
    except ValueError:
        return ComplianceProfile.STRICT_LICENSED


class LocalRightsPolicy(RightsPolicy):
    """
    Durable ledger of authorized video rights records.
    Persists grants to SQLite database with JSON fallback and immutable append-only audit logging.
    """

    def __init__(
        self,
        ledger_path: Optional[str] = None,
        db_path: Optional[str] = None,
        compliance_profile: Optional[ComplianceProfile] = None,
    ):
        self.ledger_path = ledger_path
        if db_path is None:
            if ledger_path:
                db_path = os.path.splitext(ledger_path)[0] + ".db"
            else:
                db_path = "data/jobs.db"
        self.db = DatabaseManager(db_path)
        self.compliance_profile = compliance_profile or get_default_compliance_profile()
        self._manifests: Dict[str, RightsManifest] = {}

        if ledger_path and os.path.exists(ledger_path):
            self._import_from_json(ledger_path)

        self._load_from_db()

    def _import_from_json(self, path: str) -> None:
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                for item in data:
                    manifest = RightsManifest.from_dict(item)
                    # Never import an unverified basis as VERIFIED from untrusted JSON
                    if (
                        manifest.status == RightsStatus.VERIFIED
                        and manifest.basis not in VERIFIABLE_RIGHTS_BASES
                    ):
                        manifest.status = RightsStatus.PENDING_REVIEW
                        manifest.audit_notes = (
                            f"{manifest.audit_notes} [Downgraded: {manifest.basis.value} cannot be VERIFIED]"
                        ).strip()
                    self._upsert_db(manifest)
        except Exception:
            pass

    def _row_to_manifest(self, row: tuple) -> RightsManifest:
        attr_req = {}
        if len(row) > 18 and row[18]:
            try:
                attr_req = json.loads(row[18])
            except Exception:
                attr_req = {}
        return RightsManifest(
            rights_id=row[0],
            video_id=row[1],
            basis=RightsBasis(row[2]),
            status=RightsStatus(row[3]),
            owner_name=row[4],
            license_url=row[5] or "",
            proof_reference=row[6] or "",
            valid_until=row[7],
            verified_at=row[8],
            audit_notes=row[9] or "",
            creator_id=row[10] or "" if len(row) > 10 else "",
            license_id=row[11] or "" if len(row) > 11 else "",
            evidence_type=row[12] or "" if len(row) > 12 else "",
            verified_by=row[13] or "" if len(row) > 13 else "",
            revoked_at=row[14] if len(row) > 14 else None,
            revoked_by=row[15] or "" if len(row) > 15 else "",
            revocation_reason=row[16] or "" if len(row) > 16 else "",
            compliance_profile=row[17] or self.compliance_profile.value if len(row) > 17 else self.compliance_profile.value,
            attribution_requirements=attr_req,
        )

    def _load_from_db(self) -> None:
        conn = self.db.get_connection()
        try:
            cursor = conn.execute(
                """
                SELECT rights_id, video_id, basis, status, owner_name, license_url,
                       proof_reference, valid_until, verified_at, audit_notes,
                       creator_id, license_id, evidence_type, verified_by,
                       revoked_at, revoked_by, revocation_reason, compliance_profile,
                       attribution_requirements_json
                FROM rights_ledger
                """
            )
            for row in cursor.fetchall():
                manifest = self._row_to_manifest(row)
                self._manifests[manifest.video_id] = manifest
        finally:
            conn.close()

    def _upsert_db(self, m: RightsManifest) -> None:
        now_iso = datetime.now(timezone.utc).isoformat()
        conn = self.db.get_connection()
        try:
            with conn:
                conn.execute(
                    """
                    INSERT INTO rights_ledger (
                        rights_id, video_id, basis, status, owner_name, license_url,
                        proof_reference, valid_until, verified_at, audit_notes,
                        creator_id, license_id, evidence_type, verified_by,
                        revoked_at, revoked_by, revocation_reason, compliance_profile,
                        attribution_requirements_json, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(video_id) DO UPDATE SET
                        rights_id=excluded.rights_id,
                        basis=excluded.basis,
                        status=excluded.status,
                        owner_name=excluded.owner_name,
                        license_url=excluded.license_url,
                        proof_reference=excluded.proof_reference,
                        valid_until=excluded.valid_until,
                        verified_at=excluded.verified_at,
                        audit_notes=excluded.audit_notes,
                        creator_id=excluded.creator_id,
                        license_id=excluded.license_id,
                        evidence_type=excluded.evidence_type,
                        verified_by=excluded.verified_by,
                        revoked_at=excluded.revoked_at,
                        revoked_by=excluded.revoked_by,
                        revocation_reason=excluded.revocation_reason,
                        compliance_profile=excluded.compliance_profile,
                        attribution_requirements_json=excluded.attribution_requirements_json,
                        updated_at=excluded.updated_at
                    """,
                    (
                        m.rights_id,
                        m.video_id,
                        m.basis.value,
                        m.status.value,
                        m.owner_name,
                        m.license_url,
                        m.proof_reference,
                        m.valid_until,
                        m.verified_at,
                        m.audit_notes,
                        m.creator_id,
                        m.license_id,
                        m.evidence_type,
                        m.verified_by,
                        m.revoked_at,
                        m.revoked_by,
                        m.revocation_reason,
                        m.compliance_profile,
                        json.dumps(m.attribution_requirements or {}),
                        now_iso,
                        now_iso,
                    ),
                )
        finally:
            conn.close()

    def _record_audit_event(
        self,
        *,
        video_id: str,
        action: str,
        previous_status: Optional[str],
        new_status: str,
        basis: Optional[str] = None,
        rights_id: Optional[str] = None,
        creator_id: Optional[str] = None,
        actor: str = "system",
        reason: str = "",
        evidence_ref: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        audit_id = f"aud_{uuid.uuid4().hex[:14]}"
        now_iso = datetime.now(timezone.utc).isoformat()
        conn = self.db.get_connection()
        try:
            with conn:
                conn.execute(
                    """
                    INSERT INTO rights_audit_log (
                        audit_id, video_id, rights_id, creator_id, action,
                        previous_status, new_status, basis, actor, reason,
                        evidence_ref, metadata_json, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        audit_id,
                        video_id,
                        rights_id,
                        creator_id,
                        action,
                        previous_status,
                        new_status,
                        basis,
                        actor,
                        reason,
                        evidence_ref,
                        json.dumps(metadata or {}),
                        now_iso,
                    ),
                )
        finally:
            conn.close()
        return audit_id

    def get_audit_history(self, video_id: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
        conn = self.db.get_connection()
        try:
            if video_id:
                cur = conn.execute(
                    """
                    SELECT audit_id, video_id, rights_id, creator_id, action,
                           previous_status, new_status, basis, actor, reason,
                           evidence_ref, metadata_json, created_at
                    FROM rights_audit_log
                    WHERE video_id = ?
                    ORDER BY created_at DESC LIMIT ?
                    """,
                    (video_id, limit),
                )
            else:
                cur = conn.execute(
                    """
                    SELECT audit_id, video_id, rights_id, creator_id, action,
                           previous_status, new_status, basis, actor, reason,
                           evidence_ref, metadata_json, created_at
                    FROM rights_audit_log
                    ORDER BY created_at DESC LIMIT ?
                    """,
                    (limit,),
                )
            out = []
            for r in cur.fetchall():
                out.append(
                    {
                        "audit_id": r[0],
                        "video_id": r[1],
                        "rights_id": r[2],
                        "creator_id": r[3],
                        "action": r[4],
                        "previous_status": r[5],
                        "new_status": r[6],
                        "basis": r[7],
                        "actor": r[8],
                        "reason": r[9],
                        "evidence_ref": r[10],
                        "metadata": json.loads(r[11]) if r[11] else {},
                        "created_at": r[12],
                    }
                )
            return out
        finally:
            conn.close()

    def _export_to_json(self) -> None:
        if not self.ledger_path:
            return
        os.makedirs(os.path.dirname(os.path.abspath(self.ledger_path)), exist_ok=True)
        data = [m.to_dict() for m in self._manifests.values()]
        temp_path = f"{self.ledger_path}.tmp"
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(temp_path, self.ledger_path)

    @staticmethod
    def _validate_evidence_for_verified(manifest: RightsManifest, explicit_declaration: bool = False) -> None:
        if manifest.basis not in VERIFIABLE_RIGHTS_BASES:
            raise RightsPolicyViolationError(
                f"Rights basis '{manifest.basis.value}' cannot be transitioned to VERIFIED. "
                f"Supported verified bases: {[b.value for b in VERIFIABLE_RIGHTS_BASES]}."
            )
        has_evidence = bool((manifest.proof_reference or "").strip() or (manifest.license_url or "").strip())
        if manifest.basis in (
            RightsBasis.EXPLICIT_PERMISSION,
            RightsBasis.CREATIVE_COMMONS,
            RightsBasis.VERIFIED_LICENSE,
        ) and not has_evidence:
            raise RightsPolicyViolationError(
                f"Basis '{manifest.basis.value}' requires supporting evidence (proof_reference or license_url)."
            )
        if manifest.basis == RightsBasis.OWNED and explicit_declaration and not (has_evidence or manifest.verified_by):
            raise RightsPolicyViolationError(
                "Basis 'OWNED' requires explicit rights declaration (proof_reference or verified_by operator)."
            )
        if not (manifest.owner_name or "").strip() or manifest.owner_name.strip().lower() in ("unknown", "studio operator"):
            if manifest.basis != RightsBasis.OWNED or explicit_declaration:
                raise RightsPolicyViolationError(
                    "Verified rights manifest must identify the actual rights owner or creator."
                )

    def register_rights(
        self,
        manifest: Optional[RightsManifest] = None,
        *,
        video_id: Optional[str] = None,
        basis: Optional[Any] = None,
        owner: Optional[str] = None,
        audit_notes: Optional[str] = None,
        status: Optional[Any] = None,
        proof_reference: Optional[str] = None,
        license_url: Optional[str] = None,
        license_id: Optional[str] = None,
        creator_id: Optional[str] = None,
        evidence_type: Optional[str] = None,
        verified_by: Optional[str] = None,
        valid_until: Optional[str] = None,
        allow_regrant_revoked: bool = False,
        **kwargs,
    ) -> RightsManifest:
        """
        Registers and durably persists a rights manifest for a video with strict state-transition
        and evidence validation. Never auto-verifies arbitrary OPERATOR_ASSET claims.
        """
        now_iso = datetime.now(timezone.utc).isoformat()
        explicit_api_call = manifest is None

        if manifest is None:
            if not video_id:
                raise ValueError("Either manifest or video_id must be provided to register_rights.")

            if basis is None:
                basis_val = RightsBasis.OPERATOR_ASSET
            elif isinstance(basis, RightsBasis):
                basis_val = basis
            elif isinstance(basis, str):
                basis_val = RightsBasis(basis)
            else:
                raise ValueError(f"Unsupported rights basis: {basis}")

            if status is None:
                # Default to PENDING_REVIEW unless a verifiable basis AND evidence are explicitly verified
                status_val = RightsStatus.PENDING_REVIEW
            elif isinstance(status, RightsStatus):
                status_val = status
            elif isinstance(status, str):
                status_val = RightsStatus(status)
            else:
                raise ValueError(f"Unsupported rights status: {status}")

            manifest = RightsManifest(
                rights_id=f"rights_{video_id}_{uuid.uuid4().hex[:6]}",
                video_id=video_id,
                basis=basis_val,
                status=status_val,
                owner_name=owner or "Unknown",
                creator_id=creator_id or "",
                license_id=license_id or "",
                license_url=license_url or "",
                proof_reference=proof_reference or "",
                evidence_type=evidence_type or "",
                valid_until=valid_until,
                verified_at=now_iso if status_val == RightsStatus.VERIFIED else None,
                verified_by=verified_by or "",
                compliance_profile=self.compliance_profile.value,
                audit_notes=audit_notes or "",
            )

        existing = self._load_manifest_from_db(manifest.video_id)
        prev_status = existing.status.value if existing else RightsStatus.UNKNOWN.value

        # Enforce revocation permanence unless explicit re-grant cycle is declared with verified evidence
        if existing and existing.status == RightsStatus.REVOKED and not allow_regrant_revoked:
            raise RightsPolicyViolationError(
                f"Rights for video '{manifest.video_id}' were REVOKED ({existing.revocation_reason or 'no reason recorded'}). "
                f"Cannot modify revoked record without explicit re-grant clearance."
            )

        # Enforce allowed state transitions
        if existing:
            allowed_next = VALID_STATUS_TRANSITIONS.get(existing.status, set())
            if manifest.status not in allowed_next and not (allow_regrant_revoked and existing.status == RightsStatus.REVOKED):
                raise RightsPolicyViolationError(
                    f"Illegal rights state transition for '{manifest.video_id}': {existing.status.value} -> {manifest.status.value}."
                )

        # Enforce verification rules when targeting VERIFIED
        if manifest.status == RightsStatus.VERIFIED:
            self._validate_evidence_for_verified(manifest, explicit_declaration=explicit_api_call)
            if not manifest.verified_at:
                manifest.verified_at = now_iso

        # Check expiration at registration time
        if manifest.status == RightsStatus.VERIFIED and manifest.valid_until:
            try:
                dt = datetime.fromisoformat(manifest.valid_until.replace("Z", "+00:00"))
                if datetime.now(timezone.utc) > dt:
                    # Preserve supplied status if caller is explicitly storing historical expired manifest for gate testing,
                    # otherwise verify_rights() will catch expiration at evaluation time.
                    pass
            except ValueError:
                raise RightsPolicyViolationError(f"Malformed valid_until timestamp: {manifest.valid_until}")

        self._manifests[manifest.video_id] = manifest
        self._upsert_db(manifest)
        self._export_to_json()
        self._record_audit_event(
            video_id=manifest.video_id,
            rights_id=manifest.rights_id,
            creator_id=manifest.creator_id,
            action="REGISTER_RIGHTS",
            previous_status=prev_status,
            new_status=manifest.status.value,
            basis=manifest.basis.value,
            actor=manifest.verified_by or "operator",
            reason=manifest.audit_notes or "Rights manifest updated.",
            evidence_ref=manifest.proof_reference or manifest.license_url,
            metadata={"owner_name": manifest.owner_name, "evidence_type": manifest.evidence_type},
        )
        return manifest

    def _load_manifest_from_db(self, video_id: str) -> Optional[RightsManifest]:
        conn = self.db.get_connection()
        try:
            cursor = conn.execute(
                """
                SELECT rights_id, video_id, basis, status, owner_name, license_url,
                       proof_reference, valid_until, verified_at, audit_notes,
                       creator_id, license_id, evidence_type, verified_by,
                       revoked_at, revoked_by, revocation_reason, compliance_profile,
                       attribution_requirements_json
                FROM rights_ledger WHERE video_id = ?
                """,
                (video_id,),
            )
            row = cursor.fetchone()
            if row:
                manifest = self._row_to_manifest(row)
                self._manifests[video_id] = manifest
                return manifest
            return None
        finally:
            conn.close()

    def check_rights(self, video_id: str) -> RightsManifest:
        """
        Retrieves the latest rights manifest for a video directly from SQLite database.
        If no manifest exists, returns a default PENDING_REVIEW manifest (never VERIFIED).
        """
        db_manifest = self._load_manifest_from_db(video_id)
        if db_manifest:
            return db_manifest

        if video_id in self._manifests:
            return self._manifests[video_id]

        return RightsManifest(
            rights_id=f"rights-pending-{video_id}",
            video_id=video_id,
            basis=RightsBasis.OPERATOR_ASSET,
            status=RightsStatus.PENDING_REVIEW,
            owner_name="Unknown",
            compliance_profile=self.compliance_profile.value,
            audit_notes="No verified rights record on file. Processing blocked.",
        )

    def verify_rights(
        self,
        manifest: RightsManifest,
        profile: Optional[ComplianceProfile] = None,
    ) -> bool:
        """
        Returns True strictly if the manifest is VERIFIED, uses a verifiable rights basis
        (OWNED, EXPLICIT_PERMISSION, CREATIVE_COMMONS, VERIFIED_LICENSE), is not REVOKED,
        and is unexpired.
        """
        if not manifest:
            return False
        if manifest.revoked_at or manifest.status == RightsStatus.REVOKED:
            return False
        if manifest.status != RightsStatus.VERIFIED:
            return False
        if manifest.basis not in VERIFIABLE_RIGHTS_BASES:
            return False
        if manifest.valid_until:
            try:
                dt = datetime.fromisoformat(manifest.valid_until.replace("Z", "+00:00"))
                if datetime.now(timezone.utc) > dt:
                    return False
            except ValueError:
                return False
        return True

    def _record_legal_bypass(
        self,
        video_id: str,
        stage: str,
        manifest: RightsManifest,
        actor: str = "legal_officer_toggle",
    ) -> None:
        """Records an honest LEGAL_OFFICER_BYPASS audit entry without mutating status to VERIFIED."""
        now_iso = datetime.now(timezone.utc).isoformat()
        eff_status = manifest.effective_status().value
        try:
            conn = self.db.get_connection()
            try:
                with conn:
                    conn.execute(
                        """
                        INSERT INTO rights_audit_log (
                            audit_id, video_id, rights_id, creator_id, action,
                            previous_status, new_status, basis, actor, reason,
                            evidence_ref, metadata_json, created_at
                        ) VALUES (?, ?, ?, ?, 'LEGAL_OFFICER_BYPASS', ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            f"aud_{uuid.uuid4().hex[:14]}",
                            video_id,
                            manifest.rights_id,
                            manifest.creator_id or "",
                            eff_status,
                            eff_status,
                            manifest.basis.value,
                            actor,
                            f"LEGAL_OFFICER=false bypass at stage '{stage}' (actual status preserved).",
                            manifest.proof_reference or manifest.license_url or "",
                            json.dumps({"stage": stage, "legal_officer": False}),
                            now_iso,
                        ),
                    )
            finally:
                conn.close()
        except Exception:
            pass

    def assert_can_process(
        self,
        video_id: str,
        stage: str = "processing",
        profile: Optional[ComplianceProfile] = None,
    ) -> RightsManifest:
        """
        Always checks fresh DB state and raises RightsPolicyViolationError if the video
        lacks verified rights for the requested execution stage (unless LEGAL_OFFICER=false).
        """
        active_profile = profile or self.compliance_profile
        manifest = self.check_rights(video_id)

        if not is_legal_officer_enabled():
            self._record_legal_bypass(video_id, stage, manifest)
            return manifest

        if manifest.status == RightsStatus.REVOKED or manifest.revoked_at:
            raise RightsPolicyViolationError(
                f"Rights REVOKED for video '{video_id}' during stage '{stage}'. "
                f"Reason: {manifest.revocation_reason or manifest.audit_notes}"
            )

        if not self.verify_rights(manifest, profile=active_profile):
            eff = manifest.effective_status()
            raise RightsPolicyViolationError(
                f"Rights Policy Violation ({active_profile.value}) at stage '{stage}': "
                f"Video '{video_id}' has rights status '{eff.value}' and basis '{manifest.basis.value}'. "
                f"Must be 'VERIFIED' with valid license/ownership evidence. Notes: {manifest.audit_notes}"
            )
        return manifest

    def can_analyze_metadata(self, video_id: str, profile: Optional[ComplianceProfile] = None) -> bool:
        """
        In REVIEW_REQUIRED or COMMENTARY_REVIEW profiles, metadata/preview analysis
        is allowed (subject to not being REVOKED or REJECTED), but publishing remains blocked.
        """
        active_profile = profile or self.compliance_profile
        manifest = self.check_rights(video_id)
        if manifest.status in (RightsStatus.REVOKED, RightsStatus.REJECTED):
            return False
        if self.verify_rights(manifest, profile=active_profile):
            return True
        return active_profile in (ComplianceProfile.REVIEW_REQUIRED, ComplianceProfile.COMMENTARY_REVIEW)

    def assert_can_publish(
        self,
        video_id: str,
        *,
        manifest: Optional[RightsManifest] = None,
        approved_by_user: bool = False,
        attribution_validated: bool = False,
        profile: Optional[ComplianceProfile] = None,
    ) -> RightsManifest:
        """
        Independent final publishing boundary validation (Part 1.3 & 4.3).
        Re-reads durable database ledger to detect mid-flight revocation or expiration.
        """
        active_profile = profile or self.compliance_profile
        fresh_manifest = self._load_manifest_from_db(video_id)
        target = fresh_manifest or manifest or self.check_rights(video_id)

        if not approved_by_user:
            raise RightsPolicyViolationError("Publishing blocked: Explicit human approval is mandatory.")

        if not is_legal_officer_enabled():
            self._record_legal_bypass(video_id, "publish", target)
            return target

        if target.status == RightsStatus.REVOKED or target.revoked_at:
            raise RightsPolicyViolationError(
                f"Publishing blocked: Rights for '{video_id}' have been REVOKED ({target.revocation_reason})."
            )

        # Even if caller passed an in-memory manifest, ledger rejection/revocation overrides
        if fresh_manifest and fresh_manifest.status in (RightsStatus.REVOKED, RightsStatus.REJECTED, RightsStatus.EXPIRED):
            raise RightsPolicyViolationError(
                f"Publishing blocked: Ledger status for '{video_id}' is {fresh_manifest.status.value}."
            )

        if not self.verify_rights(target, profile=active_profile):
            raise RightsPolicyViolationError(
                f"Publishing blocked ({active_profile.value}): Video '{video_id}' has status "
                f"'{target.effective_status().value}' (basis={target.basis.value})."
            )

        if not attribution_validated:
            raise RightsPolicyViolationError(
                f"Publishing blocked: Mandatory attribution & source validation missing for '{video_id}'."
            )
        return target

    def revoke_rights(
        self,
        *,
        video_id: Optional[str] = None,
        creator_id: Optional[str] = None,
        reason: str = "Permission revoked by rights holder or operator",
        actor: str = "operator",
    ) -> Dict[str, Any]:
        """
        Implements Part 1.4 Rights Revocation:
        - Marks matching rights manifests as REVOKED.
        - Stops future processing & cancels pending/in-progress jobs where possible.
        - Records affected outputs & publications for operator review.
        - Preserves immutable audit history (does NOT auto-delete remote posts).
        """
        if not video_id and not creator_id:
            raise ValueError("Either video_id or creator_id must be provided to revoke_rights.")

        now_iso = datetime.now(timezone.utc).isoformat()
        target_videos: List[str] = []
        conn = self.db.get_connection()
        cancelled_jobs: List[str] = []
        flagged_receipts: List[str] = []

        try:
            with conn:
                # 1. Identify matching videos in rights_ledger
                if video_id:
                    target_videos.append(video_id)
                if creator_id:
                    cur = conn.execute(
                        "SELECT video_id FROM rights_ledger WHERE creator_id = ? OR owner_name = ?",
                        (creator_id, creator_id),
                    )
                    for row in cur.fetchall():
                        if row[0] not in target_videos:
                            target_videos.append(row[0])

                    # Revoke creator in creator_registry as well
                    conn.execute(
                        """
                        UPDATE creator_registry
                        SET policy = 'STRICT_COPYRIGHT', approval_status = 'REVOKED', revoked_at = ?, revocation_reason = ?, updated_at = ?
                        WHERE creator_key = ? OR creator_id = ? OR channel_id = ? OR creator_handle = ? OR handle = ?
                        """,
                        (now_iso, reason, now_iso, creator_id, creator_id, creator_id, creator_id, creator_id),
                    )
                    conn.execute(
                        """
                        UPDATE creator_permissions
                        SET policy_type = 'STRICT_COPYRIGHT', allowed_commercial = 0, notes = ?, updated_at = ?
                        WHERE channel_id = ? OR channel_name = ?
                        """,
                        (f"REVOKED: {reason}", now_iso, creator_id, creator_id),
                    )

                for vid in target_videos:
                    prev_m = self._load_manifest_from_db(vid)
                    prev_status = prev_m.status.value if prev_m else RightsStatus.UNKNOWN.value
                    if prev_m:
                        prev_m.status = RightsStatus.REVOKED
                        prev_m.revoked_at = now_iso
                        prev_m.revoked_by = actor
                        prev_m.revocation_reason = reason
                        prev_m.audit_notes = f"REVOKED ({now_iso}): {reason}"
                        self._manifests[vid] = prev_m
                        conn.execute(
                            """
                            UPDATE rights_ledger
                            SET status = 'REVOKED', revoked_at = ?, revoked_by = ?,
                                revocation_reason = ?, audit_notes = ?, updated_at = ?
                            WHERE video_id = ?
                            """,
                            (now_iso, actor, reason, prev_m.audit_notes, now_iso, vid),
                        )
                    else:
                        revoked_m = RightsManifest(
                            rights_id=f"rights-revoked-{vid}",
                            video_id=vid,
                            basis=RightsBasis.OPERATOR_ASSET,
                            status=RightsStatus.REVOKED,
                            owner_name=creator_id or "Revoked",
                            creator_id=creator_id or "",
                            revoked_at=now_iso,
                            revoked_by=actor,
                            revocation_reason=reason,
                            audit_notes=f"REVOKED ({now_iso}): {reason}",
                        )
                        self._manifests[vid] = revoked_m
                        conn.execute(
                            """
                            INSERT OR REPLACE INTO rights_ledger (
                                rights_id, video_id, basis, status, owner_name, creator_id,
                                revoked_at, revoked_by, revocation_reason, audit_notes,
                                created_at, updated_at
                            ) VALUES (?, ?, ?, 'REVOKED', ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                revoked_m.rights_id,
                                vid,
                                revoked_m.basis.value,
                                revoked_m.owner_name,
                                revoked_m.creator_id,
                                now_iso,
                                actor,
                                reason,
                                revoked_m.audit_notes,
                                now_iso,
                                now_iso,
                            ),
                        )

                    # 2. Cancel pending/in-progress pipeline jobs
                    cur_jobs = conn.execute(
                        "SELECT job_id, status FROM jobs WHERE video_id = ? AND status IN ('PENDING', 'IN_PROGRESS', 'RETRY_PENDING', 'REVIEW_REQUIRED')",
                        (vid,),
                    )
                    for jrow in cur_jobs.fetchall():
                        jid = jrow[0]
                        conn.execute(
                            "UPDATE jobs SET status = 'REVOKED', current_stage = 'REVOKED', error_message = ?, updated_at = ? WHERE job_id = ?",
                            (f"Rights revoked: {reason}", now_iso, jid),
                        )
                        cancelled_jobs.append(jid)
                        conn.execute(
                            """
                            INSERT INTO revocation_impacts (
                                impact_id, video_id, creator_id, target_type, target_id,
                                action_taken, review_required, notes, created_at
                            ) VALUES (?, ?, ?, 'job', ?, 'CANCELLED_PENDING_JOB', 1, ?, ?)
                            """,
                            (f"imp_{uuid.uuid4().hex[:12]}", vid, creator_id, jid, reason, now_iso),
                        )

                    # 3. Record existing publications / receipts for manual operator review (never auto-delete)
                    cur_rcpts = conn.execute(
                        """
                        SELECT receipt_id, clip_id, status FROM publishing_receipts
                        WHERE clip_id LIKE ? OR response_payload_json LIKE ?
                        """,
                        (f"%{vid}%", f"%{vid}%"),
                    )
                    for rrow in cur_rcpts.fetchall():
                        rid = rrow[0]
                        flagged_receipts.append(rid)
                        conn.execute(
                            """
                            INSERT INTO revocation_impacts (
                                impact_id, video_id, creator_id, target_type, target_id,
                                action_taken, review_required, notes, created_at
                            ) VALUES (?, ?, ?, 'publication_receipt', ?, 'MARKED_FOR_OPERATOR_REVIEW', 1, ?, ?)
                            """,
                            (f"imp_{uuid.uuid4().hex[:12]}", vid, creator_id, rid, reason, now_iso),
                        )

                    # 4. Update asset_manifests if present
                    conn.execute(
                        "UPDATE asset_manifests SET rights_status = 'REVOKED', approval_status = 'REVOKED', updated_at = ? WHERE source_id = ?",
                        (now_iso, vid),
                    )

                    # 5. Append immutable audit log
                    conn.execute(
                        """
                        INSERT INTO rights_audit_log (
                            audit_id, video_id, rights_id, creator_id, action,
                            previous_status, new_status, basis, actor, reason,
                            evidence_ref, metadata_json, created_at
                        ) VALUES (?, ?, ?, ?, 'REVOKE_RIGHTS', ?, 'REVOKED', ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            f"aud_{uuid.uuid4().hex[:14]}",
                            vid,
                            self._manifests[vid].rights_id if vid in self._manifests else None,
                            creator_id,
                            prev_status,
                            self._manifests[vid].basis.value if vid in self._manifests else RightsBasis.OPERATOR_ASSET.value,
                            actor,
                            reason,
                            "",
                            json.dumps({"cancelled_jobs": cancelled_jobs, "flagged_receipts": flagged_receipts}),
                            now_iso,
                        ),
                    )
        finally:
            conn.close()

        self._export_to_json()
        return {
            "revoked_videos": target_videos,
            "creator_id": creator_id,
            "cancelled_jobs": cancelled_jobs,
            "flagged_publications": flagged_receipts,
            "reason": reason,
            "revoked_at": now_iso,
        }

    def list_revocation_impacts(self, limit: int = 100) -> List[Dict[str, Any]]:
        conn = self.db.get_connection()
        try:
            cur = conn.execute(
                """
                SELECT impact_id, video_id, creator_id, target_type, target_id,
                       action_taken, review_required, notes, created_at
                FROM revocation_impacts ORDER BY created_at DESC LIMIT ?
                """,
                (limit,),
            )
            return [
                {
                    "impact_id": r[0],
                    "video_id": r[1],
                    "creator_id": r[2],
                    "target_type": r[3],
                    "target_id": r[4],
                    "action_taken": r[5],
                    "review_required": bool(r[6]),
                    "notes": r[7],
                    "created_at": r[8],
                }
                for r in cur.fetchall()
            ]
        finally:
            conn.close()

    def list_all_manifests(self) -> List[RightsManifest]:
        """Returns all persistent rights records."""
        self._load_from_db()
        return list(self._manifests.values())
