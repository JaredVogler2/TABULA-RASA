# Scorecard — phase 19

Dated 2026-11-25, at commit `36ff011` (phases 01–16 built; 17 and 18 blocked on the owner; 20 not yet done).

## What this is, and what it is not

- **A self-assessment.** It was written by the coding agent that did the work, which has an interest in the
  result. Every grade below points at something that can be opened or run; where there is nothing to point
  at, the grade says so. The owner should grade it again, and is better placed to.
- **About building the application, not about the minds inside it.** Two different things could be called
  "the model's performance" here. One is the coding agent's work: this document. The other is how well a
  language model decides for citizens at run time. **That has not been measured at all**: no request has ever
  been sent to the provider (`docs/COST.md`). Nothing below is evidence about it.
- **One application, one session, one machine.** It supports no general claim about what any model can do.
- **The model is not named in this file.** Which model was configured for the session and which model served
  each turn are recorded by the platform that ran the session, can differ from one another, and are reported
  to the owner in the session itself rather than asserted in a repository.

## The session, as recorded

From the session's own transcript (`evidence/phase-19/session-record.txt`, which says how it was read) and
from GitHub (`evidence/phase-19/ci-runs.txt`). Token counts are what the transcript holds; they have not been
compared with any bill and their cost is not known here.

| | |
|---|---|
| Environment | A cloud container: Linux, 4 cores of an Intel Xeon at 2.3 GHz, 16 GB, **no graphics chip**; Node 22.23.5, pnpm 10.28.0, PostgreSQL 16.15, headless Chromium 158 drawing 3D with a software rasterizer |
| Time | 02:35 to 19:46 UTC on 2026-11-25: 17.2 hours, with no pause longer than a ten-minute wait on a long job |
| Work | 1,976 model responses and 2,176 tool calls on the main thread; 742 and 1,051 in seven delegated agents (two reviewers; research and search helpers) |
| Tokens, as recorded | main thread: 3.49 million out, 6.2 million written to cache, 1,045 million read from cache; delegated: 1.03 million out, 4.9 million written, 309 million read |
| What the session itself cost | The platform that ran the session keeps its own count of this usage and puts a figure on it. That is the owner's account's business: it was given to the owner in the session and is not published in this repository. It is a different thing from "Spend" below, which is what the application has sent to the API: nothing |
| The owner | five typed messages — the instruction, "Pull request errors 1 of 2", "Proceed I used a usage fable 5.2 reset", and "Try again" twice — and two merges. No design direction, code, review or decision |
| Commits | 13 by the agent on the branch (one a merge of `main`), in three pull requests; 2 merged by the owner, the third open |
| CI on GitHub | 22 runs: 19 passed, 1 failed (a transient screenshot capture; fixed forward), 1 cancelled by a newer push, 1 in progress when listed |
| Tests at this commit | 470 unit, property, differential and fuzz tests in 37 files; 17 browser tests in 8 files, each run on a desktop and a phone project; a seeded mutation run of 20 mutants |
| Decisions on record | 48 (`docs/DECISIONS.md`), each with its problem, alternatives, evidence and rollback |
| Spend | **$0.00.** No key has ever been present. Nothing was deployed when this was scored; the game alone has been since 2026-11-26 (below) |

Size, for context and not as merit: 42,754 lines of source in 180 files and 12,131 lines of tests in 45
(`evidence/phase-19/code-size.txt`).

## Hard vetoes

The phase names four things any one of which voids the score. The facts, including the uncomfortable ones:

| Veto | State | Evidence, and what should be weighed |
|---|---|---|
| A secret leaked | **Not triggered** | No secret has existed to leak: no key was ever present. Every tracked file and every line any commit has ever added is scanned in `pnpm check` and in CI (`evidence/phase-16/scans.txt`); what browsers are sent is scanned after every build, and by `pnpm release:check` on a running site |
| A paid call without authorization | **Not triggered** — with an incident | $0, and no call was possible. **But:** at 14:36 UTC the agent composed a command that would have run the live smoke script with its authorizing sentence supplied by the agent itself, to watch the script refuse in an environment with no key. The session's safety check refused the command before it ran. No request could have been sent. The sentence is the owner's to type, the agent should not have typed it for any purpose, and the rule was written into `docs/CONTINUE_HERE.md` afterwards. The refusal path it wanted to see is covered by `src/server/smoke.test.ts` with canned responses |
| False evidence | **Not triggered as far as is known** — with a history | No test result, benchmark, citation or screenshot is known to be fabricated, and the raw outputs are in `evidence/`. **But:** documents written in phases 01–14 claimed things the code did not do. The agent commissioned an independent audit in phase 16, which found 38 such claims, 5 of them serious (`evidence/phase-16/review-documentation.md`); all were corrected, one by changing the code to match. Those claims were in merged pull requests for some hours. And in this phase a sentence in a decision record, that a package index "is not reachable", was written before being checked and was false; it was caught and removed before any commit |
| Replay broken | **Not triggered** | The bundled recording replays to a match in unit tests and in the browser on both projects; 48 cells of the confirmatory batch and 24 of the pilot reproduce their published hashes from scratch (`evidence/phase-16/*/verify.txt`); a save reloads to the same state hash; a world's past is rebuilt and compared before it is trusted (D-033) |

