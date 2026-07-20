"""Triple-barrier labeling.

Labels look strictly *forward* from the entry bar; features look strictly
*backward*. Keeping that split explicit is what prevents look-ahead bias in
the training set: a label may use future bars (that is its job) but must
never be joined onto a feature row computed after the entry time.
"""

from __future__ import annotations

from typing import Literal

import pandas as pd

Label = Literal["tp", "sl", "timeout"]

# Numeric encoding used for training (multiclass target).
LABEL_TO_INT: dict[Label, int] = {"tp": 1, "sl": -1, "timeout": 0}


def triple_barrier_label(
    bars: pd.DataFrame,
    entry_idx: int,
    take_profit_pct: float,
    stop_loss_pct: float,
    max_hold_bars: int,
) -> Literal["tp", "sl", "timeout"]:
    """Look at bars strictly AFTER ``entry_idx`` and return which barrier is
    hit first.

    Entry price is the close of the entry bar. For each subsequent bar
    (up to ``max_hold_bars``) we check the intrabar high against the
    take-profit level and the intrabar low against the stop-loss level.
    If both barriers are touched within the same bar we cannot know the
    intrabar ordering, so we conservatively assume the stop was hit first
    ("sl"). If neither barrier is hit within the horizon, the label is
    "timeout".
    """
    if take_profit_pct <= 0 or stop_loss_pct <= 0:
        raise ValueError("take_profit_pct and stop_loss_pct must be positive")
    if max_hold_bars < 1:
        raise ValueError("max_hold_bars must be >= 1")
    if entry_idx < 0 or entry_idx >= len(bars):
        raise IndexError(f"entry_idx {entry_idx} out of range for {len(bars)} bars")

    entry_price = float(bars["close"].iloc[entry_idx])
    tp_level = entry_price * (1.0 + take_profit_pct)
    sl_level = entry_price * (1.0 - stop_loss_pct)

    end = min(entry_idx + max_hold_bars, len(bars) - 1)
    for i in range(entry_idx + 1, end + 1):
        hi = float(bars["high"].iloc[i])
        lo = float(bars["low"].iloc[i])
        hit_tp = hi >= tp_level
        hit_sl = lo <= sl_level
        if hit_sl:
            # Conservative: same-bar double touch counts as a stop.
            return "sl"
        if hit_tp:
            return "tp"
    return "timeout"


def label_dataset(
    bars: pd.DataFrame,
    take_profit_pct: float,
    stop_loss_pct: float,
    max_hold_bars: int,
) -> pd.Series:
    """Label bars that have a *complete* forward horizon.

    The last ``max_hold_bars`` rows are censored (None). Using a partial
    horizon would understate timeouts / inflate early barrier hits near
    the end of the sample — a subtle form of leakage.
    """
    labels: list[str | None] = []
    # Need the full hold window after entry (entry+1 .. entry+max_hold_bars).
    last_labelable = len(bars) - 1 - max_hold_bars
    for i in range(len(bars)):
        if i > last_labelable:
            labels.append(None)
        else:
            labels.append(
                triple_barrier_label(
                    bars, i, take_profit_pct, stop_loss_pct, max_hold_bars
                )
            )
    return pd.Series(labels, index=bars.index, dtype="object", name="label")
