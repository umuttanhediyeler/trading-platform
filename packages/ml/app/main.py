"""ML FastAPI service.

Endpoints: /predict, /train, /nightly (plus /health and /models).
Called by apps/api via ML_SERVICE_URL (http://localhost:8001); never
exposed directly to the web frontend.
"""

from __future__ import annotations

import logging
import os
from collections import OrderedDict
from typing import Any

import numpy as np
import pandas as pd
import sentry_sdk
from fastapi import FastAPI, HTTPException
from fastapi.responses import PlainTextResponse
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    Counter,
    Gauge,
    generate_latest,
)
from pydantic import BaseModel, Field

from app.artifacts import (
    artifact_sha256,
    load_artifact,
    load_latest_active,
    save_artifact,
)
from app.features import FEATURE_COLUMNS, compute_features
from app.labeling import LABEL_TO_INT
from app.model_registry import (
    ModelRecord,
    PromotionRejected,
    list_models,
    make_version,
    register_model,
)
from app.nightly_job import run_nightly
from app.regime import classify_regime
from app.train import HAS_LIGHTGBM, train_from_bars

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)

if os.environ.get("SENTRY_DSN"):
    sentry_sdk.init(
        dsn=os.environ["SENTRY_DSN"],
        environment=os.environ.get("SENTRY_ENVIRONMENT", "development"),
        traces_sample_rate=0.1,
    )

app = FastAPI(title="ML Service", version="0.1.0")

INT_TO_LABEL = {v: k for k, v in LABEL_TO_INT.items()}

# Latest fitted model kept in memory; /predict falls back to a neutral
# heuristic when no model has been trained yet in this process.
_state: dict = {
    "model": None,
    "version": None,
    "regime": None,
    "tp_threshold": 0.5,
}

# Small LRU of shadow (challenger) models loaded on demand for parallel
# evaluation. Kept strictly separate from _state so shadow inference can never
# leak into production predictions.
_shadow_models: OrderedDict[str, tuple[Any, float]] = OrderedDict()
_SHADOW_CACHE_MAX = int(os.environ.get("SHADOW_MODEL_CACHE_MAX", "8"))


def _load_shadow_model(version: str) -> tuple[Any, float] | None:
    """Load a specific model version from the artifact store (LRU-cached)."""
    if version in _shadow_models:
        _shadow_models.move_to_end(version)
        return _shadow_models[version]
    payload = load_artifact(version)
    if not payload or payload.get("model") is None:
        return None
    meta = payload.get("meta") or {}
    entry = (payload["model"], float(meta.get("tp_threshold", 0.5)))
    _shadow_models[version] = entry
    while len(_shadow_models) > _SHADOW_CACHE_MAX:
        _shadow_models.popitem(last=False)
    return entry


def _choose_label(probabilities: dict[str, float], tp_threshold: float) -> str:
    """Emit TP only when its probability clears the calibrated floor."""
    if probabilities.get("tp", 0.0) >= tp_threshold:
        return "tp"
    non_tp = {k: v for k, v in probabilities.items() if k != "tp"}
    if not non_tp:
        return max(probabilities, key=probabilities.get)
    return max(non_tp, key=non_tp.get)

PREDICTIONS_TOTAL = Counter(
    "ml_predictions_total", "Predictions served", ["fallback"]
)
TRAINS_TOTAL = Counter("ml_trains_total", "Training runs completed")
MODEL_LOADED = Gauge("ml_model_loaded", "1 when a fitted model is in memory")


@app.get("/metrics")
def metrics() -> PlainTextResponse:
    MODEL_LOADED.set(1 if _state["model"] is not None else 0)
    return PlainTextResponse(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.on_event("startup")
def _restore_model() -> None:
    restored = load_latest_active()
    if restored:
        _state.update(restored)
        logger.info(
            "Restored model %s (regime=%s) from artifact store",
            restored.get("version"),
            restored.get("regime"),
        )


class Bar(BaseModel):
    timestamp: str
    open: float
    high: float
    low: float
    close: float
    volume: float


class BarsPayload(BaseModel):
    symbol: str = "UNKNOWN"
    bars: list[Bar] = Field(min_length=1)

    def to_frame(self) -> pd.DataFrame:
        df = pd.DataFrame([b.model_dump() for b in self.bars])
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        return df.sort_values("timestamp").reset_index(drop=True)


class PredictRequest(BarsPayload):
    # When set, inference runs against that registered artifact instead of the
    # in-memory production model (used for hidden challenger/shadow scoring).
    # Empty tuple silences pydantic's protected "model_" namespace warning.
    model_config = {"protected_namespaces": ()}

    model_version: str | None = None


class TrainRequest(BarsPayload):
    train_window_days: int = 180
    test_window_days: int = 30
    take_profit_pct: float = 0.02
    stop_loss_pct: float = 0.01
    max_hold_bars: int = 10
    save_to_registry: bool = True
    # Shadow models are registered inactive until explicitly promoted.
    shadow: bool = True


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "lightgbm": HAS_LIGHTGBM,
        "model_loaded": _state["model"] is not None,
        "model_version": _state["version"],
    }


@app.get("/ready")
def ready() -> dict:
    """Readiness: process up + registry reachable (DB or file fallback)."""
    models = list_models(limit=1)
    return {"status": "ready", "registry_reachable": True, "models_seen": len(models)}


