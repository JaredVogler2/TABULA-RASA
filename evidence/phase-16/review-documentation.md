<!--
This is the report of an independent review, kept as it was returned (2026-11-25).

Who wrote it: a separate review agent started by the developer agent for phase 16, with a brief to
check what the documents claim against the code, read-only. It had no part in writing either. It is
model output, not the work of a person, and nobody has checked it line by line except by acting on it.

What it reviewed: commit f2ac17d, the first form of the phases 13-14 commit. The commit that was
pushed, 8cf713f, has the same source code; it adds the evidence files and small edits to three
documents. Paths are those of the checkout it read.

What was done about each finding: docs/QA_REPORT.md.
-->

# Documentation audit: claims the code does not support

Audited commit `f2ac17d` ("Phases 13-14"), read-only. The working tree was being edited throughout (uncommitted phase-15 work), so for the changed files I read the committed versions with `git show HEAD:`. I ran no build, test or Playwright job. The only code I executed was one roughly one-second `tsx` snippet that generated two worlds and computed the cost bound; it is deleted and nothing in the repository was touched. Nothing in this report comes from memory (the index was empty).

## Summary counts

| Severity | Count |
|---|---|
| HIGH | 5 |
| MEDIUM | 17 |
| LOW | 16 |

The server, budget and security documents hold up well: nearly every number and test name in `SECURITY.md` and `COST.md` matches the code. The weak spots are the phase 13–14 evidence trail, `CHARTER.md` (a phase-01 text that no longer describes the product), and a few stale lines in `ARCHITECTURE.md`, `COGNITION.md` and `ODD.md`.

## HIGH

**H1. Phase 13 and 14 results cite raw-output files that are not in the repository.**
- `/home/user/TABULA-RASA/docs/EVIDENCE.md:217–228` cites `evidence/phase-13/tests.txt`, `e2e-run.txt`, `e2e/{desktop,mobile}/39…45.jpg`, `topbar.txt`, `topbar-*.jpg`, `a11y-desktop.json` and `a11y-mobile.json`.
- `/home/user/TABULA-RASA/docs/EVIDENCE.md:238–247` cites `evidence/phase-14/tests.txt`, `e2e-run.txt` and `e2e/{desktop,mobile}/50…52.jpg`.
- No `evidence/phase-13/` directory exists, tracked or on disk. `evidence/phase-14/` holds only `pilot/*` and `verify.txt`.
- The same missing paths are cited at `/home/user/TABULA-RASA/docs/ACCEPTANCE.md:16` and `/home/user/TABULA-RASA/docs/DECISIONS.md:674` and `:775`.
- `/home/user/TABULA-RASA/README.md:7` says "evidence for every claim is in `docs/EVIDENCE.md`", and `PROGRESS.md` marks phase 14 PASS on this basis.
- Passing outputs for the history and lab specs do exist in the session scratchpad (`e2e-13.out`, `e2e-13b.out`), but they are not evidence in the repo.

**H2. Zod is declared but never used.**
- `/home/user/TABULA-RASA/docs/ARCHITECTURE.md:13`: "Validation at trust boundaries | Zod 4 | Provider output, API bodies, imported bundles."
- `zod` appears only in `/home/user/TABULA-RASA/package.json:48`; there is no import anywhere in `src/`, `scripts/` or `tests/`.
- Validation is hand-written in `src/providers/wire.ts`, `src/server/http.ts:89` (`readJson`) and `src/engine/save/history.ts:147` (`openBundle`).

**H3. Two Shores does not split resources by shore.**
- `/home/user/TABULA-RASA/docs/CHARTER.md:69`: "stone and clay lie on one shore, timber and most food on the other."
- `/home/user/TABULA-RASA/src/engine/world/nodes.ts:12–117` places nodes by biome only; nothing reads `strait` or `terrain.region`. Only the strait and ford exist (`src/engine/world/terrain.ts:124–146`).
- Generated `two_shores` seed 1, counts per shore: stone 31/35, clay 5/10, trees 193/213, berries 99/73, roots 52/52.
- The same sentence is shown to players at `/home/user/TABULA-RASA/src/engine/model/config.ts:198`.

