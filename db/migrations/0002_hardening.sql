-- TABULA RASA — hardening after the phase-16 security review (D-042).
-- Statements end with a semicolon at the end of a line; there are no procedural bodies.

-- Money a request cost beyond what was held for it is real money: it now counts against the
-- run's cap and the day's cap as well as the total, so it is kept where those are checked.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS overage_microusd bigint NOT NULL DEFAULT 0 CHECK (overage_microusd >= 0);

ALTER TABLE daily_spend ADD COLUMN IF NOT EXISTS overage_microusd bigint NOT NULL DEFAULT 0 CHECK (overage_microusd >= 0);

-- Why the kill switch is on, as a code the application can act on:
--   ''          as shipped, or set by the owner
--   'overage'   a request cost more than was reserved, or was charged after its hold was released
-- A switch that money tripped is released only with a typed phrase.
ALTER TABLE budget ADD COLUMN IF NOT EXISTS kill_code text NOT NULL DEFAULT '';

-- Signing out ends every session, not only the cookie in one browser: a session is valid only
-- while it carries the current epoch.
ALTER TABLE budget ADD COLUMN IF NOT EXISTS session_epoch integer NOT NULL DEFAULT 0;

-- Old rate-limit windows are deleted by window, so that deletion needs an index of its own.
CREATE INDEX IF NOT EXISTS rate_limits_window ON rate_limits (window_start);

-- A paid call's fate is found by its reservation: one row at most per reservation.
CREATE UNIQUE INDEX IF NOT EXISTS calls_reservation ON calls (reservation_id) WHERE reservation_id IS NOT NULL;

-- The live smoke test (scripts/live-smoke.ts): each run is authorized in words that name its
-- number, and a number is used once.
CREATE TABLE IF NOT EXISTS smoke_runs (
  n            integer PRIMARY KEY CHECK (n >= 1),
  at           timestamptz NOT NULL DEFAULT now(),
  run_id       text NOT NULL,
  max_microusd bigint NOT NULL CHECK (max_microusd > 0),
  outcome      text NOT NULL DEFAULT 'started'
);
