"""Curated 5-model portfolio aligned with triple-barrier strategy profiles.

PRIMARY production path is `tb_balanced` (see apps/api strategy-policy.ts and
ML_FORCE_BALANCED=1). These slots are the ALTERNATIVE path: train + shadow soak
first, hard-promote only, kill-switch back to balanced if live quality drops.
"""

from __future__ import annotations

import logging
from typing import Any

import pandas as pd

from app.nightly_job import STRATEGY_CANDIDATES
from app.train import train_from_bars

logger = logging.getLogger(__name__)

# Fixed portfolio — order is stable for UI / ops.
PORTFOLIO_SLOTS: tuple[str, ...] = (
    "tb_tight_scalp",
    "tb_balanced",
    "tb_wide_swing",
    "tb_momentum",
    "tb_mean_revert",
)

assert set(PORTFOLIO_SLOTS) == set(STRATEGY_CANDIDATES.keys())


def pick_strategy_id(regime: str, confidence: float = 0.6) -> str:
    """Mirror apps/api pickStrategyId — quality-first (prefer tb_balanced)."""
    conf = confidence if confidence == confidence else 0.6  # NaN guard
    normalized = (regime or "").strip().lower()

    if normalized in ("high_vol", "high-vol"):
        return "tb_wide_swing" if conf >= 0.78 else "tb_balanced"
    if normalized in ("trend", "trending"):
        return "tb_wide_swing" if conf >= 0.78 else "tb_balanced"
    if normalized in ("range", "ranging", "mean_revert", "mean-reversion"):
        return "tb_balanced"
    if conf >= 0.8:
        return "tb_wide_swing"
    return "tb_balanced"


def slot_params(strategy_id: str) -> dict[str, float | int]:
    if strategy_id not in STRATEGY_CANDIDATES:
        raise ValueError(f"unknown portfolio slot '{strategy_id}'")
    return STRATEGY_CANDIDATES[strategy_id]


def train_slot(
    strategy_id: str,
    bars: pd.DataFrame,
) -> dict[str, Any]:
    """Walk-forward train one portfolio slot; returns metrics + fitted model."""
    params = slot_params(strategy_id)
    results = train_from_bars(
        bars,
        take_profit_pct=float(params["take_profit_pct"]),
        stop_loss_pct=float(params["stop_loss_pct"]),
        max_hold_bars=int(params["max_hold_bars"]),
    )
    if not results:
        raise ValueError(f"no walk-forward windows for {strategy_id}")
    last = results[-1]
    return {
        "strategy_id": strategy_id,
        "precision": float(sum(r.precision for r in results) / len(results)),
        "recall": float(sum(r.recall for r in results) / len(results)),
        "expectancy": float(sum(r.expectancy for r in results) / len(results)),
        "max_drawdown": float(sum(r.max_drawdown for r in results) / len(results)),
        "training_samples": int(sum(r.n_test for r in results)),
        "regime": last.regime,
        "tp_threshold": last.tp_threshold,
        "model": last.model,
        "windows": [r.to_dict() for r in results],
    }
