"""Backtest FastAPI service.

Endpoint: POST /backtest/run — called by apps/api via BACKTEST_SERVICE_URL
(http://localhost:8002), never directly by the web frontend.

The caller supplies OHLCV bars and either explicit entry/exit signal arrays
or a named built-in strategy with parameters. Signals are interpreted as
"observed at bar t's close" and filled at t+1's open by the engine.
"""

from __future__ import annotations

import logging
import os
from typing import Literal

import pandas as pd
import sentry_sdk
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, model_validator

from app.engine import HAS_VECTORBT, BacktestConfig, run_backtest

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)

if os.environ.get("SENTRY_DSN"):
    sentry_sdk.init(
        dsn=os.environ["SENTRY_DSN"],
        environment=os.environ.get("SENTRY_ENVIRONMENT", "development"),
        traces_sample_rate=0.1,
    )

app = FastAPI(title="Backtest Service", version="0.1.0")


class Bar(BaseModel):
    timestamp: str
    open: float = Field(ge=0, allow_inf_nan=False)
    high: float = Field(ge=0, allow_inf_nan=False)
    low: float = Field(ge=0, allow_inf_nan=False)
    close: float = Field(ge=0, allow_inf_nan=False)
    volume: float = Field(ge=0, allow_inf_nan=False)

    @model_validator(mode="after")
    def check_price_range(self) -> "Bar":
        if self.high < self.low:
            raise ValueError("bar high must be greater than or equal to low")
        return self


class StrategySpec(BaseModel):
    """Built-in strategies (all computed from trailing data only)."""

    name: str = Field(
        description=(
            "sma_cross | rsi_reversal | macd_cross | "
            "bollinger_revert | donchian_breakout"
        )
    )
    fast: int = Field(default=10, ge=2, le=200)
    slow: int = Field(default=30, ge=3, le=400)
    allow_short: bool = False
    rsi_period: int = Field(default=14, ge=2, le=100)
    rsi_buy_below: float = Field(default=30.0, ge=1.0, le=49.0)
    rsi_sell_above: float = Field(default=70.0, ge=51.0, le=99.0)
    signal_period: int = Field(default=9, ge=2, le=100)
    period: int = Field(default=20, ge=2, le=300)
    num_std: float = Field(default=2.0, ge=0.5, le=5.0)
    breakout_period: int = Field(default=20, ge=2, le=300)
    exit_period: int = Field(default=10, ge=2, le=300)

    @model_validator(mode="after")
    def check_strategy_params(self) -> "StrategySpec":
        supported = {
            "sma_cross",
            "rsi_reversal",
            "macd_cross",
            "bollinger_revert",
            "donchian_breakout",
        }
        if self.name not in supported:
            raise ValueError(f"unknown strategy '{self.name}'")
        if self.name in {"sma_cross", "macd_cross"} and self.fast >= self.slow:
            raise ValueError(f"{self.name} requires fast < slow")
        if self.name == "rsi_reversal" and self.rsi_buy_below >= self.rsi_sell_above:
            raise ValueError("rsi_reversal requires buy threshold < sell threshold")
        if self.name == "donchian_breakout" and self.exit_period > self.breakout_period:
            raise ValueError("donchian_breakout requires exit_period <= breakout_period")
        return self


