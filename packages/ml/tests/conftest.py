import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

# Make `app` importable when tests are run from the package root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def make_bars(n: int = 400, seed: int = 42, freq: str = "D") -> pd.DataFrame:
    """Synthetic but realistic OHLCV series (geometric random walk)."""
    rng = np.random.default_rng(seed)
    returns = rng.normal(0.0005, 0.02, n)
    close = 100.0 * np.exp(np.cumsum(returns))
    open_ = close * (1 + rng.normal(0, 0.003, n))
    high = np.maximum(open_, close) * (1 + np.abs(rng.normal(0, 0.008, n)))
    low = np.minimum(open_, close) * (1 - np.abs(rng.normal(0, 0.008, n)))
    volume = rng.integers(100_000, 5_000_000, n).astype(float)
    return pd.DataFrame(
        {
            "timestamp": pd.date_range("2023-01-02", periods=n, freq=freq),
            "open": open_,
            "high": high,
            "low": low,
            "close": close,
            "volume": volume,
        }
    )


@pytest.fixture
def bars() -> pd.DataFrame:
    return make_bars()
