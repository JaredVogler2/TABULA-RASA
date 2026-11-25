# Security and threat model

Status: controls for the owner API, the budget ledger and model output were implemented and tested in phases
06–08 (2026-11-25); the whole document is re-audited in phase 16. A control is listed as **implemented** only
when a test in the repository exercises it, and the test is named.

## Assets

| Asset | Why it matters |
|---|---|
| `ANTHROPIC_API_KEY` | Direct financial exposure; must exist only in server environment variables. |
| Budget ledger | The only thing standing between a bug and real spend. |
| Owner session | Grants the ability to start live runs. |
| Simulation integrity | Results are only meaningful if state cannot be altered outside the engine. |
| Player saves | Local only; must not be corrupted by partial writes or malicious imports. |

## Trust boundaries

1. **Public browser ⇄ app.** Untrusted. May only fetch static assets, published recordings and `/api/health`.
2. **Owner browser ⇄ `/api/owner/*`, `/api/runs/*`.** Authenticated by a signed, HttpOnly, SameSite=Strict
   session cookie; state-changing requests additionally require a same-origin check and a token derived from
   the session (D-025). A visitor without a session can read `/api/recordings` and published runs, and nothing
   else.
3. **Server ⇄ PostgreSQL.** Trusted channel; all statements parameterised.
4. **Server ⇄ Anthropic API.** Outbound only, to the provider host only.
5. **Model output ⇄ engine.** **Untrusted data.** Parsed against a strict schema, then validated by the engine
   like any other intent. Never evaluated, never used to build SQL, URLs, file paths or prompts for other tools.
6. **Agent speech ⇄ other agents' prompts.** Untrusted in-world data, delimited and labelled as such.

## Threats and controls

