"""Leakage-safe feature engineering.

Every feature at row ``t`` is computed exclusively from bars ``<= t``.
Hard rules enforced here:

* Only trailing/rolling windows (``rolling``, ``ewm``, ``shift(+N)``).
* ``shift(-N)`` (negative shift, i.e. future data) is FORBIDDEN.
* ``tests/test_leakage.py`` verifies that truncating the input at ``t``
  (``bars.iloc[:t+1]``) leaves the feature values at ``t`` unchanged.

Indicators are implemented with plain pandas so the module has no hard
dependency on ``pandas-ta``; if ``pandas-ta`` is importable it is only used
as an optional cross-check, never as the source of truth.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

REQUIRED_COLUMNS = ("timestamp", "open", "high", "low", "close", "volume")

# Columns produced by compute_features, in output order.
FEATURE_COLUMNS: tuple[str, ...] = (
    "ret_1",
    "ret_5",
    "ret_10",
    "momentum_10",
    "log_volume",
    "volume_ratio_20",
    "dollar_volume_z_20",
    "rsi_14",
    "atr_14",
    "atr_pct_14",
    "adx_14",
    "macd",
    "macd_signal",
    "macd_hist",
    "sma_20_dist",
    "sma_50_dist",
    "ema_20_dist",
    "bb_percent_b",
    "bb_bandwidth",
    "gap_percent",
    "intraday_range_pos",
    "high_low_range_pct",
    "volatility_20",
    "close_vs_high_20",
    "close_vs_low_20",
    "up_streak_5",
)


def _validate(bars: pd.DataFrame) -> None:
    missing = [c for c in REQUIRED_COLUMNS if c not in bars.columns]
    if missing:
        raise ValueError(f"bars is missing required columns: {missing}")
    if len(bars) == 0:
        raise ValueError("bars is empty")
    ts = pd.to_datetime(bars["timestamp"])
    if not ts.is_monotonic_increasing:
        raise ValueError("bars must be sorted by timestamp ascending")


def _wilder_ema(series: pd.Series, period: int) -> pd.Series:
    # Wilder's smoothing == EMA with alpha = 1/period. Trailing-only.
    return series.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()


def _rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = (-delta).clip(lower=0.0)
    avg_gain = _wilder_ema(gain, period)
    avg_loss = _wilder_ema(loss, period)
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    rsi = 100.0 - 100.0 / (1.0 + rs)
    # When avg_loss == 0 the market only went up: RSI is 100 by convention.
    rsi = rsi.where(avg_loss != 0.0, 100.0)
    return rsi.where(avg_gain.notna() & avg_loss.notna())


def _true_range(bars: pd.DataFrame) -> pd.Series:
    prev_close = bars["close"].shift(1)
    tr = pd.concat(
        [
            bars["high"] - bars["low"],
            (bars["high"] - prev_close).abs(),
            (bars["low"] - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return tr


def _atr(bars: pd.DataFrame, period: int = 14) -> pd.Series:
    return _wilder_ema(_true_range(bars), period)


def _adx(bars: pd.DataFrame, period: int = 14) -> pd.Series:
    up_move = bars["high"].diff()
    down_move = -bars["low"].diff()
    plus_dm = up_move.where((up_move > down_move) & (up_move > 0), 0.0)
    minus_dm = down_move.where((down_move > up_move) & (down_move > 0), 0.0)
    atr = _atr(bars, period)
    plus_di = 100.0 * _wilder_ema(plus_dm, period) / atr.replace(0.0, np.nan)
    minus_di = 100.0 * _wilder_ema(minus_dm, period) / atr.replace(0.0, np.nan)
    di_sum = (plus_di + minus_di).replace(0.0, np.nan)
    dx = 100.0 * (plus_di - minus_di).abs() / di_sum
    return _wilder_ema(dx, period)


def compute_features(bars: pd.DataFrame) -> pd.DataFrame:
    """bars: columns=[timestamp, open, high, low, close, volume], time-sorted.

    Returns a DataFrame on the same index containing the feature columns
    listed in ``FEATURE_COLUMNS``. No column may use data from after time
    ``t`` (rolling windows look backwards only; ``shift(-N)`` is forbidden).
    """
    _validate(bars)
    close = bars["close"].astype(float)
    open_ = bars["open"].astype(float)
    high = bars["high"].astype(float)
    low = bars["low"].astype(float)
    volume = bars["volume"].astype(float)

    out = pd.DataFrame(index=bars.index)

    # Returns / momentum (past-only via positive shift).
    out["ret_1"] = close.pct_change(1)
    out["ret_5"] = close.pct_change(5)
    out["ret_10"] = close.pct_change(10)
    out["momentum_10"] = close / close.shift(10) - 1.0

    # Volume.
    out["log_volume"] = np.log1p(volume)
    vol_mean_20 = volume.rolling(20, min_periods=20).mean()
    out["volume_ratio_20"] = volume / vol_mean_20.replace(0.0, np.nan)
    dollar_vol = close * volume
    dv_mean = dollar_vol.rolling(20, min_periods=20).mean()
    dv_std = dollar_vol.rolling(20, min_periods=20).std()
    out["dollar_volume_z_20"] = (dollar_vol - dv_mean) / dv_std.replace(0.0, np.nan)

    # Oscillators / volatility.
    out["rsi_14"] = _rsi(close, 14)
    atr14 = _atr(bars, 14)
    out["atr_14"] = atr14
    out["atr_pct_14"] = atr14 / close
    out["adx_14"] = _adx(bars, 14)

    # MACD (12/26/9) using trailing EMAs only.
    ema12 = close.ewm(span=12, adjust=False, min_periods=12).mean()
    ema26 = close.ewm(span=26, adjust=False, min_periods=26).mean()
    macd = ema12 - ema26
    macd_signal = macd.ewm(span=9, adjust=False, min_periods=9).mean()
    out["macd"] = macd
    out["macd_signal"] = macd_signal
    out["macd_hist"] = macd - macd_signal

    # Moving-average distances.
    sma20 = close.rolling(20, min_periods=20).mean()
    sma50 = close.rolling(50, min_periods=50).mean()
    ema20 = close.ewm(span=20, adjust=False, min_periods=20).mean()
    out["sma_20_dist"] = close / sma20 - 1.0
    out["sma_50_dist"] = close / sma50 - 1.0
    out["ema_20_dist"] = close / ema20 - 1.0

    # Bollinger bands (20, 2).
    bb_std = close.rolling(20, min_periods=20).std()
    bb_upper = sma20 + 2.0 * bb_std
    bb_lower = sma20 - 2.0 * bb_std
    band_width = (bb_upper - bb_lower).replace(0.0, np.nan)
    out["bb_percent_b"] = (close - bb_lower) / band_width
    out["bb_bandwidth"] = band_width / sma20

    # Gap and intraday structure.
    prev_close = close.shift(1)
    out["gap_percent"] = (open_ / prev_close - 1.0) * 100.0
    hl_range = (high - low).replace(0.0, np.nan)
    out["intraday_range_pos"] = (close - low) / hl_range
    out["high_low_range_pct"] = (high - low) / close

    # Rolling volatility and channel position.
    out["volatility_20"] = close.pct_change(1).rolling(20, min_periods=20).std()
    roll_high_20 = high.rolling(20, min_periods=20).max()
    roll_low_20 = low.rolling(20, min_periods=20).min()
    out["close_vs_high_20"] = close / roll_high_20 - 1.0
    out["close_vs_low_20"] = close / roll_low_20 - 1.0

    # Count of up-closes in the trailing 5 bars.
    up = (close.diff() > 0).astype(float)
    out["up_streak_5"] = up.rolling(5, min_periods=5).sum()

    return out[list(FEATURE_COLUMNS)]