**H4. Baseline minds do propose charters.**
- `/home/user/TABULA-RASA/docs/COGNITION.md:5–6`: "the baseline minds never propose one (the test suite checks the planner's source for institutional intents)."
- `/home/user/TABULA-RASA/src/engine/mind/civic.ts:207` emits `{ k: "propose", charter: found.charter }` for planner agents under `grammar_search`, which is the default (`src/engine/model/config.ts:133`).
- The cited test now reads "its only source of a proposal is the grammar search" (`src/engine/mind/cognition.test.ts:245`).
- `INSTITUTIONS.md` and `ODD.md` describe this correctly; the `COGNITION.md` sentence is a leftover, but it bears on the emergence claim.

**H5. The hosts table still describes persistence and lab batches that do not exist.**
- `/home/user/TABULA-RASA/docs/ARCHITECTURE.md:109`: "Browser Web Worker | Free play, title vista, counterfactual forks, Lab batches | … snapshots and ledgers go to IndexedDB."
- The worker never touches IndexedDB; only the page does, through `src/persist/saves.ts`. The event ledger is in memory only (`src/worker/sim.worker.ts:130–131`).
- `/home/user/TABULA-RASA/src/worker/lab.worker.ts` re-runs one cell; batches run in Node via `scripts/study.ts`.
- This is the same error as the corrected §8, still standing in §6, and it contradicts §2 and §8 of the same file.

## MEDIUM

1. **Rolling digest.** `/home/user/TABULA-RASA/docs/ARCHITECTURE.md:72` ("A fast 64-bit rolling digest is recorded per day") and `:99` ("bookkeeping metric accumulators, rolling digest"). `src/engine/sim/step.ts:99–101` only calls `sampleDay` and increments the tick. `worldDigest` is computed on demand: per epoch for runs and recordings, at re-run tips, and per day only in `scripts/sim.ts --replay` and tests.
2. **Pipeline shape.** `/home/user/TABULA-RASA/docs/ARCHITECTURE.md:69` ("Agents, nodes and structures are processed in id order") and `:93–97` list validation, arbitration and application as separate phases. `src/engine/sim/step.ts:75–94` runs interrupt → decide → start → advance per agent in a keyed random order redrawn each tick. Only bodies and perception go in id order. `ODD.md` §1.3 has it right.
3. **Objectives are never evaluated.** `/home/user/TABULA-RASA/docs/CHARTER.md:61–62` ("objectives are evaluated only from engine state") and `:37` ("take on an optional challenge"). The only use is display text at `src/ui/game/Title.tsx:92`. D-030 replaced objectives with the journal.
4. **Voices cannot be widened.** `/home/user/TABULA-RASA/docs/CHARTER.md:78`: "dampen or widen how far voices carry". `src/engine/world/climate.ts:175` takes `Math.min(r, hushRadius)`; the UI offers only Hush.
5. **Control table.** `/home/user/TABULA-RASA/docs/CHARTER.md:99–101`, checked against the committed `src/ui/game/Game.tsx:79–172`:
   - "Speed | `1`–`5`": the keys are 1–6.
   - "Chronicle / Ledger / Compare | `C` / `L` / `K`": `L` opens the atlas; Charters is `G`.
   - "Swipe down or close button": no swipe handler exists in `src/ui`; the sheet's grab bar (`game.module.css:1450–1458`) is decorative.
6. **Touch targets.** `/home/user/TABULA-RASA/docs/CHARTER.md:103` ("at least 44 × 44 CSS px") and `/home/user/TABULA-RASA/docs/OBSERVER_UX.md:58`. In `src/ui/game/game.module.css`: speed buttons are 40 px high on phones (`:1543–1546`) and 36 px wide at ≤880 px (`:1434–1435`); the fork badge is 38 px (`:1400–1401`); banner buttons have `min-height: 30px` (`:324–325`).
7. **Stale product flow.** In `/home/user/TABULA-RASA/docs/CHARTER.md`:
   - `:40–43` and `:136` promise registering studies, batches "headlessly in workers" and a "study wizard". None exists (D-036).
   - `:128` "scrub history", `:133` "Debrief", `:132` a "resources" overlay. None exists; the overlays are knowledge and ties only.
   - `:137` and `:149` say recordings are "of real runs; empty until such runs exist". A mock recording is bundled at `public/recordings/mock-first-light.json`.
