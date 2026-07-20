"""Tests for triple-barrier labeling."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.labeling import label_dataset, triple_barrier_label


def bars_from_prices(
    closes: list[float],
    highs: list[float] | None = None,
    lows: list[float] | None = None,
) -> pd.DataFrame:
    closes_arr = np.array(closes, dtype=float)
    highs_arr = np.array(highs, dtype=float) if highs else closes_arr * 1.001
    lows_arr = np.array(lows, dtype=float) if lows else closes_arr * 0.999
    return pd.DataFrame(
        {
            "timestamp": pd.date_range("2024-01-01", periods=len(closes_arr), freq="D"),
            "open": closes_arr,
            "high": highs_arr,
            "low": lows_arr,
            "close": closes_arr,
            "volume": np.full(len(closes_arr), 1_000_000.0),
        }
    )


class TestTripleBarrierLabel:
    def test_take_profit_hit_first(self):
        # Entry at 100; bar 2's high (103) crosses the +2% barrier (102).
        bars = bars_from_prices(
            closes=[100, 101, 102.5, 103],
            highs=[100.5, 101.5, 103.0, 103.5],
            lows=[99.5, 100.5, 101.0, 102.0],
        )
        label = triple_barrier_label(
            bars, entry_idx=0, take_profit_pct=0.02, stop_loss_pct=0.02, max_hold_bars=5
        )
        assert label == "tp"

    def test_stop_loss_hit_first(self):
        # Entry at 100; bar 1's low (97.5) crosses the -2% barrier (98).
        bars = bars_from_prices(
            closes=[100, 98, 97, 96],
            highs=[100.5, 99.0, 98.0, 97.0],
            lows=[99.5, 97.5, 96.5, 95.5],
        )
        label = triple_barrier_label(
            bars, entry_idx=0, take_profit_pct=0.02, stop_loss_pct=0.02, max_hold_bars=5
        )
        assert label == "sl"

    def test_timeout_when_no_barrier_hit(self):
        bars = bars_from_prices(closes=[100, 100.2, 99.9, 100.1, 100.0])
        label = triple_barrier_label(
            bars, entry_idx=0, take_profit_pct=0.05, stop_loss_pct=0.05, max_hold_bars=3
        )
        assert label == "timeout"

    def test_max_hold_bars_limits_horizon(self):
        # TP would be hit at bar 4, but the horizon ends at bar 2 -> timeout.
        bars = bars_from_prices(
            closes=[100, 100.1, 100.2, 100.3, 110],
            highs=[100.2, 100.3, 100.4, 100.5, 111],
            lows=[99.8, 99.9, 100.0, 100.1, 100.2],
        )
        assert (
            triple_barrier_label(bars, 0, 0.05, 0.05, max_hold_bars=2) == "timeout"
        )
        assert triple_barrier_label(bars, 0, 0.05, 0.05, max_hold_bars=4) == "tp"

    def test_same_bar_double_touch_is_conservative_sl(self):
        # Bar 1 touches both barriers; intrabar order unknown -> assume sl.
        bars = bars_from_prices(
            closes=[100, 100],
            highs=[100.5, 106.0],
            lows=[99.5, 94.0],
        )
        label = triple_barrier_label(
            bars, entry_idx=0, take_profit_pct=0.03, stop_loss_pct=0.03, max_hold_bars=3
        )
        assert label == "sl"

    def test_entry_bar_itself_is_not_inspected(self):
        # The entry bar's own extreme high must NOT trigger tp: only bars
        # strictly after the entry count.
        bars = bars_from_prices(
            closes=[100, 100.1, 100.0],
            highs=[150.0, 100.3, 100.2],  # entry bar has a huge high
            lows=[99.0, 99.9, 99.8],
        )
        label = triple_barrier_label(
            bars, entry_idx=0, take_profit_pct=0.02, stop_loss_pct=0.05, max_hold_bars=2
        )
        assert label == "timeout"

    def test_label_only_depends_on_future_window(self):
        # Changing bars beyond entry_idx + max_hold_bars must not change the label.
        bars = bars_from_prices(closes=[100.0] * 10)
        modified = bars.copy()
        modified.loc[modified.index >= 6, ["high", "low", "close"]] = 500.0
        for b in (bars, modified):
            assert triple_barrier_label(b, 0, 0.05, 0.05, max_hold_bars=5) == (
                triple_barrier_label(bars, 0, 0.05, 0.05, max_hold_bars=5)
            )

    def test_invalid_arguments_raise(self):
        bars = bars_from_prices(closes=[100, 101, 102])
        with pytest.raises(ValueError):
            triple_barrier_label(bars, 0, -0.01, 0.02, 5)
        with pytest.raises(ValueError):
            triple_barrier_label(bars, 0, 0.02, 0.0, 5)
        with pytest.raises(ValueError):
            triple_barrier_label(bars, 0, 0.02, 0.02, 0)
        with pytest.raises(IndexError):
            triple_barrier_label(bars, 99, 0.02, 0.02, 5)


class TestLabelDataset:
    def test_alignment_and_trailing_nan(self):
        bars = bars_from_prices(closes=[100, 101, 102, 103, 104])
        max_hold = 2
        labels = label_dataset(bars, 0.02, 0.02, max_hold_bars=max_hold)
        assert len(labels) == len(bars)
        # Last ``max_hold_bars`` rows are censored (incomplete horizon).
        assert labels.iloc[-max_hold:].isna().all() or all(
            labels.iloc[i] is None for i in range(len(bars) - max_hold, len(bars))
        )
        assert labels.iloc[: len(bars) - max_hold].notna().all()

    def test_values_match_pointwise_calls(self):
        rng = np.random.default_rng(0)
        closes = (100 * np.exp(np.cumsum(rng.normal(0, 0.02, 50)))).tolist()
        bars = bars_from_prices(closes=closes)
        max_hold = 5
        labels = label_dataset(bars, 0.02, 0.01, max_hold_bars=max_hold)
        last_labelable = len(bars) - 1 - max_hold
        for i in range(len(bars)):
            if i > last_labelable:
                assert labels.iloc[i] is None
            else:
                assert labels.iloc[i] == triple_barrier_label(
                    bars, i, 0.02, 0.01, max_hold
                )
