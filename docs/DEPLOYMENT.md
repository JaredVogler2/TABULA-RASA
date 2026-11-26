# Deployment

**Status: DEPLOYED AT LEVEL 1** (2026-11-26) — the game alone, at **https://tabula-rasa-bay.vercel.app**.
The owner's console (level 2) and live minds (level 3) are not deployed.

| | |
|---|---|
| Address | https://tabula-rasa-bay.vercel.app (production; public) |
| Made by | the owner, importing this repository in the Vercel dashboard on 2026-11-26 at about 00:25 UTC |
| Built from | `main` at `41a4ffa` (pull request 4's merge: phases 1–20 and D-050), by Vercel, in 43 seconds, with pnpm 10.28.0 and Next.js 16.4.6 |
| Region | `iad1` |
| Checked | `pnpm release:check`: **25 of 25**; section 8 by hand: every answer as written there (`evidence/phase-18/`) |
| Configured | nothing: the site answers as one with no owner (`signInPossible: false`; an attempt to sign in answers 503). Which variables the project has could not be listed by the assistant's connector |
| Not observed | which Node.js runs it: the project's setting reads 26.x, `engines` says 22.x (see "Known unknowns") |

**How it went.** The owner approved a level-1 deployment — one project, no database, no key, no variable. The
assistant made the one call that creates a project and Vercel refused it: `403 forbidden — You don't have
permission to create the project` (the session's connector can read the team's projects and cannot create
one; `evidence/phase-18/create-project-refused.txt`). The call was not retried and no other route was tried in
its place. The owner then imported the repository in the dashboard, and the assistant found the address,
ran section 8 against it and wrote the results here. **The assistant created nothing on Vercel and set
nothing there.**

A database is a billable integration even at $0: it has not been asked for and waits for the owner's word
(`CLAUDE.md`; phase 18). This document is written so that the owner can do all of it without help.

Platform facts are quoted, with their sources and the day they were read, in
[`research/vercel-platform.md`](./research/vercel-platform.md). Where this page says "§n" it means that file.

## 1. Three levels, each on top of the one before

| Level | What works | What it needs | What it costs |
|---|---|---|---|
| **1. The game** | Everything a visitor sees: the game, the laboratory, the bundled recording, world files, the journal, History and its twin. Entirely in the browser; the server sends files and one health line | Nothing. No variable, no database | $0 on the Hobby plan, inside its allowances (below) |
| **2. The owner's console, mock minds** | Sign-in at `/owner`; the budget ledger (at zero); runs driven by the built-in mock provider; publishing a run so visitors can replay it | A PostgreSQL database; `OWNER_PASSWORD_HASH`; `AUTH_SECRET` | $0 on a free database plan, which is still a billable integration attached to the account |
| **3. Live minds** | Runs in which Claude decides for citizens, under the ledger | Level 2, and `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `BUDGET_CEILING_USD`, `LIVE_ENABLED=true` | Anthropic API credit, up to the ceiling. **Requires the phase-17 authorization. Not part of a release.** |

A release is level 1 or level 2. Level 3 is switched on afterwards, by the owner, following
[`COST.md`](./COST.md) — four separate acts, none of which the application can do for itself.

At level 1 the owner routes answer "not configured" and the paid path cannot be reached by anyone: there is
no key, no database and no session to reach it with. At level 2 it still cannot: `LIVE_ENABLED` is not `true`,
no key is set, the ceiling is zero.

## 2. What it costs to host

Nothing here is a quotation for the owner's account: plans change, and the pages are the authority.

- **Vercel Hobby** (§7): free. Included each month: 100 GB of data transfer, 1,000,000 function invocations,
  4 CPU-hours of function time, 1,000,000 CDN requests. When an allowance is used up the project is **paused,
  not billed** ("Hobby plans will be paused when they exceed the included free tier usage"); a paused project
  answers `503 DEPLOYMENT_PAUSED` and "doesn't resume on its own".
- **The Hobby plan is for "personal or non-commercial use"** (Terms of Service, as quoted in §7). The pages
  read do not define commercial use. Whether a free public research demo qualifies is the owner's judgment to
  make, not this document's.
- **A database** (level 2): a Marketplace PostgreSQL. The Neon free plan is "$0/month", 100 CU-hours and 1 GB
  per project; it sleeps after five minutes without use and wakes in "a few hundred milliseconds"; when its
  monthly hours are used up it is "suspended until the next billing period or until you upgrade" (§12).
  Billing for Marketplace resources goes through the Vercel account (§4). Whether the free plan asks for a
  payment method was not stated on the pages read.
- **Anthropic** (level 3 only): [`COST.md`](./COST.md). $0 so far; nothing has ever been sent.
- **Nothing else.** No domain is bought (the site gets a `*.vercel.app` address), no queue, no cron job, no
  workflow, no blob store, no analytics product.

What this application asks of those allowances: a visit to the game is a few static files and one call to
`/api/recordings`; everything after that happens in the visitor's browser. A first visit to the title screen
transferred 697 KB on the production build (`evidence/phase-18/release-check-local.txt`), so a hundred
gigabytes is on the order of a hundred thousand first visits a month, and a returning visitor's browser has
most of it cached. Mock runs at level 2 are the owner's own and cost function time: one six-hour epoch for
fifty people took 0.13 s on the development machine.

## 3. What Vercel is asked to run

| Thing | Value | Where it is set |
|---|---|---|
| Framework | Next.js 16.4.6, App Router, built with `next build` | detected from `package.json` |
| Package manager | pnpm 10 (`packageManager: pnpm@10.28.0`, lockfile version 9.0) | detected; see "Known unknowns" |
| Node.js | **22.x** — the version every test in this repository ran on | `engines.node` in `package.json` (D-048) |
| Install | `pnpm install` with the committed lockfile | detected |
| Generated files | none at build time: migrations, affordances, prompts and the licence list are committed, and CI fails if any is stale | — |
| Pages | `/`, `/lab`, `/owner`, `/studio`, `/diagnostics`: static | — |
| Functions | `/api/health`; `/api/recordings`; `/api/owner/*` (status, login, logout, budget, kill, reconcile); `/api/runs`, `/api/runs/preview`, `/api/runs/[id]`, `…/control`, `…/step` | `src/app/api` |
| Longest function | `…/step`: `maxDuration = 300` s, the Hobby maximum with Fluid compute (§1). Others 10–60 s | `export const maxDuration` in each route |
| Region | the default, `iad1` (§1). A database should be made in the same region (§4) | project default |
| Security headers | Content-Security-Policy (`default-src 'self'`, no third-party origin), `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP, CORP; on Vercel also HSTS and `upgrade-insecure-requests`; `Cache-Control: no-store` on `/api/*` | `next.config.ts` |
| `vercel.json` | none: nothing needs one | — |

Previews: a new project has Standard Protection, so preview deployments ask for a Vercel login and production
is public (§5). The application also refuses live mode on any preview deployment, whatever its variables say
(`VERCEL_ENV=preview`).

## 4. Variables

Names only: values never go in the repository, in a chat, or in a file that is committed. `.env.example` has
the same list with explanations. Set secrets as type **Secret** (write-only after saving, §6) and for
**Production only**. Changing a variable does nothing until the next deployment (§6).

| Variable | Level | Kind | How to get the value |
|---|---|---|---|
| `NEXT_TELEMETRY_DISABLED` = `1` | 1 (optional) | Config | Stops the framework's build tool reporting anonymous usage |
| `DATABASE_URL` | 2 | Secret | Set by the database integration when it is connected to the project (§4, §12). The pooled string it sets works (D-047) |
| `DATABASE_SCHEMA` | 2 (optional) | Config | A schema name, if the database is shared with something else |
| `OWNER_PASSWORD_HASH` | 2 | Secret | `pnpm owner:hash` on your own machine: it asks for a passphrase twice, without echo, and prints this line and the next. The passphrase itself is never stored anywhere |
| `AUTH_SECRET` | 2 | Secret | printed by the same command. Changing it signs everyone out |
| `BUDGET_CEILING_USD` | 3 | Config | The most this deployment may ever be authorized to spend. The console cannot raise it |
| `ANTHROPIC_API_KEY` | 3 | Secret | From the provider's console. Give the key its own workspace with a spend limit (`COST.md`) |
| `ANTHROPIC_MODEL` | 3 | Config | An exact model id that has a row in the price table. There is no default |
| `LIVE_ENABLED` = `true` | 3 | Config | The master switch. Absent or anything else: off |
| `PRICES_ATTESTED_ON` | 3 (optional) | Config | The day you re-checked the provider's prices against `src/providers/prices.ts` |

Never set `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_CUSTOM_HEADERS`, `ANTHROPIC_LOG` or
`ANTHROPIC_OPEN_TELEMETRY_TRACES_CONTENT_MODE`: live mode stays off while one of them is set. Nothing is ever
prefixed `NEXT_PUBLIC_`: the bundle scan in `pnpm check` fails the build if a server name or value reaches
the browser.

## 5. Level 1: the game

**Done on 2026-11-26, from the dashboard.** The production branch is `main`, and it holds everything: pull
requests 1 to 4 are merged (phases 1–20 and D-050). From now on a merge to `main` deploys itself to the
production address, and a push to any other branch makes a preview deployment that asks for a Vercel login.
The checks of section 8 were run against the deployment of `41a4ffa`; after a merge that changes the product
they are worth running again.

**From the dashboard.** vercel.com → Add New → Project → import `JaredVogler2/TABULA-RASA` → leave every
setting as detected → Deploy. No variables.

**From a terminal**, in a clean checkout of `main`:

```bash
pnpm i -g vercel@latest
```

```bash
vercel link
```

```bash
vercel --prod
```

The first deployment of a new project is a production deployment even without `--prod` (§11).

**By the assistant**: not possible. The one call that creates a project named `tabula-rasa` on the owner's
team was made on 2026-11-26 with the owner's approval and refused by Vercel (403: the session's connector may
not create projects). What the assistant could do, and did, once the owner had made the project: find its
address, run `pnpm release:check` (section 8) against it, and write the results into this file and
`EVIDENCE.md`.

## 6. Level 2: the console

1. **Make the database.** From the Vercel Marketplace (or the project's Storage tab), add a PostgreSQL
   provider on its free plan, in the region of the functions (`iad1` is US East), and connect it to the
   project for **Production**. Or `vercel install neon` from the linked directory (§4). This is the step that
   attaches a billable resource to the account.
2. **Make the owner's two values.** In a checkout, with dependencies installed:

   ```bash
   pnpm owner:hash
   ```

   Type a passphrase of twelve characters or more, twice. Copy the two printed lines into the project's
   variables (Settings → Environment Variables), each as a Secret, Production only. Keep the passphrase in a
   password manager; it cannot be recovered from the hash.
3. **Redeploy** (Deployments → the latest → Redeploy, or `vercel --prod`): variables reach new deployments only.
4. **The tables make themselves.** The first request that needs the database creates and migrates its schema
   (two migrations, forward only). To do it by hand and see the result, with the production variables pulled
   into the shell: `pnpm db:migrate` prints the migrations on record, and that the budget row exists with
   nothing authorized and the kill switch on.
5. **Sign in** at `/owner`. The console should say that live mode is unavailable and list why: that is the
   intended state.

### The database, plainly

- **Which connection string.** The integration sets `DATABASE_URL` to a pooled string (PgBouncer in
  transaction mode) and `DATABASE_URL_UNPOOLED` to a direct one (§12). The application reads `DATABASE_URL`
  and is written for the pooled one: it sends no settings when it connects and keeps nothing on a connection
  between transactions (D-047). This was run here through a local PgBouncer in the same mode — every server
  test, the ledger load test, the server's routes and the owner's browser tests
  (`evidence/phase-16/pooler.txt`) — **and not against a hosted database.** Step 5 above and section 8 are
  the first real test.
- **Sleep.** A free database sleeps after five minutes. The first request after that waits for it to wake;
  the application allows eight seconds to get a connection, and a statement that fails at the very start of a
  transaction on a dead connection is tried once more on a new one.
- **Backups.** The free plan keeps six hours of history and one manual snapshot, and has no scheduled backups
  (§12). What is worth keeping is small: the ledger and the runs. To take a copy, with the direct string:

  ```bash
  pg_dump "$DATABASE_URL_UNPOOLED" --no-owner --format=custom --file tabula-rasa-$(date +%F).dump
  ```

  A published run can also be saved from the game as a file by anyone who replays it; the file carries its
  own hashes.
- **What is in it** is listed under Privacy below. No secret is: the passphrase hash and the signing secret
  live in the deployment's variables, never in a table.

## 7. Level 3: live minds

Not a deployment step. [`COST.md`](./COST.md) § "The stated envelope is not an authorization" has the four
acts in order, and `pnpm live:smoke` (with no arguments: it changes nothing and spends nothing) says which of
them are missing and prints the exact words the next step needs. The first paid request this project ever
makes should be the smoke test: three decisions under a cap of at most $2.

## 8. Checks after any deployment

One command asks the site everything a stranger can ask and then plays the game in a real browser, in a
desktop window and as a phone. It signs in nowhere, sends no secret and changes nothing on the server:

```bash
pnpm release:check -- https://SITE
```

(`--level 2` once the console is configured; `--out <dir>` keeps screenshots and a JSON report. It drives a
real browser: on a machine that has never run the browser tests, `pnpm exec playwright install chromium`
first.) What it checks, each of which can also be done by hand:

| Check | By hand | Expect |
|---|---|---|
| Health, and that it tells nothing of configuration | `curl -sS https://SITE/api/health` | `{"ok":true,"service":"tabula-rasa","engine":"0.7.0","schema":6,"affordances":"2026.11-i"}`, the versions of the checkout that was deployed |
| Security headers | `curl -sSI https://SITE/` | a Content-Security-Policy beginning `default-src 'self'` and naming no other origin; `X-Frame-Options: DENY`; `X-Content-Type-Options: nosniff`; `Referrer-Policy`; `Permissions-Policy`; `Cross-Origin-Opener-Policy`; `Strict-Transport-Security`; no `X-Powered-By` |
| A stranger is refused | `curl -sS -X POST https://SITE/api/runs -H "content-type: application/json" -H "origin: https://SITE" -d "{}"` — and the same for `/api/runs/preview`, `/api/runs/x/step`, `/api/runs/x/control`, `/api/owner/budget`, `/api/owner/kill`, `/api/owner/reconcile` | `401` and `{"ok":false,"error":"not_signed_in"}` from each |
| Another origin is refused | the same request with `-H "origin: https://elsewhere.example"` | `403` and `cross_origin` |
| The owner's door | `curl -sS https://SITE/api/owner/status` | level 1: `{"signedIn":false,"signInPossible":false}`; level 2: `signInPossible` is `true`, and nothing else is told |
| Recordings | `curl -sS https://SITE/api/recordings` | `{"ok":true,"recordings":[]}` until the owner publishes a run |
| The game, desktop and phone | Begin → First Light → Create → play | the island draws; a day passes; the Chronicle has lines |
| A save | Menu → Save, reload the page, Continue | the same tick |
| The bundled recording | from the title | plays to its end and reads "ended: all 6 days matched the record" |
| The laboratory and the owner's page | `/lab`, `/owner` | the studies; "not configured" at level 1, a passphrase field at level 2 |
| Nothing leaves the site | the browser's network panel | no request to any other origin |
| Nothing server-only reached the browser | — | the checker reads every script, style and page it was sent with the rules of `pnpm scan:bundle` |

**Run against the deployment, https://tabula-rasa-bay.vercel.app, on 2026-11-26: 25 of 25 checks passed**
(`evidence/phase-18/release-check-deployed.txt`, with nine stills beside it), and every by-hand check in the
table gave the answer written in it (`evidence/phase-18/deployed-by-hand.txt`). First visit: 717 KB over the
network. The run was from a container without a graphics chip, in headless Chromium, with the game's simplest
picture: it says the site works, not how it looks or moves on a device.

Before that, on 2026-11-25, the same command against the production build on the development machine, started
with no variable at all: 25 of 25 (`evidence/phase-18/release-check-local.txt`).

What the command does not do, and a release at level 2 needs by hand: sign in at `/owner`; see that live mode
is unavailable and why; create a mock run of a few epochs, step it to the end and publish it; sign out; find
it in the game's list of recordings and replay it; check that `/api/owner/status` no longer knows you.
`pnpm e2e` runs exactly those flows against a local production build with a throwaway owner
(`tests/e2e/owner.spec.ts`).

## 9. Undoing things

- **A bad deployment.** Dashboard → Deployments → the previous one → Instant Rollback, or `vercel rollback`.
  On Hobby only the immediately previous production deployment can be rolled back to (§11). After a rollback
  Vercel stops assigning the production address to new deployments until one is promoted (`vercel promote`).
  A rollback restores a build, not variables or data.
- **Live mode, at once.** The kill switch in the console (it is on by default and nothing turns it off but
  the owner). **Without the console:** revoke the key at the provider — that is the one act that holds whatever
  state this application is in. Then remove `LIVE_ENABLED` and redeploy.
- **A stolen session or passphrase.** Sign out (it ends every session, wherever its cookie was copied); make
  new values with `pnpm owner:hash`; redeploy.
- **The database.** Migrations only go forward and both are additive. To start the ledger again, drop the
  schema (or the tables) and let the next request recreate them; the money actually spent is whatever the
  provider's console says, which the ledger's reconcile step compares against.
- **Everything.** Delete the Vercel project (in its settings) and the database resource (in the account's
  storage). The repository is untouched.

## 10. Privacy, and deleting data

**A visitor to the game** sends nothing about themselves and nothing is kept about them by this application.
Their worlds, saves and settings stay in their browser (IndexedDB `tabula-rasa`, and one `localStorage`
entry for settings); clearing the site's data removes all of it. No cookie is set for them. There are no
accounts, no analytics, no error reporting, no fonts or scripts from anywhere else.

**Whoever tries to sign in at `/owner`** — the owner, or a stranger trying the door — has their network
address (an IPv4 address, or the /64 of an IPv6 one) written in two places: `rate_limits`, whose rows are
deleted after a day, and `audit_log` (`login`, `login.failed`), which is kept until the owner deletes it. A
successful sign-in sets two cookies: the session (twelve hours) and a device token that signs nobody in.

**The platform** keeps its own request logs (an hour of runtime logs on Hobby, §7) under its own terms.

**In the database:** `budget`, `daily_spend`, `reservations` and `calls` (amounts, token counts, hashes of
requests, the provider's request ids); `runs` and `epochs` (worlds of invented citizens, their decisions and
state digests); `smoke_runs`; `audit_log`; `rate_limits`; `schema_migrations`. With live mode on, what is sent
to the provider is a citizen's situation in an invented world and the rules of that world: no visitor's data,
no owner's data.

To delete: a mock run, with `DELETE` on its rows in `epochs`, `calls`, `reservations` and `runs`, in that
order (a run that spent money should keep its reservations: they are the record of what was paid); the audit
log, with `DELETE FROM audit_log`; everything, by dropping the schema or deleting the database resource.

## 11. Known issues of a deployment

1. **Level 1 has met Vercel; nothing has met a hosted database.** The game, its pages and the routes a
   stranger can reach are checked on the deployment (section 8). The console, the ledger and server-side runs
   are tested against `next start` with PostgreSQL on the development machine and in CI, and against a real
   pooler there (D-047) — not on Vercel.
2. **One origin** for the game and the console (`SECURITY.md` § One origin). A separate host for the console
   would close it and is not built.
3. **The in-memory rate limiter is per instance** and forgets when an instance is recycled; it bounds what
   one instance serves one network. The platform's firewall is the limit on volume. Sign-in and the owner's
   actions are counted in the database, across instances.
4. **A flood of visitors pauses a Hobby project** rather than costing money (§7). That is the right failure
   for a free demo and the wrong one for anything that must stay up.
5. **A sleeping database** makes the first console action after a pause slow, and a database that has used
   its month is down until the next one: the game is unaffected, the console answers that it cannot count
   its callers and serves nobody.
6. **The pool is not registered with the platform's `attachDatabasePool`** (§4): a suspended function can
   leave idle connections open. With the pooled string they cost the database nothing; a connection that died
   meanwhile costs one retry (D-047).
7. **Frame rate on real devices is unmeasured** (`PERFORMANCE.md`).

### Known unknowns to settle on the first build

- ~~Which pnpm the builder picks.~~ **Settled by the first build:** "Detected `pnpm-lock.yaml` version 9
  generated by pnpm@10.x from package.json#packageManager pnpm@10.28.0 … Done in 13.8s using pnpm v10.28.0".
- **Which Node.js runs it: not observed.** The project's setting reads 26.x, the platform's default for a new
  project; `engines.node` is `22.x`, which Vercel's documentation says overrides the setting (§2, D-048). The
  build log does not print the version and nothing the site serves tells. To make both say the same: Project
  Settings → Build and Deployment → Node.js Version → 22.x, then redeploy.
- **A header the platform adds:** `access-control-allow-origin: *` on what it serves from its cache as static
  content — the pages and `/api/health`. All of that is public. The functions do not carry it, and a request
  from another origin that would change anything is refused with 403 (`evidence/phase-18/deployed-by-hand.txt`).
- Whether the provider's connection string carries options this driver does not know (`channel_binding`, for
  one). Unknown options are ignored by the driver; if a connection is refused, the direct string
  (`DATABASE_URL_UNPOOLED`) set as `DATABASE_URL` is the fallback, and works too.

## 12. Release checklist

| Gate | State on 2026-11-26 |
|---|---|
| Clean install, `pnpm check`, `pnpm e2e` at the commit to be deployed | see `CONTINUE_HERE.md` for the commit and its results |
| CI green on that commit | see the pull request |
| The pull requests merged to `main` | done: 1 to 4, by the owner (2026-11-25). `main` is the tree CI passed on `b25d1b7` |
| Owner's approval to create the project (and, for level 2, the database) | **given for level 1** on 2026-11-26; not asked and not given for a database |
| Project created; first production deployment built | **done by the owner** on 2026-11-26 at about 00:25 UTC, by importing the repository (the assistant's own call had been refused, 403). Built from `41a4ffa` in 43 s; READY |
| Section 8 on the deployed address: health, headers, a stranger refused, the game on desktop and phone, the bundled recording | **PASS: 25 of 25** on 2026-11-26 (`evidence/phase-18/release-check-deployed.txt`); by hand, every answer as written (`deployed-by-hand.txt`) |
| Level 2: database connected, owner values set, sign-in, a mock run published and replayed by a visitor | NOT RUN |
| Level 3 | BLOCKED on the phase-17 authorization; not part of a release |