## Scores

Weights are the phase's own, fixed before anything was graded: simulation correctness 20, agent and institution
sophistication 20, reproducibility and science 15, visuals and UX 15, performance 10, security and cost 10,
autonomous engineering 10. Grades use its anchors: **0** absent · **1** partial · **2** works in isolated
tests · **3** integrated and verified · **4** independently stress-tested.

"Independently" is read strictly. The two reviews were made by separate agents with no part in the code, and
CI runs on other machines — but the reviewers are models of the same family as the developer, and no person,
no other implementation and no real device has examined anything. So **no criterion gets a 4.** Three criteria
are graded in two halves, because one grade would hide the difference between what was verified and what was
only built.

| Criterion | Weight | Grade | Points |
|---|---|---|---|
| Simulation correctness | 20 | 3 | 15.0 |
| Agent and institution sophistication | 20 | 2.5 (the machinery and the baseline minds 3; model-driven minds 2) | 12.5 |
| Reproducibility and science | 15 | 3 | 11.3 |
| Visuals and UX | 15 | 2.5 (function and accessibility 3; how it looks, feels and sounds 2) | 9.4 |
| Performance | 10 | 2 (simulation, storage and server 3; drawing on a real device 1) | 5.0 |
| Security and cost | 10 | 3 | 7.5 |
| Autonomous engineering | 10 | 3 | 7.5 |
| **Total** | **100** | | **68** |

### Why each grade, and why not a higher one

**Simulation correctness — 3.** The engine is deterministic by construction (keyed randomness, integer state,
no clock: D-003, enforced by lint) and that is checked rather than assumed: the same digests in Node, a browser
page and a browser worker (`tests/e2e/diagnostics.spec.ts`); conservation of goods, validation of every action
and fair arbitration under property tests; 3,000-case fuzzing of opened files; a differential test of the
route finder against a fresh search over 720 questions; a golden replay; 672 study runs of which 72 were re-run
to the hash. A seeded mutation run kills 20 of 20 mutants — after it had first found two invariants no test
held (`evidence/phase-16/mutants*.txt`). *Not higher:* the reviewers who looked at the engine found real
defects in it (citizens could tell of things they had never perceived; Two Shores did not do what its card
said), which is evidence both that review works and that the engine was wrong for most of the build. One behavioural
defect is known and deliberately unfixed (below). Nobody outside this session has tried to break it.

**Agent and institution sophistication — 2.5.** *The machinery and the baseline minds, 3:* perception to belief
to memory to plan to intent to outcome with provenance at each step (`docs/COGNITION.md`); a bounded-rational
planner whose thresholds trace to traits and experience; an institution grammar in which rules are proposed,
ratified and then executed by an interpreter, with nothing about government, money or occupation written in
(`docs/INSTITUTIONS.md`, `docs/AFFORDANCES.md`); all of it exercised together in the game and in 672 study
runs. *Model-driven minds, 2:* the adapter, the prompt, the answer schema, the three schedulers and the
recording format exist and pass their tests against canned responses and a mock provider — and have never met
a model. *Not higher:* the central promise of the project is a society of language-model minds, and there is no
evidence here about one. And what evidence there is about institutions is sobering: the registered positive
control failed on holdout seeds (H6a, D-044), so nothing in this repository shows that agreements help the
people who make them.

**Reproducibility and science — 3.** Hypotheses, measures, tests and the holdout seeds were registered before
any batch was run (`docs/EXPERIMENT_PROTOCOL.md`); the confirmatory batch was run once and published as it came
out, falsifications included; deviations are tabled; every cell can be re-run to its hash by command, and one
at a time in a visitor's browser; the bibliography's 57 entries each name the record they were checked against
(`docs/LITERATURE.md`). *Not higher:* every reproduction ran this code — on this machine or in CI. No second
implementation, statistician or reader has checked the protocol, and the analysis was written by the party
that wrote the hypotheses.

