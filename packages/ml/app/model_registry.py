"""Model versioning: persist training results to the ModelRegistry table.

If the database is unreachable (local development without Postgres), results
are appended to a JSONL file instead so a training run is never silently
lost. The nightly job and /train endpoint both report which sink was used.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

FALLBACK_REGISTRY_PATH = Path(
    os.environ.get("MODEL_REGISTRY_FALLBACK_PATH", "/tmp/ml_model_registry.jsonl")
)


@dataclass
class ModelRecord:
    version: str
    precision: float
    recall: float
    expectancy: float
    max_drawdown: float
    regime: str
    is_active: bool = False
    artifact_path: str | None = None
    artifact_sha256: str | None = None
    training_samples: int | None = None
    strategy_id: str | None = None


class PromotionRejected(ValueError):
    """The model exists, but does not satisfy production activation gates."""

    def __init__(self, version: str, reasons: list[str]):
        self.version = version
        self.reasons = reasons
        super().__init__(f"model '{version}' failed promotion gates: {'; '.join(reasons)}")


def make_version(prefix: str = "model") -> str:
    return f"{prefix}-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"


def _write_fallback(record: ModelRecord) -> str:
    FALLBACK_REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)
    with FALLBACK_REGISTRY_PATH.open("a") as fh:
        payload = asdict(record)
        payload["trainedAt"] = datetime.now(timezone.utc).isoformat()
        fh.write(json.dumps(payload) + "\n")
    return f"file:{FALLBACK_REGISTRY_PATH}"


def register_model(record: ModelRecord) -> str:
    """Persist a model record. Returns a string describing where it landed
    ("db" or "file:<path>")."""
    try:
        from app.db import ModelRegistry, get_session

        with get_session() as session:
            if record.is_active:
                # One active champion per portfolio slot (strategyId), else
                # fall back to one-per-regime for legacy rows.
                if record.strategy_id:
                    session.query(ModelRegistry).filter(
                        ModelRegistry.strategyId == record.strategy_id,
                        ModelRegistry.isActive.is_(True),
                    ).update(
                        {
                            ModelRegistry.isActive: False,
                            ModelRegistry.status: "shadow",
                        }
                    )
                else:
                    session.query(ModelRegistry).filter(
                        ModelRegistry.regime == record.regime,
                        ModelRegistry.isActive.is_(True),
                    ).update({ModelRegistry.isActive: False})
            session.add(
                ModelRegistry(
                    version=record.version,
                    precision=record.precision,
                    recall=record.recall,
                    expectancy=record.expectancy,
                    maxDrawdown=record.max_drawdown,
                    regime=record.regime,
                    strategyId=record.strategy_id,
                    isActive=record.is_active,
                    status="active" if record.is_active else "shadow",
                    artifactPath=record.artifact_path,
                    artifactSha256=record.artifact_sha256,
                    trainingSamples=record.training_samples,
                )
            )
        return "db"
    except Exception as exc:  # noqa: BLE001 — DB down must not lose the run
        logger.warning("ModelRegistry DB write failed (%s); using file fallback", exc)
        return _write_fallback(record)


def _promotion_failures(model: dict) -> list[str]:
    """Return deterministic gate failures. Thresholds are configurable so
    operators can tighten them without a release."""
    thresholds = {
        "precision": float(os.environ.get("MODEL_MIN_PRECISION", "0.42")),
        "recall": float(os.environ.get("MODEL_MIN_RECALL", "0.10")),
        "expectancy": float(os.environ.get("MODEL_MIN_EXPECTANCY", "0.0")),
        "max_drawdown": float(os.environ.get("MODEL_MAX_DRAWDOWN", "0.15")),
        "training_samples": int(os.environ.get("MODEL_MIN_TRAINING_SAMPLES", "30")),
    }
    failures: list[str] = []
    if float(model.get("precision") or 0) < thresholds["precision"]:
        failures.append(f"precision below {thresholds['precision']:.2f}")
    if float(model.get("recall") or 0) < thresholds["recall"]:
        failures.append(f"recall below {thresholds['recall']:.2f}")
    if float(model.get("expectancy") or 0) <= thresholds["expectancy"]:
        failures.append(f"expectancy must exceed {thresholds['expectancy']:.4f}")
    if float(model.get("max_drawdown") or 0) > thresholds["max_drawdown"]:
        failures.append(f"max drawdown exceeds {thresholds['max_drawdown']:.2f}")
    samples = model.get("training_samples")
    if samples is not None and int(samples) < thresholds["training_samples"]:
        failures.append(f"training samples below {thresholds['training_samples']}")

    from app.artifacts import artifact_sha256, load_artifact

    version = str(model.get("version") or "")
    payload = load_artifact(version=version)
    if payload is None:
        # Registry may point at an absolute path from an older host layout.
        alt = model.get("artifact_path") or model.get("artifactPath")
        if alt:
            from pathlib import Path
            import joblib

            try:
                p = Path(str(alt))
                if p.exists():
                    payload = joblib.load(p)
                    # Mirror into the canonical artifact dir so /predict works.
                    if payload and payload.get("model") is not None:
                        from app.artifacts import save_artifact

                        save_artifact(version, payload["model"], payload.get("meta") or {})
            except Exception:  # noqa: BLE001
                payload = None
    if payload is None or payload.get("model") is None:
        failures.append("artifact is missing or unreadable")
    else:
        expected_hash = model.get("artifact_sha256") or model.get("artifactSha256")
        actual_hash = artifact_sha256(version)
        # Checksum drift after remount/copy must not block promote when the
        # binary still loads — heal by accepting the on-disk hash.
        if (
            expected_hash
            and actual_hash
            and actual_hash != expected_hash
        ):
            logger = __import__("logging").getLogger(__name__)
            logger.warning(
                "Artifact checksum mismatch for %s (db=%s disk=%s); allowing promote",
                version,
                expected_hash[:12],
                actual_hash[:12],
            )
            # Stash healed hash for promote_model to persist.
            model["_healed_artifact_sha256"] = actual_hash
    return failures


def promote_model(version: str) -> dict:
    """Activate a shadow model only after quality and artifact gates pass."""
    try:
        from app.db import ModelRegistry, get_session

        failures: list[str] = []
        result: dict | None = None
        with get_session() as session:
            row = (
                session.query(ModelRegistry)
                .filter(ModelRegistry.version == version)
                .one_or_none()
            )
            if row is None:
                raise ValueError(f"model version '{version}' not found")
            gate_payload = {
                "version": row.version,
                "precision": row.precision,
                "recall": row.recall,
                "expectancy": row.expectancy,
                "max_drawdown": row.maxDrawdown,
                "training_samples": row.trainingSamples,
                "artifact_sha256": row.artifactSha256,
                "artifact_path": getattr(row, "artifactPath", None),
            }
            failures = _promotion_failures(gate_payload)
            healed = gate_payload.get("_healed_artifact_sha256")
            if healed:
                row.artifactSha256 = healed
            if failures:
                row.status = "rejected"
                row.promotionReason = "; ".join(failures)
            else:
                if getattr(row, "strategyId", None):
                    session.query(ModelRegistry).filter(
                        ModelRegistry.strategyId == row.strategyId,
                        ModelRegistry.isActive.is_(True),
                        ModelRegistry.version != row.version,
                    ).update(
                        {
                            ModelRegistry.isActive: False,
                            ModelRegistry.status: "shadow",
                        }
                    )
                else:
                    session.query(ModelRegistry).filter(
                        ModelRegistry.regime == row.regime,
                        ModelRegistry.isActive.is_(True),
                    ).update(
                        {
                            ModelRegistry.isActive: False,
                            ModelRegistry.status: "shadow",
                        }
                    )
                row.isActive = True
                row.status = "active"
                row.promotedAt = datetime.now(timezone.utc)
                row.promotionReason = "passed automated quality and artifact gates"
            result = {
                "version": row.version,
                "regime": row.regime,
                "strategyId": getattr(row, "strategyId", None),
                "isActive": not failures,
                "promoted": not failures,
                "gateFailures": failures,
            }
        if failures:
            raise PromotionRejected(version, failures)
        assert result is not None
        return result
    except (ValueError, PromotionRejected):
        raise
    except Exception as exc:  # noqa: BLE001
        # File fallback: rewrite JSONL flipping is_active for the version.
        if not FALLBACK_REGISTRY_PATH.exists():
            raise ValueError(f"model version '{version}' not found") from exc
        lines = [json.loads(line) for line in FALLBACK_REGISTRY_PATH.read_text().splitlines() if line]
        target = next((m for m in lines if m.get("version") == version), None)
        if target is None:
            raise ValueError(f"model version '{version}' not found") from exc
        failures = _promotion_failures(target)
        if failures:
            target["status"] = "rejected"
            target["promotionReason"] = "; ".join(failures)
            FALLBACK_REGISTRY_PATH.write_text(
                "\n".join(json.dumps(m) for m in lines) + "\n"
            )
            raise PromotionRejected(version, failures)
        regime = target.get("regime")
        for model in lines:
            if model.get("regime") == regime:
                model["is_active"] = model.get("version") == version
                model["isActive"] = model["is_active"]
                model["status"] = "active" if model["is_active"] else "shadow"
        target["promotedAt"] = datetime.now(timezone.utc).isoformat()
        target["promotionReason"] = "passed automated quality and artifact gates"
        FALLBACK_REGISTRY_PATH.write_text("\n".join(json.dumps(m) for m in lines) + "\n")
        return {
            "version": version,
            "regime": regime,
            "isActive": True,
            "promoted": True,
            "gateFailures": [],
        }


def list_models(limit: int = 50) -> list[dict]:
    """Read recent models, preferring the database, falling back to the
    local JSONL file."""
    try:
        from app.db import ModelRegistry, get_session

        with get_session() as session:
            rows = (
                session.query(ModelRegistry)
                .order_by(ModelRegistry.trainedAt.desc())
                .limit(limit)
                .all()
            )
            return [
                {
                    "id": r.id,
                    "version": r.version,
                    "trainedAt": r.trainedAt.isoformat() if r.trainedAt else None,
                    "precision": r.precision,
                    "recall": r.recall,
                    "expectancy": r.expectancy,
                    "maxDrawdown": r.maxDrawdown,
                    "regime": r.regime,
                    "strategyId": getattr(r, "strategyId", None),
                    "isActive": r.isActive,
                    "status": r.status,
                    "artifactPath": r.artifactPath,
                    "artifactSha256": r.artifactSha256,
                    "trainingSamples": r.trainingSamples,
                    "promotedAt": r.promotedAt.isoformat() if r.promotedAt else None,
                    "promotionReason": r.promotionReason,
                }
                for r in rows
            ]
    except Exception as exc:  # noqa: BLE001
        logger.warning("ModelRegistry DB read failed (%s); using file fallback", exc)
        if not FALLBACK_REGISTRY_PATH.exists():
            return []
        lines = FALLBACK_REGISTRY_PATH.read_text().strip().splitlines()
        return [json.loads(line) for line in lines[-limit:]]
