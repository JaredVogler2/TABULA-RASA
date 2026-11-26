# Cost sheet

Status: phases 06–08, revised after the phase-16 review (2026-11-25). Prices are the dated record in
`src/providers/prices.ts`, read from the provider's published pricing on 2026-11-25
(`docs/research/anthropic-api.md` §B). Everything about what a call *actually* costs is unmeasured: **no call
has been made**.

## Spend to date

| Item | Amount | Evidence |
|---|---|---|
| Anthropic API calls made by this project | **$0.00** (none made) | No key has been present in any development or CI environment. Nothing in the test suite or in CI can make a paid request: the one program that can is the smoke script (`pnpm live:smoke -- --run`), which has never been run that way. Run without `--run` it only reports; here it reports that nothing is configured. |
| Billable infrastructure provisioned | **none** | — |

## The stated envelope is not an authorization

The owner mentioned **$200** of Anthropic credit; its balance, expiry and model eligibility are unverified. The
application's authorized budget is **zero**, its ceiling is **zero** and its kill switch is **on** until the
owner changes them. Four separate acts stand between the repository as shipped and the first paid request:

1. **Configure** the deployment: `LIVE_ENABLED=true`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (there is no
   default), a PostgreSQL `DATABASE_URL`, owner sign-in (`pnpm owner:hash`) and **`BUDGET_CEILING_USD`** — the
   most this deployment may ever be authorized to spend. The ceiling is not an authorization: it is the limit
   on one. It lives in the server's environment so that the passphrase which spends cannot also raise it
   (D-042). Preview deployments refuse live mode whatever is set.
2. **Authorize an amount** in the owner console, at most the ceiling, typing "I authorize this spending".
3. **Release the kill switch.** Authorizing does not release it.
4. **Approve a run** with its own cap, typing "I approve this run and its cap", after seeing the plan's upper
   bound.

Planning ceilings from the prompt program (S03) — *not approvals*:

| Stage | Ceiling | Requires |
|---|---|---|
| Smoke test (three decisions through the whole pipeline) | $2 | explicit authorization |
| Pilot (a few people consulted often, a few days) | $10 | separate explicit authorization |
| Cognition / orchestration comparison | up to $48 | separate approval |
| Matched civilization experiments | up to $60 | separate approval |
| Replication / analysis | up to $40 | separate approval |
| Adversarial testing | $20 | separate approval |
| Contingency (never planned against) | $20 | — |

## Prices on record

USD per million tokens, verified 2026-11-25. Live mode refuses to run on a table older than 45 days unless
`PRICES_ATTESTED_ON` records the day the owner re-checked it; a model that is not in the table cannot be called.

| Model | Input | 5-minute cache write | Cache read | Output (thinking included) |
|---|---|---|---|---|
| `claude-fable-5-2` | $8 | $10 | $0.20 | $40 |
| `claude-opus-5-5` | $4 | $5 | $0.20 | $20 |
| `claude-sonnet-5-5` | $2 | $2.50 | $0.10 | $10 |
| `claude-haiku-5-5` (prompt up to 100,000 tokens) | $0.10 | $0.125 | $0.01 | $0.50 |

## What is held before every call (D-020)

```
input bound  = bytes(rules text) + bytes(page) + bytes(answer schema)   a token is never shorter than a byte
reservation  = ceil( ( (input bound + 2,000)                            2,000 for what the provider inserts unseen
                       × dearest input price (5-minute cache write)
                     + max_tokens × output price )                      thinking is billed as output
                     × 1.10 )                                           a workspace may default to a dearer region
```

- No cache hit is assumed. If the provider did not split cache writes by lifetime they are priced as 5-minute
  writes only because that is the only kind this application requests.
- The SDK's retries are off. A second attempt is a separate request with a separate reservation, made only
  after a definite, unbilled failure (D-021).
