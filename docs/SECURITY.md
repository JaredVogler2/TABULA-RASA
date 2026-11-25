# Security and threat model

Status: baseline written in phase 02 (2026-11-25); controls are implemented and tested in phase 07 and re-audited
in phase 16. A control is listed as **implemented** only when a test in the repository exercises it.

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
2. **Owner browser ⇄ `/api/owner/*`, `/api/live/*`.** Authenticated by a signed, HttpOnly, SameSite=Strict
   session cookie; state-changing requests additionally require a same-origin check and a CSRF token.
3. **Server ⇄ PostgreSQL.** Trusted channel; all statements parameterised.
4. **Server ⇄ Anthropic API.** Outbound only, to the provider host only.
5. **Model output ⇄ engine.** **Untrusted data.** Parsed against a strict schema, then validated by the engine
   like any other intent. Never evaluated, never used to build SQL, URLs, file paths or prompts for other tools.
6. **Agent speech ⇄ other agents' prompts.** Untrusted in-world data, delimited and labelled as such.

## Threats and controls

| # | Threat | Control | Status |
|---|---|---|---|
| T1 | Key leaks into client bundle, logs or repo | Server-only modules (`server-only`, lint boundaries); no `NEXT_PUBLIC_` secrets; log redaction; bundle and repo secret scans in CI | planned (phase 07) |
| T2 | Public user triggers paid calls | Every live route requires an owner session **and** `LIVE_ENABLED=true` **and** an authorized budget; the public UI has no code path to those routes | planned (phase 07) |
| T3 | Overspend through concurrency or retries | Atomic conditional reservation before dispatch; idempotency keys; unknown outcomes stay reserved; SDK auto-retry disabled | planned (phase 07) |
| T4 | CSRF against the owner | SameSite=Strict cookie, Origin/Sec-Fetch-Site check, per-session CSRF token header | planned (phase 07) |
| T5 | Brute-forcing the owner passphrase | scrypt hash in env; constant-time compare; attempt throttling in the database; generic errors | planned (phase 07) |
| T6 | Prompt injection through in-world speech or names | Fixed system prompt; speech quoted as data; output schema has no field that can express anything but in-world intents; engine re-validates authority and quantities | planned (phases 06, 16) |
| T7 | Malicious institution proposals (resource creation, privilege escalation, unbounded evaluation) | Declarative AST only; validator with conservation and authority checks; fuel-limited interpreter; no host-language evaluation | planned (phase 09) |
| T8 | Raw API proxying | The server composes prompts from its own authoritative world; clients send only ids | planned (phase 08) |
| T9 | Denial of wallet / denial of service | Per-run, per-day and global ceilings; request size limits; rate limits; kill switch | planned (phase 07) |
| T10 | Malicious or corrupted save import | Schema validation, size limits, hash verification; imports are data, never code | planned (phase 13) |
| T11 | XSS via model or user text | React text rendering only; no `dangerouslySetInnerHTML`; CSP restricts sources to `'self'`; no third-party scripts | CSP header implemented and asserted in E2E; rest planned |
| T12 | Clickjacking | `frame-ancestors 'none'`, `X-Frame-Options: DENY` | implemented (header asserted in E2E) |
| T13 | Dependency compromise | Lockfile, pinned versions, `pnpm audit` in release checklist, license manifest | planned (phase 16) |

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

## Reporting and rotation

If a key is ever exposed: revoke it at the provider first, then rotate `ANTHROPIC_API_KEY` in the deployment
environment, set the kill switch, and reconcile the ledger against provider usage. Never paste a key into an
issue, commit, chat or log.
