"""
Rights ledger registration, revocation, creator approvals, and legal officer compliance router.
"""

from __future__ import annotations
from typing import Dict, Optional, Any
import os
import logging

from fastapi import APIRouter, HTTPException

from ...config import is_legal_officer_enabled
from ...rights.gate import LocalRightsPolicy
from ...discovery.attribution_engine import AttributionEngine, CreatorPolicy
from ..schemas import (
    RightsRegisterRequest,
    RightsRevokeRequest,
    CreatorApproveRequest,
    CreatorRevokeRequest,
)
from ..state import (
    DATA_DIR,
    DB_PATH,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Rights"])


@router.post("/api/v1/rights/register")
def api_rights_register(req: RightsRegisterRequest) -> Dict[str, Any]:
    """Registers evidence-backed rights metadata (never allows OPERATOR_ASSET to verify)."""
    policy = LocalRightsPolicy(os.path.join(DATA_DIR, "rights_ledger.json"), db_path=DB_PATH)
    try:
        manifest = policy.register_rights(
            video_id=req.video_id,
            basis=req.basis,
            owner=req.owner,
            status=req.status,
            proof_reference=req.proof_reference,
            license_url=req.license_url,
            license_id=req.license_id,
            creator_id=req.creator_id,
            evidence_type=req.evidence_type,
            verified_by=req.verified_by,
            valid_until=req.valid_until,
            audit_notes=req.audit_notes,
            allow_regrant_revoked=req.allow_regrant_revoked,
        )
        return {
            "success": True,
            "rights_id": manifest.rights_id,
            "video_id": manifest.video_id,
            "basis": manifest.basis.value,
            "status": manifest.effective_status().value,
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/api/v1/rights/revoke")
def api_rights_revoke(req: RightsRevokeRequest) -> Dict[str, Any]:
    """Revokes rights for a video or creator and cascades holds to pending jobs & receipts."""
    policy = LocalRightsPolicy(os.path.join(DATA_DIR, "rights_ledger.json"), db_path=DB_PATH)
    try:
        res = policy.revoke_rights(
            video_id=req.video_id,
            creator_id=req.creator_id,
            reason=req.reason,
            actor=req.actor,
        )
        return {"success": True, **res}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/api/v1/rights/audit")
def api_rights_audit(video_id: Optional[str] = None, limit: int = 100) -> Dict[str, Any]:
    """Returns append-only immutable rights transition history."""
    policy = LocalRightsPolicy(os.path.join(DATA_DIR, "rights_ledger.json"), db_path=DB_PATH)
    history = policy.get_audit_history(video_id=video_id, limit=limit)
    return {"count": len(history), "entries": history}


@router.post("/api/v1/creators/approve")
def api_creators_approve(req: CreatorApproveRequest) -> Dict[str, Any]:
    """Approves a creator/channel in SQLite creator_registry with mandatory evidence."""
    engine = AttributionEngine(db_path=DB_PATH)
    try:
        pol = CreatorPolicy(req.policy)
        rec = engine.approve_creator(
            channel_id=req.channel_id,
            channel_name=req.channel_name,
            policy=pol,
            approval_evidence=req.approval_evidence,
            creator_handle=req.creator_handle,
            approved_by=req.approved_by,
            expires_at=req.expires_at,
            notes=req.notes,
        )
        return {"success": True, "creator": rec}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/api/v1/creators/revoke")
def api_creators_revoke(req: CreatorRevokeRequest) -> Dict[str, Any]:
    """Revokes a creator's clipping permission immediately."""
    engine = AttributionEngine(db_path=DB_PATH)
    try:
        rec = engine.revoke_creator(channel_id=req.channel_id, reason=req.reason, revoked_by=req.revoked_by)
        return {"success": True, "creator": rec}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/api/v1/creators/{channel_id}")
def api_creators_get(channel_id: str) -> Dict[str, Any]:
    """Inspects creator policy & approval status."""
    engine = AttributionEngine(db_path=DB_PATH)
    policy = engine.get_creator_policy(channel_id)
    record = engine.get_creator_record(channel_id)
    return {"channel_id": channel_id, "policy": policy.value, "record": record}


@router.get("/api/v1/config/legal-officer")
async def api_get_legal_officer() -> Dict[str, Any]:
    """Returns the live state of the master Legal Officer switch."""
    enabled = is_legal_officer_enabled()
    return {
        "enabled": enabled,
        "mode": "STRICT_COMPLIANCE" if enabled else "UNRESTRICTED_BYPASS",
        "description": "When active, copyright, creator attribution, and rights ledger checks are strictly enforced. When disabled, content bypasses legal barriers with an UNVERIFIED_BYPASS audit log.",
    }


@router.post("/api/v1/config/legal-officer")
async def api_set_legal_officer(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Dynamically toggles the master Legal Officer switch at runtime."""
    enabled = bool(payload.get("enabled", True))
    os.environ["LEGAL_OFFICER"] = "true" if enabled else "false"
    logger.info(f"[Legal Officer Toggle] Master switch updated to: {enabled}")
    return {
        "success": True,
        "enabled": is_legal_officer_enabled(),
        "mode": "STRICT_COMPLIANCE" if is_legal_officer_enabled() else "UNRESTRICTED_BYPASS",
    }
