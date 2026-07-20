"""Promotion gates keep weak or missing model artifacts out of production."""

from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import pytest
from sklearn.dummy import DummyClassifier

from app import artifacts, model_registry


def _record(version: str, **overrides) -> dict:
    record = {
        "version": version,
        "precision": 0.75,
        "recall": 0.5,
        "expectancy": 0.01,
        "max_drawdown": 0.05,
        "regime": "trend",
        "is_active": False,
        "training_samples": 100,
    }
    record.update(overrides)
    return record


def _force_file_registry(monkeypatch, tmp_path: Path) -> Path:
    path = tmp_path / "registry.jsonl"
    monkeypatch.setattr(model_registry, "FALLBACK_REGISTRY_PATH", path)

    def unavailable():
        raise RuntimeError("database unavailable")

    fake_db = types.ModuleType("app.db")
    fake_db.get_session = unavailable
    monkeypatch.setitem(sys.modules, "app.db", fake_db)
    return path


def test_promote_activates_model_with_valid_metrics_and_artifact(
    tmp_path: Path, monkeypatch
):
    registry = _force_file_registry(monkeypatch, tmp_path)
    monkeypatch.setattr(artifacts, "ARTIFACT_DIR", tmp_path / "artifacts")
    model = DummyClassifier(strategy="most_frequent").fit([[0.0], [1.0]], [0, 1])
    artifacts.save_artifact("model-good", model)
    record = _record(
        "model-good", artifact_sha256=artifacts.artifact_sha256("model-good")
    )
    registry.write_text(json.dumps(record) + "\n")

    result = model_registry.promote_model("model-good")

    assert result["promoted"] is True
    saved = json.loads(registry.read_text().strip())
    assert saved["status"] == "active"
    assert saved["isActive"] is True


def test_promote_rejects_weak_model(tmp_path: Path, monkeypatch):
    registry = _force_file_registry(monkeypatch, tmp_path)
    monkeypatch.setattr(artifacts, "ARTIFACT_DIR", tmp_path / "artifacts")
    model = DummyClassifier(strategy="most_frequent").fit([[0.0], [1.0]], [0, 1])
    artifacts.save_artifact("model-weak", model)
    registry.write_text(
        json.dumps(_record("model-weak", precision=0.2, expectancy=-0.01)) + "\n"
    )

    with pytest.raises(model_registry.PromotionRejected) as exc:
        model_registry.promote_model("model-weak")

    assert "precision" in " ".join(exc.value.reasons)
    assert json.loads(registry.read_text().strip())["status"] == "rejected"