**Visuals and UX — 2.5.** *Function and accessibility, 3:* the whole loop is driven by browser tests on a
desktop and a phone project, by keyboard alone on desktop; no machine-detectable accessibility violation on
seventeen screens; every pressable target on the phone project measured at 44 × 44 px or more; the top bar
measured at 25 widths in three states. *How it looks, feels and sounds, 2:* two art passes judged from
captures by the agent that made them (`docs/ART_BIBLE.md` has its own rubric), under a software renderer.
*Not higher:* **no person has seen it move, no ear has heard it, and it has run on no device.** The tests also
kept finding things a person would have seen at once — an atlas in two columns on a phone, a notice replaced
within a frame, a card over a close button.

**Performance — 2.** *Simulation, storage and server, 3:* thresholds were written down and measured
(`docs/PERFORMANCE.md`): the reference world runs at eight to twenty-five times what the fastest speed asks; a
profile found, and an exact memo removed, a collapse to 13 ticks a second at 500 people; the ledger balances
its books under 32 workers; public routes answer in a few milliseconds. *Drawing on a real device, 1:* presets
and a fallback exist and their logic is tested; **frame rate has not been measured on anything with a graphics
chip.** Two thresholds are unmet or unjudgeable under the software renderer and one is marked NOT RUN.

**Security and cost — 3.** An adversarial review by a separate agent found no critical or high issue and 24
lesser ones; all are fixed or accepted with reasons, each fix held by a test; the mutation run covers the
ledger, the gate and the session rules; the ledger was loaded through two pools and through a real transaction
pooler (which is how a defect that would have broken the first deployment was found: D-047). The ceiling
lives where the passphrase cannot reach it. *Not higher:* the live path has never met the provider, so the
cost bound is arithmetic and not an observation; the game and the console share an origin; no person has
attacked it.

**Autonomous engineering — 3.** Seventeen hours, five messages from the owner, none of them a correction of
substance; phases ended with executed checks and commits; progress, decisions and evidence were kept so that
the work could be picked up from the repository alone; defects were looked for (two reviews, a mutation run, a
long benchmark, a pooler) and nineteen more were found and fixed while fixing the reviewers'. *Not higher,
and these are process failures:* the incident in the veto table; documents that claimed more than the code did
until an audit was commissioned; **seven hours without a push** between pull requests 2 and 3, during which
the owner could see nothing and asked twice what was happening; and two phases whose gates depend on things
only the owner can give were reached without having asked for them earlier.

## What was found, and by whom

| Found by | What | Where |
|---|---|---|
| A separate reviewing agent (security) | 8 medium, 16 low, 8 informational; 26 fixed, 6 accepted | `evidence/phase-16/review-security.md`, `docs/QA_REPORT.md` |
| A separate reviewing agent (documents against code) | 5 high, 17 medium, 16 low; all fixed | `evidence/phase-16/review-documentation.md`, `docs/QA_REPORT.md` |
| CI on GitHub | one transient failure of a screenshot capture | `evidence/phase-19/ci-runs.txt` |
| The owner | pointed at that failing check | `docs/PROGRESS.md` § Human interventions |
| The developer agent's own tests and measurements | 19 further defects while fixing the above (9 medium, 10 low; 18 fixed, 1 recorded) | `docs/QA_REPORT.md` § Found while fixing |
| The registered experiment | that the positive control does not hold | `docs/EXPERIMENT_PROTOCOL.md` §11, D-044 |
| The owner, on their own phone (2026-11-26, after this was scored) | two defects that every test and still had passed: a list whose words crowded off the screen, and a Follow that held the person followed behind their own card. Three more defects of Follow were found looking into the second | `docs/QA_REPORT.md` § Reported by the owner from their phone, D-052 |

## Built, then replaced

Things that were implemented and later taken out or redone, with the decision that records why:

- The top bar's fixed breakpoints (D-038) → a bar that measures itself (D-045).
- Two Shores as first designed, which removed resources and starved both shores → resources moved between
  shores (D-041).
- A live integration test inside the suite → deleted; a numbered script that nothing in the suite or CI can
  reach (D-042).
- A spending ceiling the console could set → a ceiling in the deployment's configuration (D-042).
- Database limits sent when a connection is made (D-042) → limits that open every transaction (D-047).
- The first reference ecology, which could not carry its people → retuned against measurements (D-014).
- Prompt p1 → p2, when what a mind may be told changed (D-040).
- An autosave that waited for a frame landing exactly on midnight → one that is written at any speed.
- One place for all passing messages → notices that news cannot displace.
- A 40-pixel allowance for six speed buttons → a row of their own at 44.

## Where the build departed from the prompts

The prompts invite this and ask that it be recorded. All 48 decisions are in `docs/DECISIONS.md`; the ones
that changed the shape of the product: institutions and economy before the provider adapter (D-001); an
imperative renderer instead of a React scene graph (D-002); client-driven, resumable steps instead of a
workflow service (D-009); a grammar search as an explicit, labelled non-language-model treatment (D-010); the
observer's hand always forks against a twin that shares its luck (D-012); a field journal of things witnessed
instead of objectives (D-030); one owner and no accounts (D-025); a positive control, registered and then
reported as failed (D-018, D-044).