- When the answer arrives the reservation is replaced by the cost computed from the provider's own usage
  report, and the rest is returned at once. A timeout, a lost connection or an unpriceable report leaves the
  whole reservation held as *unknown* until the owner decides.
- If a settled cost ever exceeded its reservation the excess would be recorded as overage and the kill switch
  would turn on. `wire.test.ts` checks, over 3,000 generated cases, that no usage inside the bound can. Overage
  is not outside the caps: from then on it counts against the total, the run and the day (D-042).
- A charge that arrives after its reservation was given back — an answer that turns up after a timeout was
  reconciled as "not billed" — is recorded in full as overage, and turns the kill switch on in a way that a
  click does not undo: releasing it takes the words "I have checked what the provider charged".

### The bound for one decision, as measured on real pages

From `pnpm schedulers` (`evidence/phase-08/schedulers.txt` and `.json`): 50 people, six days, rich context,
agreements allowed, `max_tokens` 2,000. Over the 2,007 calls recorded there the input bound averages
**18,804 tokens** a call (the rules text as it was for that run, 9,844 bytes; schema 6,208 bytes; page 2,752
bytes on average); the reservation prices 2,000 tokens more than the bound, as in the formula above.

| Model | Held per call, mean over those calls (upper bound) | Whole calls $2 covers at that mean | Whole calls $10 covers at that mean |
|---|---|---|---|
| `claude-fable-5-2` | $0.3168 | 6 | 31 |
| `claude-opus-5-5` | $0.1584 | 12 | 63 |
| `claude-sonnet-5-5` | $0.0792 | 25 | 126 |
| `claude-haiku-5-5` | $0.00396 | 504 | 2,524 |

Each held amount is the total held in `schedulers.json` divided by its 2,007 calls, and the counts divide $2 and
$10 by that unrounded mean. They are not a guarantee: a call with a larger page holds more. At the 9,000-byte
page limit (next paragraph) $2 is sure to cover 5 calls on Fable 5.2, not 6, and $10 is sure to cover 25, not 31.

The Laboratory page prices whole study designs the same way (`src/lab/cost.ts`, tested in
`src/lab/cost.test.ts`), with one difference that makes its figures higher than the table above: it uses the
*largest* page a mind can be shown (9,000 bytes) rather than the pages measured in one run, because a ceiling
for a study that has not been run cannot lean on its own measurements. The figures that follow are computed
from the rules text and schema as they stand now, 10,250 and 6,208 bytes (the rules text has grown by 406 bytes
since the run above): an input bound of 25,458 tokens for the reference world, priced as 27,458 with the 2,000
added. On that basis one consultation holds $0.390 on Fable 5.2, $0.195 on Opus 5.5, $0.098 on Sonnet 5.5 and
$0.0049 on Haiku 5.5 (390,038, 195,019, 97,510 and 4,877 microdollars); one forty-day world of fifty
model-driven people at the default ration (1,280 consultations) holds $499, $250, $125 and $6.24; and a
two-condition contrast on the 32 seeds the baseline studies use holds $31,952, $15,976, $7,988 and $400.
Against the mentioned $200, a forty-day two-condition contrast could be guaranteed on 16 seeds per condition
with Haiku 5.5 and on none with the other three.

**This is a bound, not an estimate.** The real cost of a call is expected to be several times lower — the byte
count overstates tokens, cached reads of the rules text cost a fiftieth of the write price on Fable 5.2, and a
decision need not use its whole output allowance — but how many times lower is not known and is not claimed.
The owner console shows measured costs beside the bound only once calls have actually settled.

### What a whole society would hold

Same evidence, 50 model-driven people for six days with eight consultations per six-hour epoch (153–179 calls):

| Model | Upper bound for the run |
|---|---|
| `claude-fable-5-2` | $49–57 |
| `claude-opus-5-5` | $24–28 |
| `claude-sonnet-5-5` | $12–14 |
| `claude-haiku-5-5` | $0.61–0.71 |

