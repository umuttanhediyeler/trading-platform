"""SQLAlchemy connection to the shared Postgres database.

The Prisma schema in ``apps/api`` is the single migration authority. This
module mirrors the tables the ML service touches — same table and column
names, same types — and only ever reads market data / writes to the tables
it owns (``ModelRegistry``, ``DailyStrategySelection``).
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Generator
from contextlib import contextmanager
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://user:pass@localhost:5432/trading"
)

Base = declarative_base()


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ModelRegistry(Base):
    """Mirror of the Prisma ``ModelRegistry`` model (ml service owns writes)."""

    __tablename__ = "ModelRegistry"

    id = Column(String, primary_key=True, default=_uuid)
    version = Column(String, nullable=False)
    trainedAt = Column(DateTime(timezone=True), nullable=False, default=_now)
    precision = Column(Float, nullable=False)
    recall = Column(Float, nullable=False)
    expectancy = Column(Float, nullable=False)
    maxDrawdown = Column(Float, nullable=False)
    regime = Column(String, nullable=False)
    strategyId = Column(String, nullable=True)
    isActive = Column(Boolean, nullable=False, default=False)
    status = Column(String, nullable=False, default="shadow")
    artifactPath = Column(String, nullable=True)
    artifactSha256 = Column(String, nullable=True)
    trainingSamples = Column(Integer, nullable=True)
    promotedAt = Column(DateTime(timezone=True), nullable=True)
    promotionReason = Column(String, nullable=True)
    shadowStartedAt = Column(DateTime(timezone=True), nullable=True)


class DailyStrategySelection(Base):
    """Mirror of the Prisma ``DailyStrategySelection`` model."""

    __tablename__ = "DailyStrategySelection"

    id = Column(String, primary_key=True, default=_uuid)
    date = Column(DateTime(timezone=True), nullable=False)
    strategyId = Column(String, nullable=False)
    regime = Column(String, nullable=False)
    rank = Column(Integer, nullable=False)


_engine = None
_SessionLocal: sessionmaker | None = None


def get_engine():
    """Lazily create the engine so importing this module never requires a
    live database (unit tests and offline development must work)."""
    global _engine, _SessionLocal
    if _engine is None:
        _engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)
        _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


@contextmanager
def get_session() -> Generator[Session, None, None]:
    get_engine()
    assert _SessionLocal is not None
    session = _SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