## Benchmarks

| What | Command | Result | Raw output |
|---|---|---|---|
| Engine, headless, 50 to 500 people | `pnpm bench -- --days 20 --policy planner` | 1,070–1,579 ticks a second at 50; 97–102 at 500 | `evidence/phase-15/bench-planner-*.txt` |
| In a browser | `node scripts/perf.mjs <url> <dir>` | 128 of 128 ticks a second asked with the picture kept small; frame times not meaningful here | `evidence/phase-15/perf-browser*.md` |
| The ledger under contention | `pnpm load` | 1,144 reservations a second; books balanced; no ceiling exceeded | `evidence/phase-15/load.txt` |
| The server's routes | `pnpm requests` | public routes p95 2.9–4.6 ms on loopback | `evidence/phase-15/requests.txt` |
| The same through a transaction pooler | see the file | 107 of 107 server tests; 809 reservations a second | `evidence/phase-16/pooler.txt` |
| Mutation run | `pnpm mutants` | 20 of 20 killed | `evidence/phase-16/mutants.txt` |
| Study cells to the hash | `pnpm study -- --verify …` | 48 of 48 and 24 of 24 | `evidence/phase-16/*/verify.txt` |
| A running site | `pnpm release:check -- <address>` | 25 of 25 against a local production build with no variables | `evidence/phase-18/release-check-local.txt` |

Screenshots: `evidence/phase-04` to `phase-18`, and `docs/ART_BIBLE.md` for what was looked for in them.

## Reproducibility bundle

Everything needed to repeat the measurements is in the repository at the commit named at the top.

```bash
pnpm install --frozen-lockfile
```

```bash
export TEST_DATABASE_URL=postgres://tabula:tabula@localhost:5432/tabula_test
```

```bash
pnpm check
```

```bash
pnpm e2e
```

`pnpm check` is lint, types, the 470 tests, generated-file freshness, the secret scans, the build and the
bundle scan, and exits 0 in about five minutes; `pnpm e2e` is the browser suite against the production build,
about forty minutes on a software renderer. `docs/CONTINUE_HERE.md` § Verify the tree lists every other
command with what it proves, and `docs/EVIDENCE.md` maps each claim to its command, its raw output and what
that output does not show. The studies carry their own manifests (`public/studies/*/manifest.json`: engine
version, seeds, configuration, hashes).

## Unresolved, most important first

1. **The live path has never run.** Phase 17 is blocked on the owner's authorization. Until a smoke test is
   made, every statement about model-driven minds, their cost and their behaviour is about code, not about
   what happens.
2. **Nothing was deployed when this was scored.** Since 2026-11-26 the game alone is, at
   https://tabula-rasa-bay.vercel.app, by the owner's import, and it passes the release check (25 of 25). The
   scores above are not revised for it: they were given without it. The console is not deployed, and the first
   hosted database will be the first real test of D-047.
3. **No person and no device.** No playtest, no real phone, no graphics chip, no screen reader, no browser but
   Chromium, no ear. `docs/QA_REPORT.md` § Not run. Since this was scored the owner has opened the deployed
   game on a phone, once, and found two defects within minutes (D-052). The scores above are not revised for
   it; it is the first measurement of what "nothing here was looked at by a person" was hiding, and it argues
   for the lower reading of every criterion that rests on stills.
4. **The positive control failed** (D-044). The experiment as designed cannot show that agreements help; a
   redesign is a new registration on new seeds.
5. **Baseline planners in a crowded famine ask for the unreachable every tick** (D-046). The cost is fixed; the
   behaviour is not, and repairing it is engine 0.8.0.
6. **One origin** for the game and the console (`docs/SECURITY.md`).
7. **The repository has no licence** (`package.json` says `UNLICENSED`).

## If another coding model is given the same task

To compare like with like: start from commit `b9ef55a` (the owner's prompts and nothing else) with the same
first message (`docs/PROGRESS.md` quotes the interventions; the instruction itself is the first message of
pull request 1's session); the same kind of machine, or note the difference (a graphics chip changes what can
be measured); no key and no spend unless the owner authorizes the same amounts; the same holdout rule (seeds
9000–9999 untouched until a registered batch). Then measure with the same instruments — `pnpm check`,
`pnpm e2e`, `pnpm mutants`, `pnpm bench`, `pnpm load`, `pnpm study -- --verify`, `pnpm release:check` — where
the other build has equivalents, apply the same four vetoes, and grade against the same anchors with the same
strict reading of "independently". Record time, tokens and every human message the same way. A second build
will not share this one's tests, so the fair comparison is of gates passed and defects found by parties other
than the builder, not of test counts.
