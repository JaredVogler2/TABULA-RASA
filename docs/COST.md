# Cost sheet

Status: phases 06–08 (2026-11-25). Prices are the dated record in `src/providers/prices.ts`, read from the
provider's published pricing on 2026-11-25 (`docs/research/anthropic-api.md` §B). Everything about what a call
*actually* costs is unmeasured: **no call has been made**.

## Spend to date

| Item | Amount | Evidence |
|---|---|---|
| Anthropic API calls made by this project | **$0.00** (none made) | No key has been present in any development or CI environment. The only test that can make a paid request (`src/server/live.integration.test.ts`) reports "NOT authorized" in every test run. |
| Billable infrastructure provisioned | **none** | — |

## The stated envelope is not an authorization

The owner mentioned **$200** of Anthropic credit; its balance, expiry and model eligibility are unverified. The
application's authorized budget is **zero** and its kill switch is **on** until the owner changes them. Four
separate acts stand between the repository as shipped and the first paid request:

1. **Configure** the deployment: `LIVE_ENABLED=true`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (there is no
   default), a PostgreSQL `DATABASE_URL`, and owner sign-in (`pnpm owner:hash`). Preview deployments refuse
   live mode whatever is set.
2. **Authorize an amount** in the owner console, typing "I authorize this spending".
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
             + 2,000                                                    for what the provider inserts unseen
reservation  = ceil( ( input bound × dearest input price (5-minute cache write)
                     + max_tokens  × output price )                     thinking is billed as output
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
  would turn on. `wire.test.ts` checks, over 3,000 generated cases, that no usage inside the bound can.

### The bound for one decision, as measured on real pages

From `pnpm schedulers` (`evidence/phase-08/schedulers.txt`): 50 people, six days, rich context, agreements
allowed, `max_tokens` 2,000. The input bound averages **18,800 tokens** a call (rules text 9.8 KB, schema 6.2 KB,
page about 2.9 KB).

| Model | Held per call (upper bound) | Calls a $2 smoke could guarantee | Calls $10 could guarantee |
|---|---|---|---|
| `claude-fable-5-2` | $0.32 | 6 | 31 |
| `claude-opus-5-5` | $0.16 | 12 | 63 |
| `claude-sonnet-5-5` | $0.08 | 25 | 126 |
| `claude-haiku-5-5` | $0.004 | 500 | 2,500 |

The Laboratory page prices whole study designs the same way (`src/lab/cost.ts`, tested in
`src/lab/cost.test.ts`), with one difference that makes its figures higher than the table above: it uses the
*largest* page a mind can be shown (9,000 bytes, a 25,052-token bound for the reference world) rather than the
pages measured in one run, because a ceiling for a study that has not been run cannot lean on its own
measurements. On that basis one consultation holds $0.386 on Fable 5.2, $0.193 on Opus 5.5, $0.096 on Sonnet 5.5
and $0.005 on Haiku 5.5; one forty-day world of fifty model-driven people at the default ration (1,280
consultations) holds $494, $247, $123 and $6.17; and a two-condition contrast on the 32 seeds the baseline
studies use holds $31,586, $15,793, $7,897 and $395. Against the mentioned $200, a forty-day two-condition
contrast could be guaranteed on 16 seeds per condition with Haiku 5.5 and on none with the other three.

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
| Static hosting and functions | The public game; the owner API | To be verified against current plan limits in phase 18. Nothing is deployed without authorization. |
| PostgreSQL | The owner console, server-side runs, the budget ledger | **Not provisioned.** Needs the owner's approval; free tiers and their conditions are to be verified in phase 18. The public game, and the bundled recording, need no database. |
| Anything else (queues, workflow services, identity providers, analytics, asset CDNs) | — | **Not used.** |

## First live call: the owner's checklist

Nothing below has been done. It is the procedure phase 17 will follow once an amount is authorized.

1. At the provider: create a workspace for this project, set its spend limit to the amount you are willing to
   lose, create a key scoped to it, and turn auto-reload off.
2. Provision PostgreSQL; set `DATABASE_URL`; run `pnpm db:migrate`.
3. Run `pnpm owner:hash`; set `OWNER_PASSWORD_HASH` and `AUTH_SECRET`.
4. Set `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` and `LIVE_ENABLED=true` in the server environment only.
5. Smoke test, from a shell that has those values and `TEST_DATABASE_URL` (the test keeps its ledger in a
   temporary schema of that database and drops it afterwards). Three requests, capped at the amount you type:

   ```bash
   LIVE_SMOKE_MAX_USD=2 LIVE_SMOKE_CONFIRM='I authorize a live smoke test of at most $2' pnpm test src/server/live.integration.test.ts
   ```

   It prints tokens, latency, what was held and what was charged — the first measurement of real cost — and
   leaves the kill switch on.
6. Only then: sign in to `/owner`, authorize an amount, release the switch, preview and approve a run.
