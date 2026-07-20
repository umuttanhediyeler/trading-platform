"""Model artifact persistence round-trip."""

from __future__ import annotations

from pathlib import Path

from sklearn.dummy import DummyClassifier

from app import artifacts


def test_save_and_load_artifact(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(artifacts, "ARTIFACT_DIR", tmp_path)
    model = DummyClassifier(strategy="most_frequent")
    model.fit([[0.0], [1.0]], [0, 1])
    path = artifacts.save_artifact("model-test-1", model, meta={"regime": "bull"})
    assert Path(path).exists()
    loaded = artifacts.load_artifact("model-test-1")
    assert loaded is not None
    assert loaded["meta"]["regime"] == "bull"
    assert loaded["model"].predict([[1.0]])[0] in (0, 1)
    digest = artifacts.artifact_sha256("model-test-1")
    assert digest is not None
    assert len(digest) == 64