STRATEGY_CATALOG = [
    {
        "id": "sma_cross",
        "name": "SMA Crossover",
        "category": "trend-following",
        "description": (
            "Kısa dönemli hareketli ortalama uzun dönemli ortalamayı geçtiğinde trend yönünde "
            "pozisyon alır. Belirgin ve kalıcı trendlerde iyi çalışır; yatay piyasalarda sık yön "
            "değişimi, gecikmeli sinyaller ve artan işlem maliyetleri temel riskleridir."
        ),
        "params": [
            {"name": "fast", "label": "Hızlı SMA", "type": "number", "default": 10, "min": 2, "max": 200},
            {"name": "slow", "label": "Yavaş SMA", "type": "number", "default": 30, "min": 3, "max": 400},
            {"name": "allow_short", "label": "Kısa pozisyona izin ver", "type": "boolean", "default": False},
        ],
    },
    {
        "id": "rsi_reversal",
        "name": "RSI Reversal",
        "category": "mean-reversion",
        "description": (
            "RSI aşırı satım eşiğinin altına indiğinde alır, aşırı alım eşiğini geçtiğinde çıkar. "
            "Bant içinde dalgalanan ve ortalamaya dönme eğilimi güçlü piyasalarda etkilidir; güçlü "
            "trendlerde erken giriş yaparak uzun süre zararda kalabilir."
        ),
        "params": [
            {"name": "rsi_period", "label": "RSI periyodu", "type": "number", "default": 14, "min": 2, "max": 100},
            {"name": "rsi_buy_below", "label": "Alım eşiği", "type": "number", "default": 30, "min": 1, "max": 49},
            {"name": "rsi_sell_above", "label": "Satış eşiği", "type": "number", "default": 70, "min": 51, "max": 99},
        ],
    },
    {
        "id": "macd_cross",
        "name": "MACD Crossover",
        "category": "trend-following",
        "description": (
            "Hızlı ve yavaş üssel ortalamaların farkı olan MACD çizgisini sinyal çizgisiyle "
            "karşılaştırarak trend yönünü izler. Orta ve uzun soluklu trendlerde güçlüdür; yatay "
            "piyasalarda sahte kesişimler ve göstergenin gecikmesi kayıp serilerine yol açabilir."
        ),
        "params": [
            {"name": "fast", "label": "Hızlı EMA", "type": "number", "default": 12, "min": 2, "max": 100},
            {"name": "slow", "label": "Yavaş EMA", "type": "number", "default": 26, "min": 3, "max": 200},
            {"name": "signal_period", "label": "Sinyal EMA", "type": "number", "default": 9, "min": 2, "max": 100},
            {"name": "allow_short", "label": "Kısa pozisyona izin ver", "type": "boolean", "default": False},
        ],
    },
    {
        "id": "bollinger_revert",
        "name": "Bollinger Mean Reversion",
        "category": "mean-reversion",
        "description": (
            "Fiyat alt Bollinger bandının altına düştüğünde alır ve orta banda döndüğünde çıkar. "
            "Dengeli, yatay ve oynaklığı sınırlı piyasalarda iyi çalışır; sert düşüş trendlerinde "
            "düşen bıçağı yakalama ve oynaklık genişlemesinde erken giriş riski taşır."
        ),
        "params": [
            {"name": "period", "label": "Bant periyodu", "type": "number", "default": 20, "min": 2, "max": 300},
            {"name": "num_std", "label": "Standart sapma katsayısı", "type": "number", "default": 2.0, "min": 0.5, "max": 5.0},
        ],
    },
    {
        "id": "donchian_breakout",
        "name": "Donchian Breakout",
        "category": "breakout",
        "description": (
            "Fiyat önceki N günün zirvesini aştığında trende katılır, daha kısa dönemli dip "
            "kırıldığında çıkar; kısa yön seçeneği bunun simetriğini uygular. Güçlü kırılma ve "
            "trend dönemlerinde etkilidir; başarısız kırılmalar sık küçük zararlara neden olabilir."
        ),
        "params": [
            {"name": "breakout_period", "label": "Kırılma periyodu", "type": "number", "default": 20, "min": 2, "max": 300},
            {"name": "exit_period", "label": "Çıkış periyodu", "type": "number", "default": 10, "min": 2, "max": 300},
            {"name": "allow_short", "label": "Kısa pozisyona izin ver", "type": "boolean", "default": False},
        ],
    },
]


class BacktestRequest(BaseModel):
    symbol: str = "UNKNOWN"
    bars: list[Bar] = Field(min_length=2)
    entries: list[bool] | None = None
    exits: list[bool] | None = None
    signals: list[Literal[-1, 0, 1]] | None = None
    strategy: StrategySpec | None = None
    initial_cash: float = 100_000.0
    commission_pct: float = 0.001
    slippage_pct: float = 0.0005

    @model_validator(mode="after")
    def check_signal_source(self) -> "BacktestRequest":
        has_arrays = self.entries is not None and self.exits is not None
        sources = int(has_arrays) + int(self.signals is not None) + int(self.strategy is not None)
        if sources != 1:
            raise ValueError(
                "provide exactly one of signals, entries+exits arrays, or a strategy spec"
            )
        if (self.entries is None) != (self.exits is None):
            raise ValueError("entries and exits must be provided together")
        if has_arrays and (
            len(self.entries) != len(self.bars) or len(self.exits) != len(self.bars)
        ):
            raise ValueError("entries and exits must match the number of bars")
        if self.signals is not None and len(self.signals) != len(self.bars):
            raise ValueError("signals must match the number of bars")
        timestamps = [bar.timestamp for bar in self.bars]
        if len(timestamps) != len(set(timestamps)):
            raise ValueError("bars contain duplicate timestamps")
        return self


def _bars_frame(bars: list[Bar]) -> pd.DataFrame:
    df = pd.DataFrame([b.model_dump() for b in bars])
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    return df.reset_index(drop=True)


