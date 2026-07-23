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
    try:
        from app.model_registry import list_models

        models = list_models(limit=50)
        active = next((m for m in models if m.get("isActive") or m.get("is_active")), None)
        if not active:
            return None
        version = active.get("version")
        if not version:
            return None
        payload = load_artifact(version)
        if not payload:
            return None
        meta = payload.get("meta") or {}
        return {
            "model": payload["model"],
            "version": version,
            "regime": active.get("regime"),
            "tp_threshold": float(meta.get("tp_threshold", 0.5)),
        }
    except Exception as exc:  # noqa: BLE001
        logger.warning("load_latest_active failed: %s", exc)
        return None
