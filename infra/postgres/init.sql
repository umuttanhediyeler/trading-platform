-- TimescaleDB bootstrap — runs once when the Postgres data volume is first created.
--
-- Prisma (apps/api) is the single migration authority for the application tables
-- (User, Subscription, Signal, ...). This file is intentionally limited to the
-- Timescale extension and the `bars` time-series table, which is a hypertable and
-- therefore easiest to define here rather than through Prisma.

-- 1. Enable the TimescaleDB extension.
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- 2. OHLCV time-series table (see cursor_detailed_spec.md §7 and master FAZ 2).
--    Composite PK includes the partitioning column, as required by hypertables.
CREATE TABLE IF NOT EXISTS bars (
    symbol      TEXT             NOT NULL,
    "timestamp" TIMESTAMPTZ      NOT NULL,
    open        DOUBLE PRECISION NOT NULL,
    high        DOUBLE PRECISION NOT NULL,
    low         DOUBLE PRECISION NOT NULL,
    close       DOUBLE PRECISION NOT NULL,
    volume      DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (symbol, "timestamp")
);

-- 3. Convert `bars` into a TimescaleDB hypertable partitioned on `timestamp`.
--    if_not_exists keeps this idempotent; migrate_data handles pre-existing rows.
SELECT create_hypertable(
    'bars',
    'timestamp',
    if_not_exists => TRUE,
    migrate_data  => TRUE
);

-- 4. Common access pattern is "latest bars for a symbol", so index by symbol + time desc.
CREATE INDEX IF NOT EXISTS bars_symbol_time_idx
    ON bars (symbol, "timestamp" DESC);

-- 5. Optional: keep storage in check by compressing chunks older than 7 days.
--    Compression segments by symbol and orders by time for efficient scans.
ALTER TABLE bars SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'symbol',
    timescaledb.compress_orderby   = '"timestamp" DESC'
);

SELECT add_compression_policy('bars', INTERVAL '7 days', if_not_exists => TRUE);
