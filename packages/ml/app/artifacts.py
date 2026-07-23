"""Persist / load fitted model binaries next to the registry metadata.

Registry rows alone are not enough to serve /predict after a process
restart. Artifacts are stored under MODEL_ARTIFACT_DIR as joblib files
keyed by model version.
"""

from __future__ import annotations

import logging
import os
import hashlib
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any

import joblib

logger = logging.getLogger(__name__)

ARTIFACT_DIR = Path(
    os.environ.get(
        "MODEL_ARTIFACT_DIR",
        str(Path(__file__).resolve().parents[1] / "data" / "model-artifacts"),
    )
)


def artifact_path(version: str) -> Path:
    safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in version)
    return ARTIFACT_DIR / f"{safe}.joblib"


def save_artifact(version: str, model: Any, meta: dict | None = None) -> str:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    path = artifact_path(version)
    # Write and fsync a sibling temporary file before atomic replacement. A
    # crash can never leave the active version pointing at a partial pickle.
    with NamedTemporaryFile(dir=ARTIFACT_DIR, prefix=f".{path.name}.", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        joblib.dump({"model": model, "meta": meta or {}}, tmp_path)
        with tmp_path.open("rb") as fh:
            os.fsync(fh.fileno())
        os.replace(tmp_path, path)
    finally:
        tmp_path.unlink(missing_ok=True)
    logger.info("Saved model artifact %s", path)
    return str(path)


def artifact_sha256(version: str) -> str | None:
    path = artifact_path(version)
    if not path.exists():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_artifact(version: str) -> dict | None:
    path = artifact_path(version)
    if not path.exists():
        return None
    try:
        return joblib.load(path)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to load artifact %s: %s", path, exc)
        return None


def load_latest_active() -> dict | None:
    """Best-effort: load the newest active model from registry + disk."""
    portfolio = load_portfolio_actives()
    if not portfolio:
        return None
    # Prefer balanced as the default process model.
    if "tb_balanced" in portfolio:
        return portfolio["tb_balanced"]
    return next(iter(portfolio.values()))


def load_portfolio_actives() -> dict[str, dict]:
    """Load every active portfolio champion keyed by strategyId."""
    out: dict[str, dict] = {}
    try:
        from app.model_registry import list_models

        models = list_models(limit=100)
        actives = [
            m
            for m in models
            if (m.get("isActive") or m.get("is_active"))
            and m.get("status") == "active"
        ]
        # Newest first already from list_models — keep first per strategy.
        for active in actives:
            strategy = active.get("strategyId") or active.get("strategy_id")
            if not strategy:
                # Legacy champion without a slot → treat as balanced fallback.
                strategy = "tb_balanced"
            if strategy in out:
                continue
            version = active.get("version")
            if not version:
                continue
            payload = load_artifact(version)
            if not payload or payload.get("model") is None:
                continue
            meta = payload.get("meta") or {}
            out[strategy] = {
                "model": payload["model"],
                "version": version,
                "regime": active.get("regime"),
                "strategy_id": strategy,
                "tp_threshold": float(meta.get("tp_threshold", 0.5)),
            }
    except Exception as exc:  # noqa: BLE001
        logger.warning("load_portfolio_actives failed: %s", exc)
    return out


def archive_non_portfolio(keep_versions: set[str]) -> int:
    """Mark every registry row not in keep_versions as archived/inactive."""
    try:
        from app.db import ModelRegistry, get_session

        with get_session() as session:
            rows = session.query(ModelRegistry).all()
            n = 0
            for row in rows:
                if row.version in keep_versions:
                    continue
                if row.status == "archived" and not row.isActive:
                    continue
                row.isActive = False
                row.status = "archived"
                row.promotionReason = "outside curated 5-model portfolio"
                n += 1
            return n
    except Exception as exc:  # noqa: BLE001
        logger.warning("archive_non_portfolio failed: %s", exc)
        return 0
