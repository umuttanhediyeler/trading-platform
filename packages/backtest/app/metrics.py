"""Performance metrics: Sharpe, drawdown, expectancy, win rate, profit factor.

All functions take plain pandas/numpy inputs so they work identically for
the vectorbt engine and the pandas fallback engine.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

TRADING_DAYS_PER_YEAR = 252


def total_return(equity_curve: pd.Series) -> float:
    if len(equity_curve) < 2 or equity_curve.iloc[0] == 0:
        return 0.0
    return float(equity_curve.iloc[-1] / equity_curve.iloc[0] - 1.0)


def sharpe_ratio(
    returns: pd.Series,
    risk_free_rate: float = 0.0,
    periods_per_year: int = TRADING_DAYS_PER_YEAR,
) -> float:
    """Annualized Sharpe ratio of periodic returns."""
    if len(returns) < 2:
        return 0.0
    excess = returns - risk_free_rate / periods_per_year
    std = excess.std(ddof=1)
    if std == 0 or np.isnan(std):
        return 0.0
    return float(excess.mean() / std * np.sqrt(periods_per_year))


def max_drawdown(equity_curve: pd.Series) -> float:
    """Maximum peak-to-trough decline as a positive fraction (0.25 = -25%)."""
    if len(equity_curve) < 2:
        return 0.0
    running_max = equity_curve.cummax()
    drawdown = (equity_curve - running_max) / running_max
    return float(-drawdown.min())


def win_rate(trade_pnls: pd.Series) -> float:
    if len(trade_pnls) == 0:
        return 0.0
    return float((trade_pnls > 0).mean())


def expectancy(trade_pnls: pd.Series) -> float:
    """Average PnL per trade (in the same units as the input)."""
    if len(trade_pnls) == 0:
        return 0.0
    return float(trade_pnls.mean())


def profit_factor(trade_pnls: pd.Series) -> float:
    """Gross profit / gross loss. Infinite (capped) when there are no losses."""
    gross_profit = float(trade_pnls[trade_pnls > 0].sum())
    gross_loss = float(-trade_pnls[trade_pnls < 0].sum())
    if gross_loss == 0:
        return float("inf") if gross_profit > 0 else 0.0
    return gross_profit / gross_loss


def compute_all_metrics(
    equity_curve: pd.Series,
    returns: pd.Series,
    trade_pnls: pd.Series,
    periods_per_year: int = TRADING_DAYS_PER_YEAR,
) -> dict:
    pf = profit_factor(trade_pnls)
    return {
        "total_return": total_return(equity_curve),
        "sharpe_ratio": sharpe_ratio(returns, periods_per_year=periods_per_year),
        "max_drawdown": max_drawdown(equity_curve),
        "win_rate": win_rate(trade_pnls),
        "expectancy": expectancy(trade_pnls),
        "profit_factor": pf if np.isfinite(pf) else None,
        "num_trades": int(len(trade_pnls)),
    }