| # | Threat | Control | Status |
|---|---|---|---|
| T1 | Key leaks into client bundle, logs or repo | Server-only modules (`server-only`, lint boundaries); no `NEXT_PUBLIC_` secrets; responses, audit entries and log lines carry codes, never provider messages or connection errors; `pnpm scan:secrets` over every tracked file and `pnpm scan:bundle` over everything sent to browsers, both in CI | **implemented** — `tests/unit/scans.test.ts` (each scan goes red on a planted leak), `api.test.ts` › "never puts a secret in a response, in the audit log or in the server's own log", `anthropic.test.ts` (the key appears in one request header and nowhere else), `prompt.test.ts` › "carries nothing from the server's environment" |
| T2 | Public user triggers paid calls | Every route that can reach a provider starts with the owner gate; the provider object is not even constructed before it passes; live mode additionally needs `LIVE_ENABLED=true`, a key, a priced model, a database, an authorized amount, the kill switch released and an approved, capped run | **implemented** — `api.test.ts` › "no request without the owner's session, origin and token changes anything or reaches a provider" (8 endpoints × 6 forgeries), `owner.spec.ts` against the real server |
| T3 | Overspend through concurrency or retries | Atomic conditional reservation before dispatch; deterministic reservation ids; unknown outcomes stay held; SDK retries off; CHECK constraints in the schema | **implemented** — `ledger.test.ts` (100 concurrent requests from two pools on PostgreSQL 16; 100 copies of one request granted once; property test over random operation sequences), `runs.test.ts` (two instances racing through a paid run) |
| T4 | CSRF against the owner | SameSite=Strict `__Host-` cookie; `Origin` must name this host; Fetch Metadata must say same-origin when present; per-session token header | **implemented** — `auth.test.ts` › "lets the owner's own page through and nobody else" |
| T5 | Brute-forcing the owner passphrase | scrypt (N = 2^15) hash in env; constant-time compare; five attempts a quarter of an hour per address and forty overall, counted in the database; one generic refusal | **implemented** — `auth.test.ts`, `api.test.ts` › "slows down anyone guessing it" |
| T6 | Prompt injection through in-world speech or names | Fixed rules text; other people's words stripped of control and direction-override characters, bounded, and quoted on one line after a fixed label; the answer schema can express nothing but in-world actions; the engine re-validates every id, quantity and authority | **implemented for what code can show** — `prompt.test.ts` › hostile speech (the page cannot be reshaped; a mind that obeys everything still achieves nothing forbidden). **Not shown:** that a real model resists; that is phase 16–17 and needs authorized calls |
| T7 | Malicious institution proposals (resource creation, privilege escalation, unbounded evaluation) | Declarative grammar only; validator with conservation and authority checks; fuel-limited interpreter; formulas written as text are parsed by a bounded parser and then validated like any other | **implemented** — `institutions.test.ts`, `formula.test.ts` (1,500-case fuzz), `wire.test.ts` |
| T8 | Raw API proxying | No endpoint accepts prompt text, a model name or a key. The server composes every request from its own stored world; a client sends a run id | **implemented** — by construction (`api.ts`), and `api.test.ts` › world knobs outside the allowed list are ignored |
| T9 | Denial of wallet / denial of service | Per-run, per-day and total ceilings; kill switch (on by default); bounded JSON bodies (16 KB); rate limits on sign-in, owner actions and public reads; a server-side run is limited to 120 people | **implemented** — `ledger.test.ts`, `auth.test.ts` › "reads only JSON, and only so much of it", `api.test.ts` |
| T10 | Malicious or corrupted save import | Schema validation, size limits, hash verification; imports are data, never code | planned (phase 13). A recording is validated before it is played and its world is checked against the recorded digest every epoch (`owner.spec.ts`) |
| T11 | XSS via model or user text | React text rendering only; no `dangerouslySetInnerHTML`; CSP restricts sources to `'self'`; no third-party scripts | CSP header implemented and asserted in E2E; the owner console and the recording viewer render run titles, notes and speech as text |
| T12 | Clickjacking | `frame-ancestors 'none'`, `X-Frame-Options: DENY` | implemented (header asserted in E2E) |
| T13 | Dependency compromise | Lockfile, pinned versions, `pnpm audit` in release checklist, license manifest | planned (phase 16) |
| T14 | A stolen owner passphrase | The authorized amount is itself the limit of the damage; the kill switch; a provider-side workspace spend limit; rotating `AUTH_SECRET` signs everyone out | partly implemented: there is **no second factor** (D-025) |

## CSP trade-off (D-005)

Pages are static, so the policy cannot carry per-request nonces; following the framework's documented non-nonce
configuration, `script-src` and `style-src` include `'unsafe-inline'`. Residual risk is limited because the app
never renders untrusted markup, loads nothing from other origins (`default-src 'self'`, `connect-src 'self'`,
`object-src 'none'`, `base-uri 'self'`, `form-action 'self'`), and exposes no HTML injection sink. If the app ever
gains user-generated HTML or third-party scripts, switch to nonces via `proxy.ts`.

## Explicit non-guarantees

- The in-app budget cannot cap spending by *other* applications that use the same API key, nor provider-side
  billing anomalies. Owners should also set a workspace spend limit at the provider (see `COST.md`).
- Cross-browser determinism beyond Chromium is expected from the language specification but untested here.
- No physical-device or human penetration testing has been performed unless `EVIDENCE.md` says so.

## What a visitor without a session can do

Play the offline game; read `/api/health`; list and read **published** recordings (configuration, tape of
decisions and state digests — no cost, no scheduling trace); be told by `/api/owner/status` whether sign-in is
possible. Every other route answers 401 or 403 before touching the database or a provider.

## Reporting and rotation

If a key is ever exposed: revoke it at the provider first, then rotate `ANTHROPIC_API_KEY` in the deployment
environment, set the kill switch, and reconcile the ledger against provider usage. If the owner passphrase or a
session is exposed: set the kill switch, generate new values with `pnpm owner:hash` (a new `AUTH_SECRET` ends
every session), and review the audit log in the console. Never paste a key into an issue, commit, chat or log.
