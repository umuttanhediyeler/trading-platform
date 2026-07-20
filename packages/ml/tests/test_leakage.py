"""Look-ahead bias (leakage) tests — MANDATORY.

Core invariant: for every feature column, the value at time ``t`` computed
on the full series must equal the value at ``t`` computed on the series
truncated at ``t`` (``bars.iloc[:t+1]``). If a feature used any bar after
``t``, truncation would change it and this test goes red — and per the spec
a red leakage test means that feature must never ship.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.features import FEATURE_COLUMNS, compute_features
from app.regime import classify_regime_series
from tests.conftest import make_bars

# Checkpoints spread across the series, past the indicator warm-up period.
CHECKPOINTS = (60, 100, 150, 250, 399)


def _assert_prefix_stable(full: pd.Series, truncated: pd.Series, t: int, name: str):
    a, b = full.iloc[t], truncated.iloc[t]
    if pd.isna(a) and pd.isna(b):
        return
    assert not (pd.isna(a) or pd.isna(b)), (
        f"{name}@t={t}: NaN mismatch (full={a!r}, truncated={b!r})"
    )
    assert a == pytest.approx(b, rel=1e-9, abs=1e-12), (
        f"{name}@t={t} changed when future bars were removed: "
        f"full={a!r} truncated={b!r} — feature looks ahead!"
    )


@pytest.mark.parametrize("t", CHECKPOINTS)
def test_features_do_not_look_ahead(bars: pd.DataFrame, t: int):
    """Truncating the input at t must not change any feature value at t."""
    full = compute_features(bars)
    truncated = compute_features(bars.iloc[: t + 1].reset_index(drop=True))
    for name in FEATURE_COLUMNS:
        _assert_prefix_stable(full[name], truncated[name], t, name)


def test_features_do_not_look_ahead_exhaustive():
    """Same invariant, every t on a smaller series (cheap full sweep)."""
    bars = make_bars(n=120, seed=7)
    full = compute_features(bars)
    for t in range(30, len(bars)):
        truncated = compute_features(bars.iloc[: t + 1].reset_index(drop=True))
        for name in FEATURE_COLUMNS:
            _assert_prefix_stable(full[name], truncated[name], t, name)


@pytest.mark.parametrize("t", CHECKPOINTS)
def test_features_insensitive_to_future_perturbation(bars: pd.DataFrame, t: int):
    """Corrupting bars strictly after t must not change features at <= t."""
    corrupted = bars.copy()
    price_cols = ["open", "high", "low", "close"]
    corrupted.loc[corrupted.index > t, price_cols] *= 7.5
    corrupted.loc[corrupted.index > t, "volume"] *= 100

    full = compute_features(bars)
    perturbed = compute_features(corrupted)
    for name in FEATURE_COLUMNS:
        pd.testing.assert_series_equal(
            full[name].iloc[: t + 1],
            perturbed[name].iloc[: t + 1],
            check_exact=False,
            rtol=1e-9,
            obj=f"feature '{name}' up to t={t}",
        )


@pytest.mark.parametrize("t", CHECKPOINTS)
def test_regime_does_not_look_ahead(bars: pd.DataFrame, t: int):
    """Regime classification must obey the same prefix-stability rule."""
    full = classify_regime_series(bars)
    truncated = classify_regime_series(bars.iloc[: t + 1].reset_index(drop=True))
    assert full.iloc[t] == truncated.iloc[t], (
        f"regime@t={t} changed when future bars were removed"
    )


def test_feature_columns_all_present(bars: pd.DataFrame):
    features = compute_features(bars)
    assert list(features.columns) == list(FEATURE_COLUMNS)
    # After warm-up every feature must actually produce values.
    tail = features.iloc[-50:]
    assert not tail.isna().any().any(), (
        f"NaNs after warm-up in: {tail.columns[tail.isna().any()].tolist()}"
    )


def test_walk_forward_split_is_chronological():
    """Every test window must start strictly after its training window."""
    from app.train import build_training_frame, walk_forward_train

    bars = make_bars(n=500, seed=3)
    frame = build_training_frame(bars)
    results = walk_forward_train(frame, train_window_days=180, test_window_days=30)
    assert results, "expected at least one walk-forward window"
    for r in results:
        assert pd.Timestamp(r.test_start) >= pd.Timestamp(r.window_end), (
            "test window overlaps training window — temporal leakage"
        )
        assert r.n_train > 0 and r.n_test > 0


def test_walk_forward_purges_label_horizon_before_test():
    """The final training rows whose labels reach into the test window must
    be removed from every fold."""
    from app.train import build_training_frame, walk_forward_train

    bars = make_bars(n=500, seed=13)
    frame = build_training_frame(bars, max_hold_bars=10)
    baseline = walk_forward_train(
        frame, train_window_days=180, test_window_days=30, purge_bars=0
    )
    purged = walk_forward_train(
        frame, train_window_days=180, test_window_days=30, purge_bars=10
    )
    baseline_by_test = {r.test_start: r for r in baseline}
    assert purged
    for result in purged:
        assert result.n_train == baseline_by_test[result.test_start].n_train - 10


def test_no_negative_shift_in_features_source():
    """Static guard: no `.shift()` call with a negative constant (future
    shift) may appear in the actual code of features.py."""
    import ast
    from pathlib import Path

    import app.features as features_module

    tree = ast.parse(Path(features_module.__file__).read_text())
    offenders: list[int] = []
    for node in ast.walk(tree):
        if not (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "shift"
        ):
            continue
        for arg in [*node.args, *[kw.value for kw in node.keywords]]:
            if (
                isinstance(arg, ast.UnaryOp)
                and isinstance(arg.op, ast.USub)
                and isinstance(arg.operand, ast.Constant)
            ) or (
                isinstance(arg, ast.Constant)
                and isinstance(arg.value, (int, float))
                and arg.value < 0
            ):
                offenders.append(node.lineno)
    assert not offenders, (
        f"negative shift (future data) called in features.py at lines {offenders}"
    )