8. **Chronicle coverage.** `/home/user/TABULA-RASA/docs/OBSERVER_UX.md:13` says "every logged event". The worker forwards only the kinds in `UI_EVENTS` (`src/worker/sim.worker.ts:316`); the store keeps 600 (`src/ui/game/controller.ts:16`); the panel shows 220 (`src/ui/game/Panels.tsx:69`). `/home/user/TABULA-RASA/docs/EVIDENCE.md:69–70` says "the most recent 4,000"; the cap was already 600 at the phase-04 commit.
9. **Engine version.** `/home/user/TABULA-RASA/docs/ODD.md:4`: "engine version 0.4.0". `src/engine/version.ts:11` is `0.6.0`, and the same document describes `planEvery`, a 0.6.0 feature.
10. **Holm scope.** "Across the family" at `/home/user/TABULA-RASA/docs/EXPERIMENT_PROTOCOL.md:79` and `:112`, `/home/user/TABULA-RASA/docs/DECISIONS.md:714–715` and `/home/user/TABULA-RASA/docs/PROGRESS.md:21`. `src/lab/analyse.ts:111` adjusts within each study's one or two contrasts, as its own test title says (`src/lab/analyse.test.ts:96`). Verdicts use intervals, so they are unaffected; the reported adjusted p-values are.
11. **Holdings inequality.** `/home/user/TABULA-RASA/docs/EXPERIMENT_PROTOCOL.md:45` defines it over "(carried + claimable)". `src/engine/metrics/accumulate.ts:76` uses carried inventory of the living only. This is not in the §10 deviation log.
12. **Wrong evidence paths.** `/home/user/TABULA-RASA/docs/DECISIONS.md:569`, `:599`, `:609` cite `evidence/phase-11/knowledge.jpg`, `charter.jpg` and `paths.jpg`. The files are under `evidence/phase-11/shots/`.
13. **Provider host not pinned.** `/home/user/TABULA-RASA/docs/SECURITY.md:25`: "Outbound only, to the provider host only." `src/server/anthropic.ts:42` passes no `baseURL`, and the installed SDK defaults it from `ANTHROPIC_BASE_URL` (`node_modules/@anthropic-ai/sdk/client.js:104`). The claim holds by default, not by construction.
14. **Skipped-test count.** `/home/user/TABULA-RASA/docs/CONTINUE_HERE.md:43–44`: "without `TEST_DATABASE_URL` eleven more are skipped", in the unit-test clause. Six unit tests are gated (`src/server/ledger.test.ts:272`, five; `src/server/runs.test.ts:370`, one). Eleven is reached only by adding five E2E test-project pairs.
15. **Keyboard evidence overstated.** `/home/user/TABULA-RASA/docs/EVIDENCE.md:56` and `:204`, `/home/user/TABULA-RASA/docs/ACCEPTANCE.md:40`, `/home/user/TABULA-RASA/docs/OBSERVER_UX.md:35`. The test (`tests/e2e/play.spec.ts:182–227`) clicks `coach-skip` with the mouse (`:191`), sets focus programmatically, presses six of the thirteen instrument keys, and closes six of ten panels with Escape.
16. **Refused decisions do change state.** `/home/user/TABULA-RASA/docs/COGNITION.md:84` and `/home/user/TABULA-RASA/docs/EVIDENCE.md:80` say a refused decision changes no state. `src/engine/mind/external.ts:117–155` sets `nextDeliberation`, `feedback` and `note`, bumps a metric and emits an event. D-022 item 5 states it correctly.
17. **Import control marked planned.** `/home/user/TABULA-RASA/docs/SECURITY.md:43` lists T10 as "planned (phase 13)". Hash, size and format checks exist in `src/engine/save/history.ts:147–178`, with tests in `history.test.ts` and `sim.worker.test.ts`.

## LOW

