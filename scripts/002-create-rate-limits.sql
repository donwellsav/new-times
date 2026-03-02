-- Rate limiting table: tracks write-operation counts per IP per sliding window.
-- Replaces the in-memory Map that resets on every serverless cold start.

CREATE TABLE IF NOT EXISTS rate_limits (
  ip          TEXT        NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count       INTEGER     NOT NULL DEFAULT 1,
  PRIMARY KEY (ip, window_start)
);

-- Auto-clean rows older than 2 minutes so the table doesn't grow unbounded.
-- Neon does not support pg_cron in all tiers, so cleanup runs opportunistically
-- in the application layer (see lib/rateLimit.ts pruneOldRows).
CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON rate_limits (window_start);
