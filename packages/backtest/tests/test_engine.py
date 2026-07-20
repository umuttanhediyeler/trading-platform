from __future__ import annotations

import pandas as pd
import pytest

from app.engine import (
    HAS_VECTORBT,
    BacktestConfig,
    _run_pandas,
    _run_vectorbt,
    run_backtest,
)
from app.main import StrategySpec, _strategy_signals
from app.metrics import max_drawdown, profit_factor


def make_bars(opens: list[float]) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "timestamp": pd.date_range("2026-01-01", periods=len(opens), freq="D"),
            "open": opens,
            "high": [value * 1.01 for value in opens],
            "low": [value * 0.99 for value in opens],
            "close": opens,
            "volume": [1_000_000.0] * len(opens),
        }
    )


def test_signals_fill_on_next_bar_open() -> None:
    bars = make_bars([100.0, 110.0, 120.0, 130.0])
    result = run_backtest(
        bars,
        pd.Series([True, False, False, False]),
        pd.Series([False, True, False, False]),
        BacktestConfig(commission_pct=0.0, slippage_pct=0.0),
    )

    assert len(result.trades) == 1
    assert result.trades[0]["entry_price"] == pytest.approx(110.0)
    assert result.trades[0]["exit_price"] == pytest.approx(120.0)


def test_future_bars_do_not_change_completed_trade() -> None:
    bars = make_bars([100.0, 101.0, 102.0, 103.0, 104.0])
    entries = pd.Series([True, False, False, False, False])
    exits = pd.Series([False, True, False, False, False])
    baseline = run_backtest(bars, entries, exits)

    changed = bars.copy()
    changed.loc[changed.index >= 3, ["open", "high", "low", "close"]] *= 50
    perturbed = run_backtest(changed, entries, exits)

    assert perturbed.trades == baseline.trades


def test_short_signals_fill_next_open_with_symmetric_slippage() -> None:
    bars = make_bars([100.0, 100.0, 90.0, 80.0])
    result = _run_pandas(
        bars,
        pd.Series([-1, -1, 0, 0]),
        BacktestConfig(commission_pct=0.0, slippage_pct=0.01),
    )

    assert len(result.trades) == 1
    assert result.trades[0]["direction"] == "short"
    assert result.trades[0]["entry_price"] == pytest.approx(99.0)
    assert result.trades[0]["exit_price"] == pytest.approx(80.8)
    assert result.trades[0]["pnl"] > 0


def test_trade_pnl_includes_entry_and_exit_commission() -> None:
    bars = make_bars([100.0, 100.0, 110.0, 110.0])
    result = _run_pandas(
        bars,
        pd.Series([1, 1, 0, 0]),
        BacktestConfig(initial_cash=1_000.0, commission_pct=0.01, slippage_pct=0.0),
    )

    assert len(result.trades) == 1
    assert result.trades[0]["pnl"] == pytest.approx(
        result.equity_curve[-1] - 1_000.0
    )
    assert result.metrics["expectancy"] == pytest.approx(result.trades[0]["pnl"])


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda bars: bars.__setitem__("timestamp", [bars.iloc[0]["timestamp"]] * len(bars)), "duplicate"),
        (lambda bars: bars.__setitem__("open", [float("nan")] * len(bars)), "finite"),
        (lambda bars: bars.__setitem__("low", [-1.0] * len(bars)), "non-negative"),
        (lambda bars: bars.__setitem__("high", [1.0] * len(bars)), "greater than"),
    ],
)
def test_invalid_bars_are_rejected(mutate, message: str) -> None:
    bars = make_bars([100.0, 101.0])
    mutate(bars)

    with pytest.raises(ValueError, match=message):
        run_backtest(bars, signals=pd.Series([0, 0]))


@pytest.mark.skipif(not HAS_VECTORBT, reason="vectorbt is not importable")
def test_vectorbt_and_pandas_final_equity_parity() -> None:
    bars = make_bars([100.0, 101.0, 104.0, 102.0, 98.0, 96.0, 99.0, 100.0])
    signals = pd.Series([1, 1, 0, -1, -1, 0, 0, 0])
    config = BacktestConfig(commission_pct=0.001, slippage_pct=0.0005)

    vectorbt_result = _run_vectorbt(bars, signals, config)
    pandas_result = _run_pandas(bars, signals, config)

    assert vectorbt_result.equity_curve[-1] == pytest.approx(
        pandas_result.equity_curve[-1], rel=0.01
    )


def test_core_metrics() -> None:
    assert max_drawdown(pd.Series([100.0, 120.0, 90.0, 110.0])) == pytest.approx(0.25)
    assert profit_factor(pd.Series([10.0, -4.0, 2.0, -2.0])) == pytest.approx(2.0)


@pytest.mark.parametrize(
    ("spec", "prices"),
    [
        (
            StrategySpec(name="macd_cross", fast=3, slow=6, signal_period=2),
            [100, 99, 98, 97, 98, 101, 105, 108, 110, 108, 104, 100, 97, 95],
        ),
        (
            StrategySpec(name="bollinger_revert", period=5, num_std=1.0),
            [100, 100, 100, 100, 100, 90, 92, 96, 100, 103, 102],
        ),
        (
            StrategySpec(name="donchian_breakout", breakout_period=4, exit_period=2),
            [100, 101, 102, 103, 105, 108, 110, 107, 103, 99, 98],
        ),
    ],
)
def test_builtin_strategy_triggers_completed_trade(
    spec: StrategySpec, prices: list[float]
) -> None:
    bars = make_bars(prices)
    signals = _strategy_signals(bars, spec)

    result = run_backtest(
        bars,
        signals=signals,
        config=BacktestConfig(commission_pct=0.0, slippage_pct=0.0),
    )

    assert result.metrics["num_trades"] > 0