| # | Doc location | Claim | What the code shows |
|---|---|---|---|
| 1 | `/home/user/TABULA-RASA/docs/SECURITY.md:66–68` | "Every other route answers 401 or 403 before touching the database" | Login touches the DB first; logout returns 200; `GET /api/runs/[id]` returns 404 after a DB read (`src/server/api.ts:82–108`, `:241–252`) |
| 2 | `/home/user/TABULA-RASA/docs/SECURITY.md:35` (also `EVIDENCE.md:161`, D-025) | "8 endpoints × 6 forgeries" | Seven routes; `control` is exercised twice (`src/server/api.test.ts:150–159`) |
| 3 | `/home/user/TABULA-RASA/docs/ARCHITECTURE.md:58` | Server modules import `server-only` | `src/server/migrations.generated.ts` does not |
| 4 | `/home/user/TABULA-RASA/docs/ARCHITECTURE.md:160` | "the last committed day is intact" | Autosave is every second day (`src/ui/game/controller.ts:318`) |
| 5 | `/home/user/TABULA-RASA/docs/ARCHITECTURE.md:67–68` | Only world generation uses doubles | Mind scoring and metrics do too (`src/engine/mind/knowledge.ts:82`, `:199–204`), with exact operations only |
| 6 | `/home/user/TABULA-RASA/docs/COST.md:55–56` vs `:75`, `:87` | "input bound" includes 2,000 hidden tokens | The quoted 18,800 and 25,052 exclude them; the dollar figures are right |
| 7 | `/home/user/TABULA-RASA/docs/COST.md:83` | Haiku "500 / 2,500" calls | Derived from the rounded $0.004; exact is 505 / 2,525 |
| 8 | `/home/user/TABULA-RASA/docs/EVIDENCE.md:42` | "24.9 MiB at 500 agents" | `bench.json` has 24,897 KiB, which is 24.3 MiB |
| 9 | `/home/user/TABULA-RASA/docs/ODD.md:108–109` and `:25` | Nodes "starting full"; "≈ 1,000 per island" | Renewables start at 60–100% (`src/engine/world/nodes.ts:168`); four seeds gave 856–886 nodes |
| 10 | `/home/user/TABULA-RASA/docs/EXPERIMENT_PROTOCOL.md:72` | Origins include `mixed` | The type is `grammar_search`, `llm`, `mock`, `scripted` (`src/engine/institutions/types.ts:124`) |
| 11 | `/home/user/TABULA-RASA/docs/DECISIONS.md:133` and `:304–305` | "behind `LedgerStore`"; "three sanctions" | No such interface exists; there are four sanction types including `note` |
| 12 | `/home/user/TABULA-RASA/docs/ART_BIBLE.md:152–153` | Resolution drops "in 20% steps (to 60% at most)" | `adapt()` subtracts 0.2 of absolute pixel ratio down to 0.6 (`src/render/WorldRenderer.ts:361`); from ratio 2 that is 30% |
| 13 | `/home/user/TABULA-RASA/docs/ART_BIBLE.md:170`, `:82–83`, `:149–150` | Every pass's capture kept; one cord per member; low preset "0.26 million" triangles | Pass 10's "before" and the first charter capture are not in `cycles/`; cords cap at ten (`src/render/structures.ts:464`); the file says 249,190 |
| 14 | `/home/user/TABULA-RASA/docs/PROGRESS.md:8`, `/home/user/TABULA-RASA/docs/ACCEPTANCE.md:29` | Bibliography verification "in progress" | `EVIDENCE.md:271` says 57 entries, each verified |
| 15 | `/home/user/TABULA-RASA/docs/CONTINUE_HERE.md:50–51`, `/home/user/TABULA-RASA/docs/ACCEPTANCE.md:12` | Phase 13 bolded as next; authority invariants "arrive with phase 09" | Both phases are done |
| 16 | `/home/user/TABULA-RASA/docs/CHARTER.md:23` and `:114` | "Every change … creates a fork"; saves exported "from the menu" | Only the first intervention forks; export lives in the History panel (`src/ui/game/History.tsx:243`) |

## Uncommitted work that affects the docs

