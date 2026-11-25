-- TABULA RASA — budget ledger and live-run state.
--
-- Money is integer microdollars (1 USD = 1,000,000). Every invariant that matters is a CHECK
-- constraint, so that a bug in application code cannot overspend: the database refuses.
-- Statements end with a semicolon at the end of a line; there are no procedural bodies.

CREATE TABLE IF NOT EXISTS budget (
  id                   smallint PRIMARY KEY CHECK (id = 1),
  -- the most this application may ever spend, as set by the owner. Zero until they set it.
  authorized_microusd  bigint  NOT NULL DEFAULT 0 CHECK (authorized_microusd >= 0),
  -- the most it may spend in one UTC day
  daily_cap_microusd   bigint  NOT NULL DEFAULT 0 CHECK (daily_cap_microusd >= 0),
  -- held for requests that have been or may have been dispatched and are not yet settled
  reserved_microusd    bigint  NOT NULL DEFAULT 0 CHECK (reserved_microusd >= 0),
  -- provider-reported cost of settled requests (never more than was reserved for each)
  settled_microusd     bigint  NOT NULL DEFAULT 0 CHECK (settled_microusd >= 0),
  -- provider-reported cost beyond what was reserved (should never happen; trips the kill switch)
  overage_microusd     bigint  NOT NULL DEFAULT 0 CHECK (overage_microusd >= 0),
  -- fail closed: nothing may be reserved while this is true, and it starts true
  kill_switch          boolean NOT NULL DEFAULT true,
  kill_reason          text    NOT NULL DEFAULT 'never enabled',
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT budget_never_exceeded CHECK (reserved_microusd + settled_microusd <= authorized_microusd)
);

INSERT INTO budget (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS runs (
  id                 text PRIMARY KEY,
  title              text NOT NULL DEFAULT '',
  status             text NOT NULL CHECK (status IN ('active', 'paused', 'done', 'cancelled', 'failed')),
  status_reason      text NOT NULL DEFAULT '',
  provider           text NOT NULL,
  model              text NOT NULL,
  prompt_version     text NOT NULL,
  -- the most this run may spend, approved when it was created
  cap_microusd       bigint NOT NULL CHECK (cap_microusd >= 0),
  reserved_microusd  bigint NOT NULL DEFAULT 0 CHECK (reserved_microusd >= 0),
  settled_microusd   bigint NOT NULL DEFAULT 0 CHECK (settled_microusd >= 0),
  -- world configuration, run specification and scheduler state, as JSON text
  config             text NOT NULL,
  spec               text NOT NULL,
  sched              text NOT NULL,
  manifest           text NOT NULL DEFAULT '{}',
  -- the next epoch to decide, and the world at its first tick (gzip, base64)
  epoch              integer NOT NULL DEFAULT 0 CHECK (epoch >= 0),
  tick               integer NOT NULL DEFAULT 0,
  snapshot           text NOT NULL,
  digest             text NOT NULL,
  published          boolean NOT NULL DEFAULT false,
  lease_owner        text,
  lease_until        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT run_never_exceeded CHECK (reserved_microusd + settled_microusd <= cap_microusd)
);

CREATE TABLE IF NOT EXISTS daily_spend (
  day                date PRIMARY KEY,
  reserved_microusd  bigint NOT NULL DEFAULT 0 CHECK (reserved_microusd >= 0),
  settled_microusd   bigint NOT NULL DEFAULT 0 CHECK (settled_microusd >= 0)
);

-- One row per provider request the application has ever decided to make. The id is
-- deterministic (run : epoch : agent : attempt), which is what makes a retry idempotent.
CREATE TABLE IF NOT EXISTS reservations (
  id                  text PRIMARY KEY,
  run_id              text NOT NULL REFERENCES runs (id),
  day                 date NOT NULL,
  -- reserved: held, outcome not yet known · settled: the provider reported usage ·
  -- released: proven not to have been billed · unknown: dispatched, outcome unproven (stays held)
  state               text NOT NULL CHECK (state IN ('reserved', 'settled', 'released', 'unknown')),
  reserved_microusd   bigint NOT NULL CHECK (reserved_microusd >= 0),
  settled_microusd    bigint NOT NULL DEFAULT 0 CHECK (settled_microusd >= 0),
  overage_microusd    bigint NOT NULL DEFAULT 0 CHECK (overage_microusd >= 0),
  model               text NOT NULL,
  request_hash        text NOT NULL,
  input_tokens        integer,
  output_tokens       integer,
  cache_write_tokens  integer,
  cache_read_tokens   integer,
  provider_request_id text,
  note                text NOT NULL DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now(),
  settled_at          timestamptz
);

CREATE INDEX IF NOT EXISTS reservations_run ON reservations (run_id);

CREATE INDEX IF NOT EXISTS reservations_state ON reservations (state);

-- Every attempt to ask a mind, and what came back. A stored answer is never asked for again.
CREATE TABLE IF NOT EXISTS calls (
  run_id         text NOT NULL REFERENCES runs (id),
  epoch          integer NOT NULL,
  agent          integer NOT NULL,
  attempt        integer NOT NULL,
  status         text NOT NULL,
  reason         text NOT NULL DEFAULT '',
  request_hash   text NOT NULL DEFAULT '',
  reservation_id text,
  -- the call's result as JSON (the answer's JSON text and its bookkeeping; never model reasoning)
  result         text NOT NULL,
  latency_ms     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, epoch, agent, attempt)
);

-- One row per committed epoch: its tape (the decisions, as they must be replayed), the state
-- digest a replay must reproduce, the scheduler's trace and what became of each mind asked.
CREATE TABLE IF NOT EXISTS epochs (
  run_id     text NOT NULL REFERENCES runs (id),
  epoch      integer NOT NULL,
  from_tick  integer NOT NULL,
  to_tick    integer NOT NULL,
  digest     text NOT NULL,
  alive      integer NOT NULL,
  tape       text NOT NULL,
  trace      text NOT NULL,
  outcomes   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, epoch)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id      bigserial PRIMARY KEY,
  at      timestamptz NOT NULL DEFAULT now(),
  actor   text NOT NULL,
  action  text NOT NULL,
  detail  text NOT NULL DEFAULT '{}'
);

-- Fixed-window request counters shared by every instance.
CREATE TABLE IF NOT EXISTS rate_limits (
  key          text NOT NULL,
  window_start bigint NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
