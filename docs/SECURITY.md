# Security and threat model

Status (2026-11-25): the controls for the owner API, the budget ledger and model output were built and tested
in phases 06–08, then attacked in phase 16 by an independent review agent
(`evidence/phase-16/review-security.md`: no critical or high finding, eight medium, sixteen low). Every finding
has been acted on or is listed below as accepted; what was done is D-040, D-042 and D-043, and finding by
finding in `docs/QA_REPORT.md`. A control is listed as **implemented** only when a test in the repository
exercises it, and the test is named.

Two things no test here can show, and nothing in this document should be read as claiming: that the live path
works against the real service (no request has ever been sent to it; every provider test uses canned
responses), and that a real model resists what in-world text may try on it.

## Assets

| Asset | Why it matters |
|---|---|
| `ANTHROPIC_API_KEY` | Direct financial exposure; must exist only in server environment variables. |
| Budget ledger | The only thing standing between a bug and real spend. |
| Owner session | Grants the ability to authorize spending (up to the deployment's ceiling) and to start live runs. |
| `BUDGET_CEILING_USD` | The most the owner's session can ever authorize. Changing it takes access to the deployment. |
| Simulation integrity | Results are only meaningful if state cannot be altered outside the engine. |
| Player saves | Local only; must not be corrupted by partial writes or by a hostile file. |

## Trust boundaries

1. **Public browser ⇄ app.** Untrusted. May only fetch static assets, published recordings and `/api/health`.
2. **Owner browser ⇄ `/api/owner/*`, `/api/runs/*`.** Authenticated by a signed, HttpOnly, SameSite=Strict
   session cookie; state-changing requests additionally require a same-origin check and a token derived from
   the session (D-025). A visitor without a session can read `/api/recordings` and published runs, and nothing
   else.
3. **Deployment ⇄ owner.** The environment (key, passphrase hash, signing secret, database, ceiling) is set by
   whoever controls the deployment. The console can read none of it and can change none of it.
4. **Server ⇄ PostgreSQL.** Trusted channel; all statements parameterised; every transaction opens under a
   statement, a lock and an idle-in-transaction limit (set for that transaction, so they hold through a
   connection pooler as well as straight to a server: D-047); a connection lost in mid-transaction fails that
   transaction and nothing else.
5. **Server ⇄ Anthropic API.** Outbound only: one kind of request, to one host and path, through a guard that
   refuses anything else before it is sent.
6. **Model output ⇄ engine.** **Untrusted data.** Parsed against a strict schema, rebuilt from the fields the
   engine knows, bounded, then validated by the engine like any other intent. Never evaluated, never used to
   build SQL, URLs, file paths or prompts for other tools.
7. **Agent speech and names ⇄ other agents' prompts.** Untrusted in-world data: cleaned, bounded, quoted and
   labelled as someone's words. A speaker can tell only of what they know (D-040).
8. **A file the player opens ⇄ engine.** Untrusted data: every field checked, then tried, then labelled (D-043).

## Threats and controls

| # | Threat | Control | Status |
|---|---|---|---|
| T1 | Key leaks into client bundle, logs or repo | Server-only modules (`server-only`, lint boundaries); no `NEXT_PUBLIC_` secrets; responses, audit entries and log lines carry codes, never provider messages or connection errors; `pnpm scan:secrets` over every tracked file and every untracked file that is not ignored, `pnpm scan:history` over every line any commit has added, and `pnpm scan:bundle` over everything sent to browsers, all in CI. The scans excuse no line, know every kind of key and token the provider issues, and fail on archives instead of skipping them | **implemented** — `tests/unit/scans.test.ts` (each scan goes red on a planted leak; no marker excuses a line; a database host is nobody's only if the name is the whole host), `api.test.ts` › "never puts a secret in a response, in the audit log or in the server's own log", `anthropic.test.ts` (the key appears in one request header and nowhere else), `prompt.test.ts` › "carries nothing from the server's environment" |
| T2 | Public user triggers paid calls | Every route that can reach a provider starts with the owner gate; the provider object is not even constructed before it passes; live mode additionally needs `LIVE_ENABLED=true`, a key, a priced model, PostgreSQL, a ceiling, an authorized amount, the kill switch released and an approved, capped run | **implemented** — `api.test.ts` › "no request without the owner's session, origin and token changes anything or reaches a provider", `auth.test.ts` › "is available only with the switch on, a key, a priced model, a database, owner sign-in and fresh prices", `owner.spec.ts` against the real server |
| T3 | Overspend through concurrency, retries or interruption | Atomic conditional reservation before dispatch; deterministic reservation ids; unknown outcomes stay held; what a request cost and the record of it are written in one transaction; whatever state an interrupted call left is found and recorded on the next step; overage counts against the total, the run and the day; SDK retries off; CHECK constraints in the schema | **implemented** — `ledger.test.ts` (100 concurrent requests from two pools on PostgreSQL 16; 100 copies of one request granted once; property test over random operation sequences; "what became of a request and the record of it are written together, or neither is"), `runs.test.ts` (two instances racing through a paid run; "whatever state a recordless reservation is in, the next step writes its record and never asks for that attempt again") |
| T4 | CSRF against the owner | SameSite=Strict `__Host-` cookie; `Origin` must name this host; Fetch Metadata must say same-origin when present; per-session token header | **implemented** — `auth.test.ts` › "lets the owner's own page through and nobody else" |
| T5 | Brute-forcing the owner passphrase, or locking the owner out by trying | scrypt (N = 2^17 for new hashes; older hashes still open) in env; constant-time compare; five attempts a quarter of an hour per client, counted before a shared forty; a browser the owner has signed in on carries a signed device token with ten attempts of its own, so strangers cannot use up the owner's; a flood from one address is stopped in memory before any database write; one generic refusal | **implemented** — `auth.test.ts`, `api.test.ts` › "signs the owner in with the passphrase, and slows down anyone guessing it" and "one address hammering sign-in cannot lock the owner out, and strangers together cannot keep the owner off a device they have used" |
| T6 | Prompt injection through in-world speech or names | Fixed rules text; other people's words cleaned of control, invisible and direction-override characters (an explicit list, the same on every JavaScript engine), bounded, and quoted on one line after a fixed label; role names in agreements reduced to plain labels and always shown in quotation marks; the answer schema can express nothing but in-world actions; the engine re-validates every id, quantity and authority | **implemented for what code can show** — `prompt.test.ts` › hostile speech (the page cannot be reshaped; a mind that obeys everything still achieves nothing forbidden), `institutions.test.ts` (hostile role names), `core/text.test.ts` (every code point). **Not shown:** that a real model resists; that needs authorized calls (phase 17) |
| T7 | Malicious institution proposals (resource creation, privilege escalation, unbounded evaluation) | Declarative grammar only; validator with conservation and authority checks; fuel-limited interpreter; formulas written as text are parsed by a bounded parser and then validated like any other; an intent is rebuilt from known fields and what a model attaches is bounded in depth, size and vocabulary | **implemented** — `institutions.test.ts`, `formula.test.ts` (1,500-case fuzz), `wire.test.ts`, `core/bounded.test.ts` |
| T8 | Raw API proxying | No endpoint accepts prompt text, a model name or a key. The server composes every request from its own stored world; a client sends a run id | **implemented** — by construction (`api.ts`), and `api.test.ts` › "refuses bodies that are too large, not JSON, or not objects, and worlds outside the allowed knobs" |
| T9 | Denial of wallet / denial of service | Per-run, per-day and total ceilings under the deployment's own; kill switch (on by default); three paid-for answers in a row that cannot be used pause a run; a call has a hard deadline inside its lease; bounded JSON bodies (16 KB); rate limits on sign-in and owner actions in the database and on public reads in memory (a stranger's read writes to no table); a server-side run is limited to 120 people | **implemented** — `ledger.test.ts`, `runs.test.ts` › "a run that keeps paying for answers it cannot use is stopped after three, and an answer from the wrong model stops it at once", `auth.test.ts` › "counts strangers' reads in memory, per window, in a bounded number of buckets" |
| T10 | Malicious or corrupted world file | Size limits and hash verification of the envelope; every field of the state checked for type and range, with stored charters checked against the grammar; goods must add up; a trial run of half a day before the file is accepted; any error inside a tick stops the world behind a notice; History says whether a past was made here, opened from a file, or re-lived and found true. A recording is validated before it is played and checked against the recorded digest every epoch | **implemented** — `save/validate.test.ts` (targeted corruptions and a seeded property test), `save/history.test.ts`, `worker/sim.worker.test.ts`, `history.spec.ts`, `owner.spec.ts` (D-043) |
| T11 | XSS via model text, player text or an opened file | React text rendering only. Nothing under `src/` may turn a string into markup or code: `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, string timers and `javascript:` URLs are lint errors. CSP restricts sources to `'self'`; no third-party scripts | **implemented** — the `no-injection-sinks` block in `eslint.config.mjs` (part of `pnpm lint`); the CSP header is asserted in E2E. See "One origin" below for what remains |
| T12 | Clickjacking | `frame-ancestors 'none'`, `X-Frame-Options: DENY` | implemented (header asserted in E2E) |
| T13 | Dependency compromise | Lockfile with exact versions; `pnpm install --frozen-lockfile` in CI; `pnpm audit` at release; a generated licence manifest that CI keeps current | **implemented as far as it goes** — `evidence/phase-16/dependencies.txt` (no known vulnerabilities on 2026-11-25), `docs/THIRD_PARTY.md`. CI actions are pinned by tag, not by commit |
| T14 | A stolen owner passphrase or session | The session can authorize at most the deployment's ceiling, which it cannot change; signing out ends every session at once; sessions last twelve hours; the kill switch; a provider-side workspace spend limit; rotating `AUTH_SECRET` | **implemented** — `api.test.ts` › "the credential that spends cannot raise its own limit: the ceiling belongs to the deployment" and "signing out ends every copy of the session, and nobody but the owner can do it"; `owner.spec.ts`. There is **no second factor** (D-025) |
| T15 | An agent learns what it never perceived by naming ids in speech | A speaker can tell only of a place, structure, agreement or offer they know; a hearer receives the speaker's belief, never the world's state | **implemented** — `institutions.test.ts` and `cognition.test.ts` (D-040) |
| T16 | A failed or interrupted request is wrongly taken as free | Only an answer in the provider's own error format with a request id proves a rejection; anything else — an error page from something in between, a timeout, a lost connection — has an unknown outcome, keeps its money held, and is never sent again | **implemented** — `anthropic.test.ts` › "an error page from something between here and the provider proves nothing…" and "a request that gets no answer in time, or loses its connection, has an unknown outcome and is not sent again" |
| T17 | The environment redirects or exposes requests | The adapter's `fetch` will only POST to `https://api.anthropic.com/v1/messages` with an allow-listed set of headers and no redirects; SDK logging and OpenTelemetry are off (the SDK enables tracing by default); live mode refuses to start while a variable the SDK would have obeyed is set | **implemented** — `anthropic.test.ts` › "nothing in the environment adds a header, turns on a log or a trace, or moves the request…" and "the guard refuses anything that is not that one request, before it is sent"; `auth.test.ts` › "stays off while the environment holds a setting the provider's SDK would have obeyed" |
| T18 | The smoke test is replayed, or spends unseen | A script, not a test: nothing in the suite or in CI can reach it. Each run has a number, and its authorizing words work once; at most three requests under a cap of at most $2 and under the deployment's ceiling; its ledger is a schema that is never dropped; the kill switch is on again however a run ends | **implemented with canned responses** — `smoke.test.ts`. **Never run with a key** |

## One origin

The game and the owner console are served from one origin, and pages are static, so the Content-Security-Policy
cannot carry per-request nonces: following the framework's documented non-nonce configuration, `script-src` and
`style-src` include `'unsafe-inline'` (D-005). A script injected into the game would therefore run, and — if the
owner were signed in in that browser — could act as the owner.

What stands in the way: the game renders everything it did not write (model text, citizens' speech, role names,
file contents) as React text; the source is forbidden by lint from containing any way to turn a string into
markup or code (T11); nothing is loaded from another origin (`default-src 'self'`, `connect-src 'self'`,
`object-src 'none'`, `base-uri 'self'`, `form-action 'self'`). The review looked for an injection sink and found
none.

What it could do if one appeared: authorize up to `BUDGET_CEILING_USD` and spend it on this application's own
runs. It could not read the key, change the ceiling or send anything anywhere else (`connect-src 'self'`).

What would close it: serving the console from a host of its own. That is a deployment decision and is not made
here. Until then: keep the ceiling at what you are prepared to lose, sign out of the console when you are done
(it ends every session), and do not open world files from people you do not know in the browser you are signed
in with.

## Accepted as they are

- HSTS is sent only on Vercel (`next.config.ts`); elsewhere, TLS is the host's business.
- CI actions are pinned by tag (`actions/checkout@v4`), not by commit.
- `window.__tr` is a read-only handle for automated tests and ships in production. It can read renderer
  statistics and a citizen's place on screen; it can change nothing.
- Members of an agreement see its live rules, member count and open motions whatever the distance. This is a
  modelling choice, and it is the one thing an agent knows that it has not perceived or been told.
- What the engine says back to a mind about its own refused intents (up to 160 characters) is shown to that
  same mind unquoted. It is the engine's text about that mind's own acts.
- Off Vercel and without `TRUST_FORWARDED_FOR`, every visitor is one client to the rate limiter.

## Explicit non-guarantees

- The in-app budget cannot cap spending by *other* applications that use the same API key, nor provider-side
  billing anomalies. Owners should also set a workspace spend limit at the provider (see `COST.md`).
- Cross-browser determinism beyond Chromium is expected from the language specification but untested here.
- No person has attacked this application, and it has run on no physical device. The review was done by a
  model, reading the code.

## What a visitor without a session can do

Play the offline game; read `/api/health`; list and read **published** recordings (configuration, a named
subset of the manifest, the tape of decisions and state digests — no cap, no cost, no scheduling trace); be
told by `/api/owner/status` whether sign-in is possible. Every other route answers 401, 403 or 404 before
touching a provider. A stranger's reads write to no table; a sign-in attempt is counted in the database, after
a brake in memory that stops a flood from one address before it gets there.

## Reporting and rotation

If a key is ever exposed: revoke it at the provider first, then rotate `ANTHROPIC_API_KEY` in the deployment
environment, set the kill switch, and reconcile the ledger against provider usage. If the owner passphrase or a
session is exposed: sign out in the console (every session ends), set the kill switch, generate new values with
`pnpm owner:hash` (a new `AUTH_SECRET` also ends every session), and review the audit log in the console. If
the kill switch has turned itself on because money was charged beyond what was held — the console says so, and
a run paused for it reads "a request was charged after its hold had been released" — read the provider's usage
record before typing the words that release it. Never paste a key into an issue, commit, chat or log.