- The working tree adds a Web Locks autosave owner. The uncommitted edit to `ARCHITECTURE.md` §9 cites `tests/e2e/tabs.spec.ts`, but that file was renamed to `tests/e2e/resilience.spec.ts` in the working tree (as of 12:39 UTC).
- `/home/user/TABULA-RASA/docs/CONTINUE_HERE.md:88–89` ("§9 says plainly that none exists yet") becomes false when that lands.

## Verified true (sample)

- **Prices and cost arithmetic.** The `COST.md` table equals `src/providers/prices.ts:53–63` and the bundled claude-api skill's table (cached 2026-11-03). The reservation formula matches `worstCaseCost`. The snippet reproduced 25,052 tokens, rules 9,844 bytes, schema 6,208 bytes, and $0.386 / $0.193 / $0.096 / $0.005 per call. The 1,280-call figures and the 16-seed Haiku result follow.
- **Live gate.** `src/server/env.ts:54–61` has the eight conditions, including the preview refusal. The typed phrases, model-mismatch refusal, 300 s step route and 120-person limit are all present.
- **Authentication.** scrypt N = 2^15, constant-time compare, twelve-hour `__Host-` SameSite=Strict cookie, Origin and Fetch-Metadata checks, CSRF token, 5-per-address and 40-overall login limits, 16 KB bodies. Every test named in `SECURITY.md` exists under that title.
- **Ledger.** Kill switch on and zero authorized by default, CHECK constraints, deterministic reservation ids, unknown outcomes held, overage trips the switch. The tests match: 20 of 100, 100 copies granted once, 50 settlements charged once, 60 random sequences.
- **Live adapter.** Exactly six body fields, retries off, 25 classified failure shapes, key in `Authorization: Bearer`, `anthropic-version: 2026-10-21` (both the test and the installed SDK 1.14.0). The smoke-test variables and phrase match `COST.md`.
- **Security headers.** The CSP and other headers in `next.config.ts` are as documented. There is no `dangerouslySetInnerHTML`, no third-party URL, no tracker, and no bundled audio, image or model file.
- **Engine purity.** No import from outside `src/engine`, no forbidden global, no `eslint-disable` anywhere. The lint rules are as described; the RNG is a MurmurHash3 keyed `u32`.
- **Model constants.** 28 intent kinds, 13 items, 9 traits, 4 attributes, 7 skills, 4,096 tiles, sight 7 and 3, hearing 5, memory 48, commitments 8, inbox 12. The trust table, need rates, ecology constants and all institution limits match.
- **History.** Keyframes every second day, at most 24; 40,000-event log; 96 MB bundle limit; 11 ms rebuild slices; six speeds; eight interventions; 21 journal questions; seven almanac measures; 17 axe states.
- **Commands.** Every script and flag in `CONTINUE_HERE.md` and `EVIDENCE.md` exists, including the `study` flags and the holdout-seed guard.
- **Evidence for phases 02–12 and the pilot.** Test totals of 21, 98, 124, 155, 166 and 303 + 1 match the logs. Benchmarks, baseline comparisons, scheduler and civics figures match their files. The pilot has 224 runs, 12 of 12 verified, 32 seeds planned, and every contrast in the `EVIDENCE.md` table.
- **Test counts.** 372 unit tests are consistent with the phase-12 total plus 68 added since. E2E is 14 tests × 2 projects with 3 skips, which gives 25 passed.

## Could not verify

- GitHub Actions run ids and outcomes, the PR link, and CI status (no network).
- That no API call was ever made and no key was ever present. Nothing contradicts it.
- Prices against the live provider page; `docs/research/*` and `LITERATURE.md` were out of scope.
- That the suite passes at this commit (371 unit, 25 E2E). I checked counts statically only.
- Phase 13 result details such as "hash equal at tick 1,100" and "25 widths", since their evidence files are absent.
- Size and timing figures: snapshots of about 160 KB, keyframes of 15–300 KB, "about six weeks" for 40,000 events, 35 minutes of E2E, and the traffic measurements (17 / 32 / 33 footfalls).
- The phase-09 isolation experiment, whose instrumentation was removed.
- How anything looks, sounds or runs on a GPU or phone; the docs already disclaim these.