@app.post("/predict")
def predict(payload: PredictRequest) -> dict:
    bars = payload.to_frame()
    try:
        features = compute_features(bars)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    latest = features.iloc[-1]
    if latest.isna().any():
        raise HTTPException(
            status_code=422,
            detail=(
                "not enough history to compute all features; "
                "send at least ~60 bars"
            ),
        )

    regime = classify_regime(bars)
    feature_snapshot = {
        name: float(latest[name]) for name in FEATURE_COLUMNS
    }
    feature_timestamp = pd.Timestamp(bars["timestamp"].iloc[-1]).isoformat()
    model = _state["model"]
    model_version = _state["version"]
    tp_threshold = float(_state.get("tp_threshold") or 0.5)
    if payload.model_version and payload.model_version != _state["version"]:
        shadow = _load_shadow_model(payload.model_version)
        if shadow is None:
            raise HTTPException(
                status_code=404,
                detail=f"model artifact {payload.model_version} not found",
            )
        model, tp_threshold = shadow
        model_version = payload.model_version
    if model is None:
        # No trained model in this process yet: return a neutral, clearly
        # flagged response instead of failing so the caller can degrade
        # gracefully (e.g. hide the confidence badge).
        PREDICTIONS_TOTAL.labels(fallback="true").inc()
        return {
            "symbol": payload.symbol,
            "prediction": "timeout",
            "confidence": 0.0,
            "probabilities": {"tp": 0.0, "sl": 0.0, "timeout": 1.0},
            "regime": regime,
            "model_version": None,
            "fallback": True,
            "features": feature_snapshot,
            "feature_timestamp": feature_timestamp,
        }

    X = latest[list(FEATURE_COLUMNS)].to_numpy(dtype=float).reshape(1, -1)
    proba = model.predict_proba(X)[0]
    classes = [INT_TO_LABEL[int(c)] for c in model.classes_]
    probabilities = {label: float(p) for label, p in zip(classes, proba)}
    for label in ("tp", "sl", "timeout"):
        probabilities.setdefault(label, 0.0)
    best = _choose_label(probabilities, tp_threshold)
    PREDICTIONS_TOTAL.labels(fallback="false").inc()
    return {
        "symbol": payload.symbol,
        "prediction": best,
        "confidence": probabilities[best],
        "probabilities": probabilities,
        "regime": regime,
        "model_version": model_version,
        "fallback": False,
        "features": feature_snapshot,
        "feature_timestamp": feature_timestamp,
    }


@app.post("/train")
def train(payload: TrainRequest) -> dict:
    bars = payload.to_frame()
    try:
        results = train_from_bars(
            bars,
            train_window_days=payload.train_window_days,
            test_window_days=payload.test_window_days,
            take_profit_pct=payload.take_profit_pct,
            stop_loss_pct=payload.stop_loss_pct,
            max_hold_bars=payload.max_hold_bars,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not results:
        raise HTTPException(
            status_code=422, detail="no walk-forward windows could be trained"
        )

    last = results[-1]
    version = make_version()
    artifact_path = save_artifact(
        version,
        last.model,
        meta={
            "regime": last.regime,
            "shadow": payload.shadow,
            "tp_threshold": last.tp_threshold,
        },
    )
    artifact_hash = artifact_sha256(version)
    # A shadow model must never serve production predictions. Only explicitly
    # active training runs or successful promotion can replace process state.
    if not payload.shadow:
        _state.update(
            model=last.model,
            version=version,
            regime=last.regime,
            tp_threshold=last.tp_threshold,
        )

    registered_to = None
    if payload.save_to_registry:
        registered_to = register_model(
            ModelRecord(
                version=version,
                precision=float(np.mean([r.precision for r in results])),
                recall=float(np.mean([r.recall for r in results])),
                expectancy=float(np.mean([r.expectancy for r in results])),
                max_drawdown=float(np.mean([r.max_drawdown for r in results])),
                regime=last.regime,
                is_active=not payload.shadow,
                artifact_path=artifact_path,
                artifact_sha256=artifact_hash,
                training_samples=sum(r.n_test for r in results),
            )
        )

    TRAINS_TOTAL.inc()
    return {
        "version": version,
        "shadow": payload.shadow,
        "artifact": artifact_path,
        "artifact_sha256": artifact_hash,
        "windows": [r.to_dict() for r in results],
        "registered_to": registered_to,
    }


@app.post("/nightly")
def nightly(payload: BarsPayload) -> dict:
    """Nightly strategy selection. The cron trigger lives in apps/api
    (BullMQ repeatable job) — this endpoint only executes the work."""
    bars = payload.to_frame()
    return run_nightly(bars)


@app.get("/models")
def models(limit: int = 50) -> dict:
    return {"models": list_models(limit=limit)}


@app.post("/models/{version}/promote")
def promote(version: str) -> dict:
    """Promote a shadow model to active for its regime."""
    from app.model_registry import promote_model

    try:
        result = promote_model(version)
    except PromotionRejected as exc:
        raise HTTPException(
            status_code=409,
            detail={"message": str(exc), "gateFailures": exc.reasons},
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    artifact = load_artifact(version)
    if artifact and artifact.get("model") is not None:
        meta = artifact.get("meta") or {}
        _state.update(
            model=artifact["model"],
            version=version,
            regime=result.get("regime"),
            tp_threshold=float(meta.get("tp_threshold", 0.5)),
        )
    return result