and under that ration people spend only 7–8% of their time on a plan of their own (D-023). A pilot is better
spent on a few people consulted often than on many consulted rarely.

## Which model

`ANTHROPIC_MODEL` has no default; the choice is the owner's. The provider's own guidance, as recorded in the
research note, is to start with Opus 5.5 for most workloads, to use Fable 5.2 when Opus at higher effort falls
short, and to try Haiku 5.5 first for high-volume work whose outputs can be checked — which every decision here
is, by the engine. The owner's stated aim is to see what Fable 5.2 can do. Nothing in the application switches
models: a run is approved for one model and refuses to continue on another.

## Limits of the in-app cap

The ledger caps what *this application* sends. It cannot see other programs using the same key, and it trusts
the provider's usage report. Provider-side guardrails that do not depend on this code (research note §J):

- a **dedicated workspace** for this project with its own **spend limit**, and a key scoped to that workspace
  (a per-key cap does not exist; a non-default workspace's limit is the documented way to get one);
- **prepaid credits without auto-reload**: when they run out, calls stop.

## Infrastructure

| Component | Needed for | Cost status |
|---|---|---|
| Static hosting and functions | The public game; the owner API | **Deployed for the game alone** since 2026-11-26, in a Vercel project the owner made (`docs/DEPLOYMENT.md`). On Vercel's Hobby plan: $0 inside its monthly allowances, and a project that exceeds them is paused, not billed; the plan is for personal or non-commercial use (§2, read 2026-11-25). Which plan the owner's team is on was not read. |
| PostgreSQL | The owner console, server-side runs, the budget ledger | **Not provisioned.** Needs the owner's approval: a Marketplace database is a billable integration even on its free plan ($0 a month, 100 compute-hours and 1 GB a project, asleep after five minutes: `docs/DEPLOYMENT.md` §2 and §6). The public game, and the bundled recording, need no database. |
| Anything else (queues, workflow services, identity providers, analytics, asset CDNs) | — | **Not used.** |

## First live call: the owner's checklist

Nothing below has been done. It is the procedure phase 17 will follow once an amount is authorized.

1. At the provider: create a workspace for this project, set its spend limit to the amount you are willing to
   lose, create a key scoped to it, and turn auto-reload off.
2. Provision PostgreSQL; set `DATABASE_URL`; run `pnpm db:migrate`.
3. Run `pnpm owner:hash`; set `OWNER_PASSWORD_HASH` and `AUTH_SECRET`.
4. Set `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `LIVE_ENABLED=true` and `BUDGET_CEILING_USD` in the server
   environment only. Make sure none of `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_CUSTOM_HEADERS`,
   `ANTHROPIC_LOG` and `ANTHROPIC_OPEN_TELEMETRY_TRACES_CONTENT_MODE` is set: live mode refuses to start while
   one is.
5. Smoke test, from a shell that has those values on the command line (not exported). First look:

   ```bash
   pnpm live:smoke
   ```

   It makes no request and changes nothing. It says what is missing, what the smoke ledger has spent so far,
   and the exact words that would authorize the next run — they contain that run's number and its amount, and
   work once. Then, with those words:

   ```bash
   LIVE_SMOKE_MAX_USD=2 LIVE_SMOKE_CONFIRM="<the words it printed>" pnpm live:smoke -- --run
   ```

   Three people are asked once each, under a cap of at most $2 and under the deployment's ceiling. It prints
   tokens, latency, what was held and what was charged — the first measurement of real cost — and leaves the
   kill switch on. Its ledger is the schema `live_smoke` of the same database and is never dropped: a request
   whose outcome is unknown stays held there, blocks the next run, and is decided with
   `pnpm live:smoke -- --reconcile <id> release|settle-full` after reading the provider's usage record.
6. Only then: sign in to `/owner`, authorize an amount, release the switch, preview and approve a run.

The developer agent does not type the authorizing words, here or in the console. They are the owner's to type.
