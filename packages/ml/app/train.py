"""Walk-forward model training.

The dataset is split strictly by time: a trailing training window followed
by an out-of-sample test window, then the whole pair slides forward. Random
``train_test_split`` is never used — shuffling across time is exactly the
kind of leakage ``tests/test_leakage.py`` exists to prevent.

Model backend: LightGBM when available, otherwise scikit-learn's
``HistGradientBoostingClassifier``. Both are gradient-boosted trees, so the
fallback keeps the service functional (e.g. on platforms where the lightgbm
wheel is unavailable) with comparable behaviour rather than failing to boot.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd
from sklearn.metrics import precision_score, recall_score

from app.features import FEATURE_COLUMNS, compute_features
from app.labeling import LABEL_TO_INT, label_dataset
from app.regime import classify_regime

logger = logging.getLogger(__name__)

# Broken installs (e.g. missing libomp on macOS) raise OSError instead of
# ImportError, so guard broadly: any failure to import means "use sklearn".
try:
    import lightgbm as lgb

    HAS_LIGHTGBM = True
except Exception:  # noqa: BLE001  # pragma: no cover - depends on environment
    lgb = None
    HAS_LIGHTGBM = False


@dataclass
class ModelResult:
    """Metrics and metadata for one walk-forward window."""

    window_start: str
    window_end: str
    test_start: str
    test_end: str
    precision: float
    recall: float
    expectancy: float
    max_drawdown: float
    regime: str
    n_train: int
    n_test: int
    backend: str
    feature_importance: dict[str, float] = field(default_factory=dict)
    tp_threshold: float = 0.5
    model: Any = None  # fitted estimator; excluded from API serialization

    def to_dict(self) -> dict:
        d = {
            "window_start": self.window_start,
            "window_end": self.window_end,
            "test_start": self.test_start,
            "test_end": self.test_end,
            "precision": self.precision,
            "recall": self.recall,
            "expectancy": self.expectancy,
            "max_drawdown": self.max_drawdown,
            "regime": self.regime,
            "n_train": self.n_train,
            "n_test": self.n_test,
            "backend": self.backend,
            "feature_importance": self.feature_importance,
            "tp_threshold": self.tp_threshold,
        }
        return d


def _make_classifier():
    # Balanced weights + slightly conservative leaves: TP is rare relative to
    # timeout/sl, so unweighted fits chase majority classes and tank precision.
    if HAS_LIGHTGBM:
        return (
            lgb.LGBMClassifier(
                n_estimators=300,
                learning_rate=0.04,
                num_leaves=24,
                min_child_samples=20,
                subsample=0.85,
                colsample_bytree=0.85,
                class_weight="balanced",
                verbose=-1,
            ),
            "lightgbm",
        )
    from sklearn.ensemble import HistGradientBoostingClassifier

    logger.warning("lightgbm not installed; falling back to sklearn HistGradientBoosting")
    # class_weight landed in sklearn>=1.2; omit when unavailable.
    try:
        return (
            HistGradientBoostingClassifier(
                max_iter=300,
                learning_rate=0.04,
                max_leaf_nodes=24,
                min_samples_leaf=20,
                class_weight="balanced",
            ),
            "sklearn",
        )
    except TypeError:
        return (
            HistGradientBoostingClassifier(
                max_iter=300,
                learning_rate=0.04,
                max_leaf_nodes=24,
                min_samples_leaf=20,
            ),
            "sklearn",
        )


def _tp_probability_threshold(
    clf: Any,
    X_val: np.ndarray,
    y_val: np.ndarray,
    tp: int,
    min_recall: float = 0.12,
) -> float:
    """Pick a TP probability floor on a held-out train slice.

    Argmax over three noisy classes rarely clears a 0.55 precision gate.
    Raising the TP floor trades recall for precision — what promotion cares about.
    """
    if not hasattr(clf, "predict_proba") or len(X_val) == 0:
        return 0.5
    classes = [int(c) for c in clf.classes_]
    if tp not in classes:
        return 0.5
    idx = classes.index(tp)
    p_tp = clf.predict_proba(X_val)[:, idx]
    best_t, best_prec = 0.5, -1.0
    for t in np.linspace(0.35, 0.78, 18):
        pred = p_tp >= t
        if int(pred.sum()) == 0:
            continue
        prec = float(precision_score(y_val == tp, pred, zero_division=0))
        rec = float(recall_score(y_val == tp, pred, zero_division=0))
        if rec < min_recall:
            continue
        # Prefer higher precision; break ties toward slightly higher recall.
        score = prec + 0.01 * rec
        if score > best_prec:
            best_prec = score
            best_t = float(t)
    return best_t


def _predict_with_tp_threshold(
    clf: Any, X: np.ndarray, tp: int, threshold: float
) -> np.ndarray:
    """Predict labels; emit TP only when P(tp) clears the calibrated floor."""
    if not hasattr(clf, "predict_proba"):
        return clf.predict(X)
    proba = clf.predict_proba(X)
    classes = np.asarray([int(c) for c in clf.classes_])
    if tp not in classes:
        return classes[np.argmax(proba, axis=1)]
    tp_idx = int(np.where(classes == tp)[0][0])
    out = np.empty(len(X), dtype=int)
    for i in range(len(X)):
        if proba[i, tp_idx] >= threshold:
            out[i] = tp
        else:
            # Mask TP so argmax cannot still pick a weak TP probability.
            row = proba[i].copy()
            row[tp_idx] = -1.0
            out[i] = int(classes[int(np.argmax(row))])
    return out


def build_training_frame(
    bars: pd.DataFrame,
    take_profit_pct: float = 0.02,
    stop_loss_pct: float = 0.01,
    max_hold_bars: int = 10,
) -> pd.DataFrame:
    """Join backward-looking features with forward-looking labels.

    Rows without complete features (warm-up period) or without a label
    (end of data) are dropped.
    """
    features = compute_features(bars)
    labels = label_dataset(bars, take_profit_pct, stop_loss_pct, max_hold_bars)
    df = features.copy()
    df["label"] = labels.map(lambda v: LABEL_TO_INT[v] if v is not None else np.nan)
    df["timestamp"] = pd.to_datetime(bars["timestamp"]).values
    df = df.dropna(subset=["label", *FEATURE_COLUMNS])
    df["label"] = df["label"].astype(int)
    return df


def _expectancy_and_drawdown(
    y_pred: np.ndarray, y_true: np.ndarray, tp_pct: float = 0.02, sl_pct: float = 0.01
) -> tuple[float, float]:
    """Expectancy per trade and max drawdown of the cumulative PnL of trades
    the model would have taken (predicted class == tp)."""
    taken = y_pred == LABEL_TO_INT["tp"]
    if not taken.any():
        return 0.0, 0.0
    outcomes = np.where(
        y_true[taken] == LABEL_TO_INT["tp"],
        tp_pct,
        np.where(y_true[taken] == LABEL_TO_INT["sl"], -sl_pct, 0.0),
    )
    expectancy = float(outcomes.mean())
    equity = np.cumsum(outcomes)
    peak = np.maximum.accumulate(np.concatenate([[0.0], equity]))[1:]
    max_dd = float(np.max(peak - equity)) if len(equity) else 0.0
    return expectancy, max_dd


def walk_forward_train(
    df: pd.DataFrame,
    train_window_days: int = 180,
    test_window_days: int = 30,
    purge_bars: int = 0,
) -> list[ModelResult]:
    """Split ``df`` by time into sliding train/test windows, train a model
    per window and return the metrics. NEVER uses random train_test_split.

    ``df`` must contain ``FEATURE_COLUMNS``, an integer ``label`` column and
    a ``timestamp`` column (see ``build_training_frame``). If the data span
    is too short for even one full window, the window sizes are shrunk
    (80/20 by time) so callers still get a result instead of an error —
    the shrunken window is flagged via the logged warning and smaller
    ``n_train``/``n_test``.
    """
    required = {"label", "timestamp", *FEATURE_COLUMNS}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"training frame missing columns: {sorted(missing)}")
    if len(df) < 30:
        raise ValueError(f"not enough labeled rows to train ({len(df)} < 30)")

    df = df.sort_values("timestamp").reset_index(drop=True)
    ts = pd.to_datetime(df["timestamp"])
    span_days = (ts.iloc[-1] - ts.iloc[0]).days

    if span_days < train_window_days + test_window_days:
        train_window_days = max(int(span_days * 0.8), 1)
        test_window_days = max(span_days - train_window_days, 1)
        logger.warning(
            "data span (%sd) shorter than requested windows; shrunk to train=%sd test=%sd",
            span_days,
            train_window_days,
            test_window_days,
        )

    results: list[ModelResult] = []
    window_start = ts.iloc[0]
    while True:
        train_end = window_start + pd.Timedelta(days=train_window_days)
        test_end = train_end + pd.Timedelta(days=test_window_days)
        train_mask = (ts >= window_start) & (ts < train_end)
        test_mask = (ts >= train_end) & (ts < test_end)
        if test_mask.sum() == 0:
            break
        train_df, test_df = df[train_mask], df[test_mask]
        # A label at the end of the training slice may look forward into the
        # test slice. Purge that full event horizon before fitting.
        if purge_bars > 0:
            train_df = train_df.iloc[:-purge_bars]
        if len(train_df) < 20 or test_df["label"].nunique() == 0:
            window_start = window_start + pd.Timedelta(days=test_window_days)
            continue

        X_train = train_df[list(FEATURE_COLUMNS)].to_numpy()
        y_train = train_df["label"].to_numpy()
        X_test = test_df[list(FEATURE_COLUMNS)].to_numpy()
        y_test = test_df["label"].to_numpy()

        clf, backend = _make_classifier()
        # Time-ordered holdout inside the train slice for threshold calibration
        # (never use the test fold — that would inflate promotion metrics).
        val_n = max(int(len(train_df) * 0.2), 15)
        if len(train_df) - val_n < 20:
            fit_df, val_df = train_df, train_df.iloc[0:0]
        else:
            fit_df = train_df.iloc[:-val_n]
            val_df = train_df.iloc[-val_n:]
        X_fit = fit_df[list(FEATURE_COLUMNS)].to_numpy()
        y_fit = fit_df["label"].to_numpy()
        clf.fit(X_fit, y_fit)

        tp = LABEL_TO_INT["tp"]
        if len(val_df) > 0:
            X_val = val_df[list(FEATURE_COLUMNS)].to_numpy()
            y_val = val_df["label"].to_numpy()
            tp_threshold = _tp_probability_threshold(clf, X_val, y_val, tp)
        else:
            tp_threshold = 0.5

        y_pred = _predict_with_tp_threshold(clf, X_test, tp, tp_threshold)
        precision = float(
            precision_score(y_test == tp, y_pred == tp, zero_division=0)
        )
        recall = float(recall_score(y_test == tp, y_pred == tp, zero_division=0))
        expectancy, max_dd = _expectancy_and_drawdown(y_pred, y_test)

        importance: dict[str, float] = {}
        if hasattr(clf, "feature_importances_"):
            raw = np.asarray(clf.feature_importances_, dtype=float)
            total = raw.sum() or 1.0
            importance = {
                name: float(v / total) for name, v in zip(FEATURE_COLUMNS, raw)
            }

        results.append(
            ModelResult(
                window_start=str(window_start.date()),
                window_end=str(train_end.date()),
                test_start=str(train_end.date()),
                test_end=str(test_end.date()),
                precision=precision,
                recall=recall,
                expectancy=expectancy,
                max_drawdown=max_dd,
                regime="range",  # refined below when raw bars are available
                n_train=len(fit_df),
                n_test=len(test_df),
                backend=backend,
                feature_importance=importance,
                tp_threshold=tp_threshold,
                model=clf,
            )
        )
        window_start = window_start + pd.Timedelta(days=test_window_days)

    return results


def train_from_bars(
    bars: pd.DataFrame,
    train_window_days: int = 180,
    test_window_days: int = 30,
    take_profit_pct: float = 0.02,
    stop_loss_pct: float = 0.01,
    max_hold_bars: int = 10,
) -> list[ModelResult]:
    """End-to-end: bars -> features + labels -> walk-forward results, with
    the regime of the full history attached to each window."""
    df = build_training_frame(bars, take_profit_pct, stop_loss_pct, max_hold_bars)
    results = walk_forward_train(
        df,
        train_window_days,
        test_window_days,
        purge_bars=max_hold_bars,
    )
    bar_times = pd.to_datetime(bars["timestamp"])
    for r in results:
        # Regime metadata must use only information available before this
        # fold's test period, never the full future dataset.
        cutoff = pd.Timestamp(r.test_start)
        if bar_times.dt.tz is not None:
            cutoff = cutoff.tz_localize(bar_times.dt.tz)
        history = bars.loc[bar_times < cutoff]
        r.regime = classify_regime(history if len(history) >= 2 else bars.iloc[:2])
    return results
