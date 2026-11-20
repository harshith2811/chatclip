"""Run the production pipeline against an operator-authorized local spoken video."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from yt_clipping.contracts.models import (
    RenderProfile,
    RightsBasis,
    RightsManifest,
    RightsStatus,
)
from yt_clipping.detection.segmenter import ContextAwareSegmenter
from yt_clipping.ingestion.asset_provider import LocalAssetProvider
from yt_clipping.orchestration.pipeline import ClippingPipeline
from yt_clipping.orchestration.state_machine import JobJournal
from yt_clipping.publisher.adapter import DualModeAutopostPublisher
from yt_clipping.qa.verifier import MediaQualityVerifier
from yt_clipping.rendering.renderer import FFmpegRenderer
from yt_clipping.rights.gate import LocalRightsPolicy
from yt_clipping.scoring.scorecard import ExplainableScorecardScorer
from yt_clipping.transcription.transcriber import LocalTranscriber


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--video-id", default="mvpSpeech01")
    parser.add_argument("--workspace", type=Path, default=Path("scratch/mvp_spoken_e2e"))
    args = parser.parse_args()

    source = args.source.resolve()
    workspace = args.workspace.resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    if not source.is_file():
        raise FileNotFoundError(source)

    os.environ["LEGAL_OFFICER"] = "true"
    db_path = str(workspace / "pipeline.db")
    rights = LocalRightsPolicy(str(workspace / "rights.json"), db_path=db_path)
    rights.register_rights(RightsManifest(
        rights_id=f"rights-{args.video_id}",
        video_id=args.video_id,
        basis=RightsBasis.OWNED,
        status=RightsStatus.VERIFIED,
        owner_name="Local MVP verification fixture",
        proof_reference="locally-generated-spoken-source",
        audit_notes="Generated locally for production-pipeline verification.",
    ))

    assets = LocalAssetProvider(str(workspace / "assets"), allow_mock_fallback=False)
    assets.register_asset_path(args.video_id, str(source))
    transcriber = LocalTranscriber(
        cache_dir=str(workspace / "transcripts"), model_size="base",
        device="cpu", compute_type="int8", allow_synthetic=False,
    )
    publisher = DualModeAutopostPublisher(
        mode="watched_folder", watched_dir=str(workspace / "autopost_inbox"),
        receipts_path=str(workspace / "receipts.json"), db_path=db_path,
    )
    pipeline = ClippingPipeline(
        rights_policy=rights,
        asset_provider=assets,
        transcriber=transcriber,
        detector=ContextAwareSegmenter(default_min_duration=15, default_max_duration=40),
        scorer=ExplainableScorecardScorer(),
        renderer=FFmpegRenderer(allow_synthetic=False),
        verifier=MediaQualityVerifier(strict=True),
        publisher=publisher,
        journal=JobJournal(db_path),
        output_dir=str(workspace / "rendered"),
    )
    job = pipeline.process_video(
        video_id=args.video_id,
        profile=RenderProfile(
            name="mvp_vertical_9_16", width=1080, height=1920,
            layout_mode="blur_background", burn_subtitles=True,
            subtitle_preset="hormozi", vcodec="libx264", crf=22,
        ),
        dry_run=True,
        auto_approve_threshold=0,
        min_duration=15,
        max_duration=40,
    )
    result = {
        "job_id": job.job_id,
        "status": job.status.value,
        "stage": job.current_stage.value,
        "candidate": job.candidate.to_dict() if job.candidate else None,
        "rendered_clip": job.rendered_clip.to_dict() if job.rendered_clip else None,
        "qa": job.qa_report.to_dict() if job.qa_report else None,
        "handoff": job.handoff_receipt.to_dict() if job.handoff_receipt else None,
    }
    result_path = workspace / "verification_result.json"
    result_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 0 if result["status"] == "SUCCEEDED" and result["qa"]["status"] == "PASSED" else 1


if __name__ == "__main__":
    raise SystemExit(main())