def _strategy_signals(
    bars: pd.DataFrame, spec: StrategySpec
) -> pd.Series:
    close = bars["close"].astype(float)
    if spec.name == "sma_cross":
        fast = close.rolling(spec.fast, min_periods=spec.fast).mean()
        slow = close.rolling(spec.slow, min_periods=spec.slow).mean()
        ready = fast.notna() & slow.notna()
        targets = pd.Series(0, index=bars.index, dtype="int8")
        targets.loc[ready & (fast > slow)] = 1
        if spec.allow_short:
            targets.loc[ready & (fast < slow)] = -1
        return targets
    if spec.name == "rsi_reversal":
        delta = close.diff()
        gain = delta.clip(lower=0.0).ewm(alpha=1 / spec.rsi_period, adjust=False).mean()
        loss = (-delta).clip(lower=0.0).ewm(alpha=1 / spec.rsi_period, adjust=False).mean()
        rs = gain / loss.replace(0.0, float("nan"))
        rsi = (100.0 - 100.0 / (1.0 + rs)).fillna(50.0)
        target = 0
        targets: list[int] = []
        for value in rsi:
            if value < spec.rsi_buy_below:
                target = 1
            elif value > spec.rsi_sell_above:
                target = 0
            targets.append(target)
        return pd.Series(targets, dtype="int8")
    if spec.name == "macd_cross":
        fast_ema = close.ewm(span=spec.fast, adjust=False, min_periods=spec.fast).mean()
        slow_ema = close.ewm(span=spec.slow, adjust=False, min_periods=spec.slow).mean()
        macd = fast_ema - slow_ema
        signal = macd.ewm(
            span=spec.signal_period,
            adjust=False,
            min_periods=spec.signal_period,
        ).mean()
        ready = macd.notna() & signal.notna()
        targets = pd.Series(0, index=bars.index, dtype="int8")
        targets.loc[ready & (macd > signal)] = 1
        if spec.allow_short:
            targets.loc[ready & (macd < signal)] = -1
        return targets
    if spec.name == "bollinger_revert":
        middle = close.rolling(spec.period, min_periods=spec.period).mean()
        std = close.rolling(spec.period, min_periods=spec.period).std(ddof=0)
        lower = middle - spec.num_std * std
        target = 0
        targets: list[int] = []
        for price, mid, lower_band in zip(close, middle, lower):
            if pd.notna(lower_band) and price < lower_band:
                target = 1
            elif target == 1 and pd.notna(mid) and price >= mid:
                target = 0
            targets.append(target)
        return pd.Series(targets, dtype="int8")
    if spec.name == "donchian_breakout":
        # Shift channels so today's close is compared only with completed bars.
        prior_high = close.shift(1).rolling(
            spec.breakout_period, min_periods=spec.breakout_period
        ).max()
        prior_low = close.shift(1).rolling(
            spec.breakout_period, min_periods=spec.breakout_period
        ).min()
        exit_high = close.shift(1).rolling(
            spec.exit_period, min_periods=spec.exit_period
        ).max()
        exit_low = close.shift(1).rolling(
            spec.exit_period, min_periods=spec.exit_period
        ).min()
        target = 0
        targets: list[int] = []
        for price, high, low, short_exit, long_exit in zip(
            close, prior_high, prior_low, exit_high, exit_low
        ):
            if target == 0 and pd.notna(high) and price > high:
                target = 1
            elif target == 1 and pd.notna(long_exit) and price < long_exit:
                target = 0
            elif spec.allow_short and target == 0 and pd.notna(low) and price < low:
                target = -1
            elif target == -1 and pd.notna(short_exit) and price > short_exit:
                target = 0
            targets.append(target)
        return pd.Series(targets, dtype="int8")
    raise ValueError(f"unknown strategy '{spec.name}'")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "vectorbt": HAS_VECTORBT}


@app.get("/ready")
def ready() -> dict:
    return {"status": "ready", "vectorbt": HAS_VECTORBT}


@app.get("/strategies")
def strategies() -> list[dict]:
    return STRATEGY_CATALOG


@app.post("/backtest/run")
def backtest_run(payload: BacktestRequest) -> dict:
    try:
        bars = _bars_frame(payload.bars)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"invalid bars: {exc}") from exc

    if payload.entries is not None and payload.exits is not None:
        entries = pd.Series(payload.entries)
        exits = pd.Series(payload.exits)
        signals = None
    elif payload.signals is not None:
        entries = None
        exits = None
        signals = pd.Series(payload.signals)
    else:
        try:
            signals = _strategy_signals(bars, payload.strategy)
            entries = None
            exits = None
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    config = BacktestConfig(
        initial_cash=payload.initial_cash,
        commission_pct=payload.commission_pct,
        slippage_pct=payload.slippage_pct,
    )
    try:
        result = run_backtest(bars, entries, exits, config, signals=signals)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return {"symbol": payload.symbol, **result.to_dict()}
