"""Nightly strategy selection.

Triggered via the ``/nightly`` endpoint in ``main.py``. Scheduling lives in
``apps/api`` as a BullMQ repeatable job — the backend is the single
scheduling authority so all jobs are monitored in one place; this module
only does the work when asked.

Flow: re-evaluate candidate strategies on recent data, rank them, and write
the top selections for tomorrow into ``DailyStrategySelection``. When the
database is unavailable the selection is written to a local JSON file so the
run is observable and idempotent to retry.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from app.regime import classify_regime
from app.train import train_from_bars

logger = logging.getLogger(__name__)

TOP_N_STRATEGIES = 5

FALLBACK_SELECTION_PATH = Path(
    os.environ.get(
        "NIGHTLY_SELECTION_FALLBACK_PATH",
        str(Path(__file__).resolve().parents[1] / "data" / "daily-selection.json"),
    )
)

# Candidate strategies: named triple-barrier parameterizations that the
# nightly job re-evaluates against recent data.
STRATEGY_CANDIDATES: dict[str, dict[str, float | int]] = {
    "tb_tight_scalp": {"take_profit_pct": 0.01, "stop_loss_pct": 0.005, "max_hold_bars": 5},
    "tb_balanced": {"take_profit_pct": 0.02, "stop_loss_pct": 0.01, "max_hold_bars": 10},
    "tb_wide_swing": {"take_profit_pct": 0.04, "stop_loss_pct": 0.02, "max_hold_bars": 20},
    "tb_momentum": {"take_profit_pct": 0.03, "stop_loss_pct": 0.01, "max_hold_bars": 8},
    "tb_mean_revert": {"take_profit_pct": 0.015, "stop_loss_pct": 0.015, "max_hold_bars": 15},
}


def evaluate_strategies(bars: pd.DataFrame) -> list[dict]:
    """Run walk-forward training for each candidate and score it by mean
    out-of-sample expectancy (drawdown-penalized)."""
    scored: list[dict] = []
    for strategy_id, params in STRATEGY_CANDIDATES.items():
        try:
            results = train_from_bars(
                bars,
                take_profit_pct=float(params["take_profit_pct"]),
                stop_loss_pct=float(params["stop_loss_pct"]),
                max_hold_bars=int(params["max_hold_bars"]),
            )
        except ValueError as exc:
            logger.warning("strategy %s skipped: %s", strategy_id, exc)
            continue
        if not results:
            continue
        mean_expectancy = sum(r.expectancy for r in results) / len(results)
        mean_drawdown = sum(r.max_drawdown for r in results) / len(results)
        scored.append(
            {
                "strategyId": strategy_id,
                "score": mean_expectancy - 0.5 * mean_drawdown,
                "expectancy": mean_expectancy,
                "maxDrawdown": mean_drawdown,
                "windows": len(results),
            }
        )
    scored.sort(key=lambda s: s["score"], reverse=True)
    return scored


def _persist_selection(selections: list[dict], regime: str, date: datetime) -> str:
    try:
        from app.db import DailyStrategySelection, get_session

        with get_session() as session:
            # Idempotent: replace any existing selection for this date.
            session.query(DailyStrategySelection).filter(
                DailyStrategySelection.date == date
            ).delete()
            for rank, sel in enumerate(selections, start=1):
                session.add(
                    DailyStrategySelection(
                        date=date,
                        strategyId=sel["strategyId"],
                        regime=regime,
                        rank=rank,
                    )
                )
        return "db"
    except Exception as exc:  # noqa: BLE001 — DB down must not lose the run
        logger.warning("DailyStrategySelection write failed (%s); using file", exc)
        FALLBACK_SELECTION_PATH.parent.mkdir(parents=True, exist_ok=True)
        FALLBACK_SELECTION_PATH.write_text(
            json.dumps(
                {
                    "date": date.isoformat(),
                    "regime": regime,
                    "selections": selections,
                },
                indent=2,
            )
        )
        return f"file:{FALLBACK_SELECTION_PATH}"


def run_nightly(bars: pd.DataFrame) -> dict:
    """Full nightly pass: evaluate, rank, persist top strategies for the
    next session. Returns a summary payload for the /nightly endpoint."""
    regime = classify_regime(bars)
    scored = evaluate_strategies(bars)
    top = scored[:TOP_N_STRATEGIES]
    date = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    sink = _persist_selection(top, regime, date) if top else "none"
    return {
        "date": date.isoformat(),
        "regime": regime,
        "evaluated": len(scored),
        "selected": top,
        "persisted_to": sink,
    }
