"""Versioned shadow prediction.

/predict with model_version must score the requested registered artifact
(challenger soak path) without ever touching the in-memory production model.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sklearn.dummy import DummyClassifier

from app import artifacts, main
from app.features import FEATURE_COLUMNS


def _fit_dummy() -> DummyClassifier:
    n = len(FEATURE_COLUMNS)
    model = DummyClassifier(strategy="prior")
    model.fit([[0.0] * n, [1.0] * n], [0, 1])
    return model


def _bar_records(bars: pd.DataFrame) -> list[dict]:
    rows = bars.copy()
    rows["timestamp"] = rows["timestamp"].astype(str)
    return rows.to_dict(orient="records")


@pytest.fixture
def client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setattr(artifacts, "ARTIFACT_DIR", tmp_path)
    monkeypatch.setattr(main, "load_latest_active", lambda: None)
    for key in ("model", "version", "regime"):
        monkeypatch.setitem(main._state, key, None)
    main._shadow_models.clear()
    return TestClient(main.app)


def test_predict_with_model_version_scores_that_artifact(
    client: TestClient, bars: pd.DataFrame
) -> None:
    artifacts.save_artifact("shadow-test-1", _fit_dummy(), meta={"shadow": True})

    res = client.post(
        "/predict",
        json={
            "symbol": "AAPL",
            "bars": _bar_records(bars),
            "model_version": "shadow-test-1",
        },
    )

    assert res.status_code == 200
    body = res.json()
    assert body["model_version"] == "shadow-test-1"
    assert body["fallback"] is False
    assert body["prediction"] in ("tp", "sl", "timeout")
    # Shadow scoring must never leak into production state.
    assert main._state["model"] is None
    assert main._state["version"] is None
    # The artifact is cached for subsequent shadow calls.
    assert "shadow-test-1" in main._shadow_models


def test_predict_with_unknown_version_is_404(
    client: TestClient, bars: pd.DataFrame
) -> None:
    res = client.post(
        "/predict",
        json={
            "symbol": "AAPL",
            "bars": _bar_records(bars),
            "model_version": "does-not-exist",
        },
    )
    assert res.status_code == 404


def test_predict_without_version_still_falls_back(
    client: TestClient, bars: pd.DataFrame
) -> None:
    res = client.post(
        "/predict",
        json={"symbol": "AAPL", "bars": _bar_records(bars)},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["fallback"] is True
    assert body["model_version"] is None
