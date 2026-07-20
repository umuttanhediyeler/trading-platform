"""Market regime classification: trend / range / high_vol.

Regimes match the values stored in ``DailyStrategySelection.regime`` and
``ModelRegistry.regime`` ("trend" | "range" | "high_vol"). Classification is
based on trailing ADX (trend strength) and ATR percentile (volatility), so
it is leakage-safe by construction.
"""

from __future__ import annotations

from typing import Literal

import pandas as pd

from app.features import _adx, _atr

Regime = Literal["trend", "range", "high_vol"]

REGIMES: tuple[Regime, ...] = ("trend", "range", "high_vol")

ADX_TREND_THRESHOLD = 25.0
ATR_HIGH_VOL_QUANTILE = 0.8
ATR_LOOKBACK = 252


def classify_regime_series(bars: pd.DataFrame, period: int = 14) -> pd.Series:
    """Classify each bar's regime using only trailing data.

    * high_vol: ATR% above its trailing ``ATR_LOOKBACK``-bar 80th percentile
    * trend:    ADX >= 25 (and not high_vol)
    * range:    everything else

    Early rows without enough history default to "range" (the least
    assumption-laden regime).
    """
    atr = _atr(bars, period)
    atr_pct = atr / bars["close"].astype(float)
    adx = _adx(bars, period)

    # Trailing quantile: rolling window ending at t, never looking forward.
    atr_threshold = atr_pct.rolling(ATR_LOOKBACK, min_periods=period * 2).quantile(
        ATR_HIGH_VOL_QUANTILE
    )

    regime = pd.Series("range", index=bars.index, dtype="object", name="regime")
    regime[adx >= ADX_TREND_THRESHOLD] = "trend"
    regime[atr_pct >= atr_threshold] = "high_vol"  # high_vol dominates trend
    return regime


def classify_regime(bars: pd.DataFrame, period: int = 14) -> Regime:
    """Return the current (latest bar) regime for the given bar history."""
    if len(bars) < period * 2:
        return "range"
    value = classify_regime_series(bars, period).iloc[-1]
    return value if value in REGIMES else "range"
