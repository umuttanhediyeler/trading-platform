"""Backtest engine.

Preferred backend is vectorbt; when it is not importable (its wheels lag
behind new Python releases) a pandas fallback implements the same contract,
so the service always boots and /backtest/run always works. The response
reports which backend produced the result.

Look-ahead rules enforced by BOTH backends:

* A signal observed on bar ``t`` (computed from data up to and including
  ``t``'s close) is executed at bar ``t+1``'s OPEN — never at ``t``'s close.
* Slippage is applied against the trader (buy higher, sell lower).
* Commission is charged on both entry and exit notional.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import pandas as pd

from app.metrics import compute_all_metrics

logger = logging.getLogger(__name__)

# vectorbt's import can fail with more than ImportError (e.g. numba/llvmlite
# native errors on unsupported Python versions), so guard broadly: any
# failure to import means "use the pandas fallback".
try:
    import vectorbt as vbt

    HAS_VECTORBT = True
except Exception:  # noqa: BLE001  # pragma: no cover - depends on environment
    vbt = None
    HAS_VECTORBT = False


@dataclass
class BacktestConfig:
    initial_cash: float = 100_000.0
    commission_pct: float = 0.001  # 10 bps per side
    slippage_pct: float = 0.0005  # 5 bps per side
    periods_per_year: int = 252


@dataclass
class BacktestResult:
    metrics: dict
    equity_curve: list[float]
    timestamps: list[str]
    trades: list[dict]
    backend: str

    def to_dict(self) -> dict:
        return {
            "metrics": self.metrics,
            "equity_curve": self.equity_curve,
            "timestamps": self.timestamps,
            "trades": self.trades,
            "backend": self.backend,
        }


def _validate(bars: pd.DataFrame, signals: pd.Series) -> None:
    required = {"timestamp", "open", "high", "low", "close", "volume"}
    missing = required - set(bars.columns)
    if missing:
        raise ValueError(f"bars missing columns: {sorted(missing)}")
    if len(bars) != len(signals):
        raise ValueError("bars and signals must have equal length")
    try:
        ts = pd.to_datetime(bars["timestamp"], errors="raise")
    except (TypeError, ValueError) as exc:
        raise ValueError("bars contain an invalid timestamp") from exc
    if ts.duplicated().any():
        raise ValueError("bars contain duplicate timestamps")
    if not ts.is_monotonic_increasing:
        raise ValueError("bars must be sorted by timestamp ascending")
    price_columns = ["open", "high", "low", "close"]
    try:
        prices = bars[price_columns].astype(float)
    except (TypeError, ValueError) as exc:
        raise ValueError("bar prices must be numeric") from exc
    if not np.isfinite(prices.to_numpy()).all():
        raise ValueError("bar prices must be finite (NaN and infinity are not allowed)")
    if (prices < 0).to_numpy().any():
        raise ValueError("bar prices must be non-negative")
    if (prices["high"] < prices["low"]).any():
        raise ValueError("bar high must be greater than or equal to low")
    if not signals.isin([-1, 0, 1]).all():
        raise ValueError("signals must contain only -1 (short), 0 (flat), or 1 (long)")


def _events_to_targets(entries: pd.Series, exits: pd.Series) -> pd.Series:
    """Convert the legacy long-only event API to target-position signals."""
    if len(entries) != len(exits):
        raise ValueError("entries and exits must have equal length")
    target = 0
    targets: list[int] = []
    for entry, exit_ in zip(entries.astype(bool), exits.astype(bool), strict=True):
        if bool(exit_):
            target = 0
        elif bool(entry):
            target = 1
        targets.append(target)
    return pd.Series(targets, dtype="int8")


def run_backtest(
    bars: pd.DataFrame,
    entries: pd.Series | None = None,
    exits: pd.Series | None = None,
    config: BacktestConfig | None = None,
    *,
    signals: pd.Series | None = None,
) -> BacktestResult:
    """Run a long/short target-position signal backtest.

    ``signals`` contains -1 (short), 0 (flat), or 1 (long). A target observed
    at index ``t`` is filled at ``t+1`` open. The legacy long-only
    ``entries``/``exits`` event arrays remain supported.
    """
    config = config or BacktestConfig()
    if signals is not None:
        if entries is not None or exits is not None:
            raise ValueError("provide signals or entries+exits, not both")
        targets = pd.Series(signals).reset_index(drop=True)
    else:
        if entries is None or exits is None:
            raise ValueError("provide signals or entries+exits")
        targets = _events_to_targets(
            pd.Series(entries).reset_index(drop=True),
            pd.Series(exits).reset_index(drop=True),
        )
    bars = bars.reset_index(drop=True)
    _validate(bars, targets)
    targets = targets.astype("int8")

    if HAS_VECTORBT:
        try:
            return _run_vectorbt(bars, targets, config)
        except Exception as exc:  # noqa: BLE001 — keep the service usable
            logger.warning("vectorbt backend failed (%s); using pandas fallback", exc)
    return _run_pandas(bars, targets, config)


def _run_vectorbt(
    bars: pd.DataFrame,
    signals: pd.Series,
    config: BacktestConfig,
) -> BacktestResult:
    index = pd.DatetimeIndex(pd.to_datetime(bars["timestamp"]))
    close = pd.Series(bars["close"].to_numpy(float), index=index)
    open_ = pd.Series(bars["open"].to_numpy(float), index=index)
    targets = pd.Series(signals.to_numpy(), index=index).shift(1, fill_value=0)
    previous = targets.shift(1, fill_value=0)

    pf = vbt.Portfolio.from_signals(
        close=close,
        open=open_,
        entries=(targets == 1) & (previous != 1),
        exits=(previous == 1) & (targets != 1),
        short_entries=(targets == -1) & (previous != -1),
        short_exits=(previous == -1) & (targets != -1),
        price=open_,
        init_cash=config.initial_cash,
        fees=config.commission_pct,
        slippage=config.slippage_pct,
        upon_opposite_entry="reverse",
        freq="1D",
    )

    equity = pf.value()
    returns = equity.pct_change().fillna(0.0)
    trades_df = pf.trades.records_readable
    trade_pnls = pd.Series(trades_df["PnL"].to_numpy(float)) if len(trades_df) else pd.Series(dtype=float)

    trades = [
        {
            "entry_time": str(row["Entry Timestamp"]),
            "exit_time": str(row["Exit Timestamp"]),
            "entry_price": float(row["Avg Entry Price"]),
            "exit_price": float(row["Avg Exit Price"]),
            "size": float(row["Size"]),
            "pnl": float(row["PnL"]),
            "return_pct": float(row["Return"]) * 100.0,
            "direction": str(row["Direction"]).lower(),
        }
        for _, row in trades_df.iterrows()
    ]

    metrics = compute_all_metrics(
        equity_curve=equity.reset_index(drop=True),
        returns=returns.reset_index(drop=True),
        trade_pnls=trade_pnls,
        periods_per_year=config.periods_per_year,
    )
    return BacktestResult(
        metrics=metrics,
        equity_curve=[float(v) for v in equity.to_numpy()],
        timestamps=[str(t) for t in index],
        trades=trades,
        backend="vectorbt",
    )


def _run_pandas(
    bars: pd.DataFrame,
    signals: pd.Series,
    config: BacktestConfig,
) -> BacktestResult:
    """Event-loop fallback with identical semantics to the vectorbt path."""
    n = len(bars)
    open_ = bars["open"].to_numpy(float)
    close = bars["close"].to_numpy(float)
    timestamps = pd.to_datetime(bars["timestamp"])

    cash = config.initial_cash
    shares = 0.0  # positive for long, negative for short
    position = 0
    entry_price = 0.0
    entry_commission = 0.0
    entry_time: str | None = None
    equity = np.empty(n, dtype=float)
    trades: list[dict] = []

    pending_target = 0

    for t in range(n):
        if pending_target != position and position != 0:
            # A long exits by selling below the open; a short exits by buying
            # above it. Commission is charged on exit notional in both cases.
            fill = open_[t] * (
                1.0 - config.slippage_pct if position == 1 else 1.0 + config.slippage_pct
            )
            quantity = abs(shares)
            exit_notional = quantity * fill
            exit_commission = exit_notional * config.commission_pct
            if position == 1:
                cash += exit_notional - exit_commission
                pnl = (
                    exit_notional
                    - exit_commission
                    - quantity * entry_price
                    - entry_commission
                )
            else:
                cash -= exit_notional + exit_commission
                pnl = (
                    quantity * entry_price
                    - entry_commission
                    - exit_notional
                    - exit_commission
                )
            invested = quantity * entry_price + entry_commission
            trades.append(
                {
                    "entry_time": entry_time,
                    "exit_time": str(timestamps.iloc[t]),
                    "entry_price": entry_price,
                    "exit_price": fill,
                    "size": quantity,
                    "pnl": pnl,
                    "return_pct": pnl / invested * 100.0,
                    "direction": "long" if position == 1 else "short",
                }
            )
            shares = 0.0
            position = 0

        if pending_target != 0 and position == 0:
            # Size to one times current equity. For longs, reserve entry
            # commission; short-sale proceeds remain cash while the negative
            # shares carry the liability.
            direction = pending_target
            fill = open_[t] * (
                1.0 + config.slippage_pct if direction == 1 else 1.0 - config.slippage_pct
            )
            quantity = cash / (fill * (1.0 + config.commission_pct))
            entry_notional = quantity * fill
            entry_commission = entry_notional * config.commission_pct
            if direction == 1:
                cash -= entry_notional + entry_commission
                shares = quantity
            else:
                cash += entry_notional - entry_commission
                shares = -quantity
            position = direction
            entry_price = fill
            entry_time = str(timestamps.iloc[t])

        pending_target = int(signals.iloc[t])
        equity[t] = cash + shares * close[t]

    # A still-open position at the end is marked to the last close but not
    # counted as a completed trade (matches vectorbt's closed-trade stats).
    equity_series = pd.Series(equity)
    returns = equity_series.pct_change().fillna(0.0)
    trade_pnls = pd.Series([tr["pnl"] for tr in trades], dtype=float)

    metrics = compute_all_metrics(
        equity_curve=equity_series,
        returns=returns,
        trade_pnls=trade_pnls,
        periods_per_year=config.periods_per_year,
    )
    return BacktestResult(
        metrics=metrics,
        equity_curve=[float(v) for v in equity],
        timestamps=[str(t) for t in timestamps],
        trades=trades,
        backend="pandas-fallback",
    )
