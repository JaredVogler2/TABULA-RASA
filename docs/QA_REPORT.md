# Adversarial QA report (phase 16)

2026-11-25. This is the record of what was attacked, what was found, what was done about it, and what is left.

## Who did what

- **Two independent reviews** were done by separate review agents, each started with a brief and no part in
  writing the code or the documents, each read-only: one to attack the server, the budget ledger and the
  engine's information boundaries, one to check every claim in the documents against the code. Their reports
  are kept as they were returned: `evidence/phase-16/review-security.md` and `review-documentation.md`. Each
  finding there says where it is, how it was confirmed (by reading, or by running something) and how to
  reproduce it; this report does not repeat the reproductions, it points to them.
- **The fixes, the tests of the fixes, and the further defects** under "Found while fixing" were the developer
  agent's work.
- **The reviewers are models, not people.** No person has tested, attacked or played this application. That
  is a limit of this report, and it is repeated under "Not run".

## Verdict

No critical or high security finding; no finding on the budget ledger's core (reserve, settle, release are
atomic and conditional; nothing is sent without a reservation). Every medium and low finding has been fixed or
is listed as accepted with its reason. Five high documentation findings — documents claiming what the code did
not do — are fixed, one of them by changing the code to do what the document said.

**Nothing here licenses live mode by itself.** The live path has never met the real service.

| Source | Critical | High | Medium | Low | Info | Fixed | Accepted as is |
|---|---|---|---|---|---|---|---|
| Security review | 0 | 0 | 8 | 16 | 8 | 26 | 6 |
| Documentation audit | — | 5 | 17 | 16 | — | 38 | 0 |
| Found while fixing (and, later, in phases 18–20 and after) | 0 | 0 | 11 | 16 | — | 26 | 1 |

## Security review: finding by finding

Reproduction for each is in `evidence/phase-16/review-security.md` under the same number. "Held by" names the
test that would fail if the fix were undone.

| # | Sev. | Finding (the reviewer's result) | Fix | Held by | What remains |
|---|---|---|---|---|---|
| M1 | Medium | The passphrase that spends could also raise the authorization, to $10,000 | A ceiling in the server's environment, `BUDGET_CEILING_USD` (default 0), above which nothing can be authorized; shown in the console | `api.test.ts` › "the credential that spends cannot raise its own limit…"; `ledger.test.ts` › "the deployment's ceiling stands above what the owner can authorize…"; `owner.spec.ts` | A thief of the session can still spend up to the ceiling. No second factor (D-025) |
| M2 | Medium | The smoke test's authorization could be replayed by any later test run, and its ledger was dropped | The test is deleted. A script (`pnpm live:smoke`) outside the suite; numbered, single-use words; a persistent ledger; never drops a schema | `smoke.test.ts` (six tests, canned responses) | **The paid path of the script has never been run** |
| M3 | Medium | 41 requests a quarter hour from one address locked the owner out of sign-in | Per-client count first; the shared count takes only attempts that passed it; a signed device token gives a known browser its own count; a flood is stopped in memory | `api.test.ts` › "one address hammering sign-in cannot lock the owner out…" | An attacker with eight or more addresses can still keep the owner from signing in on a browser never used before |
| M4 | Medium | Every anonymous request wrote to the ledger's database, keyed by full IPv6 address | Public reads are counted in memory, in a bounded table; IPv6 by /64; cleanup indexed and throttled; forwarding headers believed only where something overwrites them | `auth.test.ts` › "counts strangers' reads in memory…", "believes a forwarding header only where…" | Published runs are served uncached (`no-store`), 240 reads a minute per client |
| M5 | Medium | A run could be wedged for good by a call interrupted in flight | Every state of a reservation without a record is recovered on the next step; money and record are written together | `runs.test.ts` › "a call cut off in flight and then swept as unknown does not wedge the run…", "whatever state a recordless reservation is in…", "if the record of a call cannot be written, its money is not moved either…" | — |
| M6 | Medium | Any 5xx was taken as proof that nothing was billed | Only the provider's own error format with a request id is a rejection; anything else is unknown, stays held and is not re-sent | `anthropic.test.ts` › "an error page from something between here and the provider proves nothing…" | Whether the provider bills such a case cannot be checked offline; the rule assumes it may |
| M7 | Medium | Naming ids in speech taught hearers the true state of things nobody had seen | A speaker can tell only of what they know; a hearer takes on the speaker's belief (D-040) | `institutions.test.ts`, `cognition.test.ts` | Members still see their own agreement's live state at any distance (accepted, below) |
| M8 | Medium | Role names reached other minds' pages unquoted, in the engine's voice | Role names are plain labels of at most 24 characters, always quoted; the rules text says whose words they are | `institutions.test.ts` (hostile role names), `prompt.test.ts` | That a real model is not moved by a quoted label is untested |
| L1 | Low | Overage was outside every cap; releasing the kill switch needed no confirmation | Overage counts against total, run and day; a switch tripped by money needs typed words | `ledger.test.ts` › "money charged beyond a hold counts against the total, the run and the day…"; `api.test.ts` › "a switch that money tripped is not released by a click…" | — |
| L2 | Low | The SDK took its destination, headers and logging from the environment | A guard around `fetch` (one method, one host, one path, listed headers, no redirect); logging off; live mode refuses while such a variable is set | `anthropic.test.ts` › "nothing in the environment adds a header, turns on a log or a trace, or moves the request…" | — |
| L3 | Low | Live mode was allowed on the single-connection local database outside production | Live mode requires PostgreSQL everywhere | `auth.test.ts` › "is available only with the switch on, a key, a priced model, a database…" | — |
| L4 | Low | `cleanText` let line separators and invisible characters through | An explicit list of code points; whitespace collapsed; idempotent | `core/text.test.ts` (every code point against this runtime's Unicode) | The list must grow with Unicode; the sweep fails when it falls behind |
| L5 | Low | A model's charter block reached the plan and the tape unvalidated | Intents rebuilt from known fields; attachments bounded in depth, size and vocabulary | `core/bounded.test.ts`, `cognition.test.ts`, `wire.test.ts` | — |
| L6 | Low | A settlement arriving after a release was dropped silently | Recorded in full as overage; the kill switch turns on; the run pauses | `ledger.test.ts` › "a charge that arrives after its hold was given back is never dropped…" | — |
| L7 | Low | No circuit breaker for answers paid for and unusable | Three in a row pause the run; an answer from another model stops it | `runs.test.ts` › "a run that keeps paying for answers it cannot use is stopped after three…" | — |
| L8 | Low | A step could outlive its lease and its function | A call's wait is cut to what is left of the lease; none starts in the last seconds; lease 280 s over a 150 s budget | `runs.test.ts` › "no call is left waiting past the end of the lease…" | Timings are from tests with a fake clock, not from a deployed function |
| L9 | Low | Published runs disclosed the cap and the worst-case cost | A visitor is given a named subset of the manifest | `api.test.ts` › "runs a mock society end to end…"; `owner.spec.ts` | — |
| L10 | Low | An unvalidated `from`, and handler errors that could escape | `from` validated; every handler wrapped: an unexpected error is a bare 500 | `api.test.ts` › "runs a mock society end to end…" (malformed `from` values) and "fails closed when the database cannot be reached" | — |
| L11 | Low | Sign-out did not end a session; passphrase hash cost was low | Sign-out moves an epoch in the database and ends every session; scrypt N = 2^17 for new hashes | `api.test.ts` › "signing out ends every copy of the session…"; `owner.spec.ts` (a copied cookie stops working) | Twelve-hour sessions; no second factor |
| L12 | Low | The sign-in limiter trusted a header the platform must sanitize | Believed only on Vercel (its own header) or with `TRUST_FORWARDED_FOR` | `auth.test.ts` | Elsewhere every visitor is one client to the limiter |
| L13 | Low | Opening a world file checked the envelope, not the state | Every field checked; goods audited; a trial run; a fault notice; provenance shown (D-043) | `save/validate.test.ts`, `sim.worker.test.ts`, `history.spec.ts` | A field added to the engine later is not checked until added to the validator |
| L14 | Low | Audit rows written after the action, outside its transaction | Reconciliation, run status and publication write theirs in the same transaction | The rows are asserted (`runs.test.ts`, `ledger.test.ts`); that they share the transaction is by construction and has no test of its own | A failed audit of a sign-in is logged, not fatal |
| L15 | Low | The secret scans had blind spots | Every kind of provider key and token; no excusing marker; exact-host exclusion; untracked files; archives fail; a history scan in CI | `tests/unit/scans.test.ts` | Pictures, fonts and sound are not read into |
| L16 | Low | One origin serves the game and the console under `'unsafe-inline'` | **Accepted**, with mitigations: injection sinks are lint errors under `src/`; damage bounded by the ceiling | `eslint.config.mjs` › `no-injection-sinks` | A separate host for the console is the real fix and is the owner's to decide (`SECURITY.md`, "One origin") |
| I | Info | No statement or lock timeout on connections; `db:migrate` ignored `DATABASE_SCHEMA`; `pnpm audit` not run | Timeouts set, broken connections destroyed; honoured; run (no known vulnerabilities, `evidence/phase-16/dependencies.txt`) | `db.test.ts`: each limit is waited for against PostgreSQL (a statement cancelled, a lock not waited for, an idle transaction ended), and what is sent is read off the wire. Written late, and it found two defects: see "Found while fixing" and D-047 | — |
| I | Info | HSTS only on Vercel; CI actions pinned by tag; `window.__tr` in production; members see their agreement's live state; a mind's own feedback is unquoted | **Accepted** as they are, and listed in `SECURITY.md` | — | As stated there |

## Documentation audit: finding by finding

Reproduction for each is in `evidence/phase-16/review-documentation.md`.

| # | Finding | What was done |
|---|---|---|
| H1 | Phases 13–14 cited evidence files that were not in the repository | The files were added before the commit was pushed (`evidence/phase-13/`, `evidence/phase-14/`) |
| H2 | Zod was declared as the validator and never used | The dependency is removed and the architecture document describes the hand-written validators that exist |
| H3 | Two Shores did not divide resources by shore | **The engine was changed to do it** (D-041); measured in `evidence/phase-16/two-shores.txt` |
| H4 | "The baseline minds never propose" an institution: they do, by search | `COGNITION.md` rewritten: what the planner does not do, what the civic layer does, and what the tests check |
| H5 | The hosts table described persistence and laboratory batches that do not exist | `ARCHITECTURE.md` § 6 corrected to match §§ 2 and 8 |
| M1–M2 | A "rolling digest per day" and a three-phase pipeline that the engine does not have | `ARCHITECTURE.md` describes the step as it is (and `ODD.md` already did) |
| M3–M5, M7 | The charter promised evaluated objectives, widened voices, a wrong control table and a product flow that was not built | Charter rewritten to the product; the differences are D-039 |
| M6 | "At least 44 × 44 px on touch devices" was false for speed buttons, the fork badge and banner buttons | The controls were enlarged for coarse pointers, and `a11y.spec.ts` now measures every pressable target on every scanned screen of the phone project against the charter's rule, 44 × 44 px. The measurement found more (see "Found while fixing"); with those fixed the narrowest and the shortest target it meets are both 44 px (`evidence/phase-16/a11y-mobile.json`) |
| M8 | The Chronicle shows "every logged event": it shows notable ones, the latest 600 | `OBSERVER_UX.md` and `EVIDENCE.md` state the counts (60 kinds, 44 forwarded, 38 with a line) |
| M9 | The model description named engine 0.4.0 | It describes 0.7.0, with testimony and Two Shores as they now are |
| M10 | Holm "across the family" was applied within each study | The analysis was changed to the whole family before the confirmatory batch; logged as a deviation in the protocol |
| M11, L10 | Holdings inequality and institution origin were measured more narrowly than registered | Logged as deviations in the protocol, § 10 |
| M12, L8, L11–L14 | Wrong evidence paths, a unit slip, an interface that does not exist, art-evidence overstatements, stale "in progress" notes | Corrected where they stand; a decision record that was wrong carries a dated correction rather than a silent edit |
| M13 | "To the provider host only" held by default, not by construction | Now by construction (security L2) |
| M14, L15 | Stale counts and "next phase" notes in the handoff document | `CONTINUE_HERE.md` rewritten for this phase |
| M15 | The keyboard-only test clicked once with the mouse and pressed six of the keys | Rewritten: Tab and Enter from the title, every key the game reads, no pointer (`play.spec.ts`) |
| M16 | "A refused decision changes no state": it changes the books | `COGNITION.md` and `EVIDENCE.md` say exactly what it changes |
| M17 | The import control was listed as planned | It is implemented and extended (D-043) |
| L1–L2 | Loose wording about what a stranger's request touches; "8 endpoints × 6 forgeries" | `SECURITY.md` rewritten; the count is gone |
| L3 | A generated server module did not import `server-only` | The generator emits it |
| L4–L7, L9, L16 | Small inaccuracies in architecture, cost, model description and charter | Corrected where they stand |

## Found while fixing

Defects that neither review reported, found by the tests and measurements written for the fixes.

| Sev. | What was found | How | Fix |
|---|---|---|---|
| Medium | The provider's SDK (1.14.0) turns on OpenTelemetry tracing and trace-header propagation by default: where a host application has tracing set up, requests would have been described to it | Reading the installed SDK while pinning the host | `openTelemetry: false`; the guard's header allow-list would refuse a trace header anyway; tested |
| Medium | In a crowded world that is starving, baseline planner agents ask every tick to gather from a place they cannot reach, and each asking searched the whole island: at 250 people the simulation fell to 41 ticks a second, at 500 to 13. The five-day benchmark had hidden it | A twenty-day benchmark, then a profile, then counting refusals day by day | The cost is fixed (an exact memory of failed searches, proven hash for hash: D-046). **The behaviour is not**: it is a defect of the baseline planner, recorded for the redesign. The reference world shows no such refusal in forty days; 42 sampled cells of the registered studies show 110 in all and no loop (`evidence/phase-15/unreachable-refusals.txt`) |
| Medium | The top bar overflowed with the longest labels it can show: the name squeezed at 1600, 1366 and 1180 px, the tools off screen at 1120, the status row spilling on every phone width | `scripts/topbar.mjs`, taught to write the longest labels | The bar measures itself (D-045) |
| Medium | Agents "forgot" agreements they were party to when their memory of agreements filled, and were then refused when they spoke of them | Re-running the pilot on the new engine: 219 of 224 state digests matched | Parties always know their agreements; all 224 match |
| Medium | The bound on what a model may attach was below the largest charter the grammar allows | A test that builds the largest legal charter | Bounds raised above the measured maximum (4,137 values and keys) |
| Medium | Fields the engine does not know survived from a model's answer into the tape | A test planting unknown keys | Intents rebuilt from known fields; keys from the grammar's vocabulary only |
| Medium | The first Two Shores design starved both shores in the second year | Measuring per shore before choosing | Resources are moved between shores, not removed |
| Low | The smoke run would have asked one mind, not three (as the deleted test also would have) | The new script's own test | All twelve people are model-driven in the smoke world; three are asked |
| Low | Pan and turn keys stopped working with Shift or Caps Lock | The documentation audit's follow-up | Letters are read without regard to case; tested |
| Low | Tests and scripts used the world label's visibility as the sign that a world had loaded | The measurement script failing at 900 px | They read its text, shown or not |
| Low | A sentence in a decision record claimed the validator refuses unknown fields; it does not | Checking the record against the code before committing it | The sentence says what is true |
| Low | Two invariants had no test that could fail for them alone: the check at hearing that a speaker knows the agreement they speak of, and the route memory's tie to what the agent has seen | The seeded mutation run: two of twenty mutants survived | A test for each; twenty of twenty are killed |
| Low | The bundled recording was replayed and checked only by the browser tests; no unit test held it | Looking for the "golden replay fixture" the phase asks for | `tests/unit/recording.test.ts` |
| Low | Six more kinds of control were smaller than the rule on a phone: the first-steps "Skip", the Chronicle's filters, its lines and their "why" buttons, buttons drawn as links, and the laboratory's downloads. The six speed buttons could only be 44 px wide by squeezing the clock off the bar | The measurement the M6 fix added, on its first run | Each is sized for a coarse pointer; on a phone the speeds have a row of their own under the clock |
| Low | That change made the first-steps card cover the inspector's close button on a phone (the time bar had grown a row, and the card shared the sheet's) | The phone walkthrough could no longer close the inspector | The card has a row of its own above the sheet; never committed in the broken state |
| Low | A notice the player has to be told — "Another tab is keeping the autosave", said once — could be replaced within a frame by "Field journal · …": the two shared one place and the newest won. At the fastest speed something new is witnessed every few seconds | The two-tabs test looked for the notice and found the journal's line | Notices keep the place for their whole time; news waits its turn (`src/ui/game/toasts.ts`, six unit tests). The menu's standing line about the autosave was always there |
| Medium | A database connection lost while a transaction held it — an idle transaction ended by the server, a restart, a dropped network — would have ended the server process, and every request on it: the driver announces the loss as an event that the pool listens for only on idle connections | Writing the test that waits for a limit: the run died of "Connection terminated unexpectedly" | Every held connection has a listener; the loss fails the transaction it belongs to and nothing else (D-047). With the listener taken out, the tests fail |
| Medium | The database limits were sent as settings when a connection is made. A transaction pooler — what the connection string of a hosted database points at — refuses such a connection: `unsupported startup parameter in options: statement_timeout`. The ledger could not have been reached on the first deployment | Reading the provider's documentation before deploying; then a pooler run here, which gave that exact refusal | The limits open every transaction instead, so nothing is asked for at connection time and nothing is kept between transactions. Every server suite, the ledger load test and the owner's browser flow pass through the pooler (D-047, `evidence/phase-16/pooler.txt`) |
| Low | A phone rule for the "why" button was written above the rule it changes, and half of it was dead | `tests/unit/css-order.test.ts`, at the next run of the suite | Moved after its base rule |
| Low | The laboratory's browser test still expected the page to open on the pilot bundle, which it had not done since the confirmatory batch was published; the test had not been run since | The first run of the whole suite in a clean checkout (phase 18) | The test checks the confirmatory bundle as what it is, then the pilot |
| Medium | Two of the five aims on the scenario cards could not be met in any world measured: nobody lost to cold or hunger in The Long Winter, and every commons above its threshold in Thin Commons | Counting them, before building the reading that reports them (phase 20) | Reworded to aims that can go either way; all five are now counted (D-049) |
| Low | A morning's worth of identical lines — "A root patch began to recover." six times — pushed everything else out of the Chronicle | Looking at the release's stills (phase 20) | One line with a count, which opens out again |
| Medium | A page slower than its world fell behind it without limit: the worker sent thirty frames a second whether or not the page had dealt with the last. With the page slowed twenty times at 64×, "paused" was shown 31–39 seconds after pause was pressed and the page's own timers ran 17–27 seconds late | Following a browser test that failed once in CI back to its cause, then measuring (after phase 20) | The worker sends a frame only when the page has taken the last one (D-050): 0.7–0.9 seconds under the same slowing; four tests in `sim.worker.test.ts` |
| Low | The two-tabs test demanded an autosave from an even day. The page asks for the autosave when it sees a second morning; at 64× a day lasts three quarters of a second, and on a slow machine the world kept is the next day's. A newer save than the test allowed failed it, once in CI and in five of ten runs here with the page slowed ten times | The failed run; `evidence/after-20/old-assertion.txt` | The test asserts what the game promises — a save from between the last second morning the page saw and where the world stopped — and says what the slot held when it fails |
| Low | The charters test played its world at the fastest speed until a charter was counted and then pressed pause. In that world the scripted charter lapses unsigned every three and a quarter days and is offered again a quarter of a day later; for those quarter days nothing is live and the lapsed charter is folded away. A slow runner stopped the world inside one — on day 19, nine and a half seconds after the first offer — and the test failed for where the world stopped | A second run that failed in CI, on the commit before D-050; the window worked out from the engine alone (`evidence/after-20/charters-test.txt`) | The test takes the world to a known moment by single steps, which land exactly on any machine, and asserts the charter's state before reading its words |
| Low | The bounded copy of a model's charter kept a negative zero, which JSON writes back as `0`: written to a record and read back, the copy was not the copy. No digest could tell (the canonical form already writes it as 0), and no published world has one | The property test for it drew `-0` on one run in CI, on a commit that changed only documents; replayed with the seed its log printed (`evidence/after-20/negative-zero.txt`) | The copy holds `0` (D-051); a test for the case, and the property tries it on every run |
| Low | On every screen 560 px wide or narrower a notice sat 47 px over the time bar, hiding its step button and clock for the five seconds it stays: the bar is two rows tall there, and the notice was placed for one | The release check's own still of the deployed site as a phone; then measured at eight widths (`evidence/after-20/notice-over-time-bar.txt`) | The notice sits above the bar at every width; the whole-loop browser test asserts it on both projects |

## What the phase asked to be examined, and where each is

| Asked for | Where it is examined | Kind of check |
|---|---|---|
| Resources and accounting | `sim.test.ts` (goods audited every tick; sources and sinks declared), `institutions.test.ts` (custody, bonds, escrow), `ledger.test.ts` (the books after any sequence of operations) | property tests, audits |
| Authority and consent | `institutions.test.ts` › authority is bounded by consent; outsiders, late joiners, founder roles, amendments | unit, fuzz |
| The institution rule engine | `institutions.test.ts`, `formula.test.ts` (1,500-case fuzz of formulas written as text), `core/bounded.test.ts` | fuzz, bounds |
| Reproducibility | `tests/unit/recording.test.ts` (the golden recording); `sim.test.ts` (replay); `pnpm study -- --verify` (72 cells of the two bundles re-run to their hashes); `lab.spec.ts` (a cell re-run in the reader's browser) | golden fixture, replay |
| Hidden-information isolation | `cognition.test.ts` (sentinel values planted in other agents never appear in an observation), `institutions.test.ts` (a speaker can tell only what they know; a hearer learns belief), `prompt.test.ts` (nothing from the server's environment reaches a page) | sentinel, unit |
| No leakage between sessions | `api.test.ts` (an unpublished run does not exist for a stranger; a published one carries no money figure), `resilience.spec.ts` (two tabs, two worlds, one autosave slot never overwritten by the other) | unit, browser |
| Prompt-injection resistance | `prompt.test.ts` › hostile speech, hostile names; `institutions.test.ts` (hostile role names); `core/text.test.ts` | unit. **Against strings, not against a model** |
| Malicious proposals | `institutions.test.ts`, `wire.test.ts`, `core/bounded.test.ts` (oversized, deep, unknown-keyed, resource-creating, privilege-escalating) | unit, fuzz |
| Stale state and races | `ledger.test.ts` on PostgreSQL (100 concurrent holds, 100 copies of one request, interleaved operations from two instances), `runs.test.ts` (two instances stepping one run; a stale lease) | concurrency |
| Budget bypass | `ledger.test.ts`, `api.test.ts` (the ceiling; nothing spent until authorized, released and approved), `smoke.test.ts`; `pnpm load` | unit, load |
| Auth and CSRF | `auth.test.ts`, `api.test.ts` › "no request without the owner's session, origin and token changes anything or reaches a provider"; `owner.spec.ts` against the real server | unit, browser |
| Denial of service | rate limits (`auth.test.ts`, `api.test.ts`), body limits, payload bounds, the import size limit and field checks (`save/validate.test.ts`), the fuel-limited interpreter (`institutions.test.ts`) | unit, fuzz |
| Dependency and secret scanning | `pnpm audit`; `pnpm scan:secrets`, `pnpm scan:history`, `pnpm scan:bundle`, and `tests/unit/scans.test.ts`, which makes each scan fail on a planted leak | scans, tests of the scans |
| Chaos on the provider and the database | `anthropic.test.ts` (malformed and partial answers, missing usage, error pages, disconnects, timeouts — all canned), `runs.test.ts` (calls cut off in flight, records that cannot be written, steps that run out of time), `api.test.ts` › "fails closed when the database cannot be reached", `db.test.ts` (connections dropped at the opening and after it, statements and locks past their limits, a transaction left idle) | fault injection |
| The client bundle: secrets, source maps, environment | `pnpm scan:bundle` over everything under `.next/static` and every prerendered page: 13 server-only markers, 4 credential shapes, live values of secret variables. The build emits one source map: 53 bytes, with no sources in it | scan |
| Real browser flows, desktop and phone emulation, with screenshots | `pnpm e2e`: eight specification files on two projects; captures under `evidence/` | browser |
| Keyboard access | `play.spec.ts` › "the keyboard alone can drive the game…" | browser |
| Mutation of core invariants | the seeded run below | mutation |

## Seeded mutation run

`pnpm mutants` (`scripts/mutants.ts`) breaks one invariant at a time in a copy of the source — the kill switch
no longer stops a hold, a settlement can be applied twice, a speaker may tell of what they have never seen, a
recording's digest is no longer compared — and runs the tests that should notice. It is a chosen list, one
mutant for each invariant the project's claims rest on, not a tool that generates mutants: it shows that
these tests can fail for the right reason, and nothing about invariants that are not on the list.

**20 of 20 killed** (`evidence/phase-16/mutants.{txt,json}`). The first run killed 18 and let two through
(`mutants-first-run.txt`), which is what such a run is for:

- *A hearer learns of an agreement only from someone who knows of it.* The gate at **speaking** already
  refuses such words, so nothing ever reached the gate at **hearing**, and removing it broke no test. A test
  now writes the words straight into the world's speech, as a saved world could carry them, and the hearer
  must learn nothing.
- *A failed route search is remembered only while what the agent has seen is unchanged.* No agent in the
  engine ever forgets, and with knowledge that only grows a failed search can never become a successful one
  from the same tile — so ignoring what was seen changed no answer any test asked for. The test now also
  makes the agent forget, which is the only way to tell.

| The invariant | With it broken, the tests… | First run |
|---|---|---|
| With the kill switch on, nothing new is held | fail (4 tests) | killed |
| What is held, settled and overcharged never exceeds what was authorized | fail (6 tests) | killed |
| Nothing above the deployment's ceiling can be authorized | fail (2 tests) | killed |
| A settlement is applied once, however many times it arrives | fail (2 tests) | killed |
| A write without the session's own token changes nothing | fail (3 tests) | killed |
| A write from another site is refused | fail (5 tests) | killed |
| Signing out ends every session | fail (1 test) | killed |
| Guessing the passphrase is slowed | fail (3 tests) | killed |
| A failure that is not in the provider's own format is never taken as unbilled | fail (2 tests) | killed |
| One stepper at a time holds a run | fail (1 test) | killed |
| Nothing is made from nothing: what is gathered leaves the place it was gathered from, unit for unit | fail (7 tests) | killed |
| A speaker can tell only of what they know | fail (2 tests) | killed |
| A hearer learns of an agreement only from someone who knows of it | fail (1 test) | **survived** |
| The name of a role cannot be a sentence | fail (2 tests) | killed |
| Only a member can put a motion to an agreement | fail (1 test) | killed |
| What a mind attaches to an intent is bounded in depth | fail (1 test) | killed |
| An opened world whose numbers are out of range is refused | fail (1 test) | killed |
| A recording that this engine does not reproduce is not accepted as reproduced | fail (4 tests) | killed |
| A failed route search is remembered only while what the agent has seen is unchanged | fail (1 test) | **survived** |
| The same seed and the same decisions make the same world (the golden recording) | fail (1 test) | killed |

## The citizens' language

No model has spoken in this application, so there is no instance to review; what follows is by design.

- **Baseline minds do not write prose.** What they say is one of a fixed set of speech acts (telling of a
  place, offering, promising, announcing an agreement), which the interface puts into words from templates.
  An agreement found by their search is named "Compact of" and its proposer's invented name; the designers'
  control charter is "Hearth and larder" or "Common larder".
- **A model-driven mind may add up to 160 characters of its own** to something it says, and may name an
  agreement, its purpose and its roles. All of it is cleaned, bounded, stored as that citizen's words and
  shown in quotation marks; the engine never acts on it, and no mind has any tool outside the world.
- **Citizens' names** are assembled from neutral syllables; nobody real is named by the engine.
- **There is no filter on what a model's own words may say.** A model could write the name of a real person
  or a political slogan into its 160 characters, and the Chronicle would show it as that citizen's words. A
  recording is published only by the owner's act; reading a run's speech before publishing it is the control,
  and it is a human one. This is a risk for phase 17 to look at with real output, not something tested here.

## Provenance, third parties and telemetry

- **Code.** Everything under `src/`, `scripts/`, `tests/` and `db/` was written in this repository. The
  hashing, random-number mixing and route-finding are implementations of published, standard algorithms
  (SHA-256, a MurmurHash3-style mix, A*), written here. No source file was copied from another project.
- **Art and sound.** Procedural: geometry, shaders and synthesis in code. No image, model or audio file is
  bundled. Two typefaces are bundled, under the SIL Open Font License, whose text is served at `/licenses.txt`.
- **Dependencies.** Twelve direct, 91 in production with what they bring; all listed by licence in
  `docs/THIRD_PARTY.md`, generated from the lockfile and checked in CI.
- **Services contacted at run time.** By the game: none (`connect-src 'self'`; a browser test asserts that no
  request goes to another origin). By the server, only with live mode on: the provider, at one address. A
  PostgreSQL database of the owner's.
- **Telemetry.** The application has none: no analytics, no error reporting, no trackers. Two things in the
  toolchain do, and both are off here: the provider's SDK enables OpenTelemetry tracing by default (disabled
  in `src/server/anthropic.ts`), and the framework's command-line tool reports anonymous usage unless
  `NEXT_TELEMETRY_DISABLED=1` is set, as it is in CI and in the test configuration. The owner should set it
  for their own builds too.

## Claims of emergence, and selection

- **No claim of emergence is made anywhere in the product or the documents.** The ladder of evidence is
  defined in the protocol (§ 5); a scripted charter is labelled as scripted wherever it appears; agreements
  found by the baseline's search are labelled as found by search, not by a language model; the one bundled
  recording is labelled MOCK wherever it appears.
- **What the confirmatory batch licenses is small, and said to be** (protocol § 11): the positive control
  failed, so nothing shows that agreements help.
- **Selection that did happen, stated.** The stills in `evidence/phase-11/` and the art bible were taken on
  development seeds chosen because they looked good and showed the thing being discussed: they are evidence
  of what the renderer draws, not of what worlds typically do. The charter still is of the *scripted* control
  charter. The numbers quoted from development seeds (baseline comparisons, Two Shores, the civics script)
  are labelled as development observations and were not used for any registered claim.
- **Selection that did not.** The confirmatory seeds were fixed before the batch (the first 32 of the holdout
  range), every run is in the bundle, missing cells would be listed (there are none), and the batch was run
  once.

## Acceptance tests and changed assertions

The tests for each fix were written from the finding — what must be refused, what must still work — before the
fix was judged done, and the suites were then run whole. No assertion was changed to make a failing check
pass. These assertions were changed because the behaviour they describe was changed on purpose:

| Test | Was | Is | Why |
|---|---|---|---|
| `ledger.test.ts`, settling after a release | answers `already` | answers `late`, records overage, turns the switch on | L6 |
| `anthropic.test.ts`, the table of failures | a 5xx is `rejected` | `rejected` only with the provider's error format and a request id | M6 |
| `auth.test.ts`, the stored hash | scrypt N = 2^15 | N = 2^17 for new hashes; a test keeps old hashes opening | L11 |
| `api.test.ts`, sign-in | one cookie | two: the session, and a device token that signs nobody in | M3 |
| `tests/unit/scans.test.ts` | a line marked `scan:allow` is skipped | no marker excuses a line | L15 |
| `tests/unit/scans.test.ts` | the migration list is a constant | it is the directory's listing | a second migration exists |
| `runs.test.ts`, `prompt.test.ts` | prompt version `p1` | `p2` | the rules text changed (D-040) |
| `cognition.test.ts`, telling of a bush | any speaker | a speaker who knows the bush | M7 |
| `history.spec.ts`, opening a file | one toast | "The file is whole…", and provenance `opened` then `relived` | D-043 |
| `play.spec.ts` and others, a world has loaded | the world label is visible | the world label names the world | D-045: the label is a word the bar may give up |

## What was run

On the working tree of this commit, 2026-11-25, Node 22.23.5, PostgreSQL 16:

- `pnpm check`: exit 0. Lint clean; types clean; **470 tests in 37 files pass**, the ten that need a real
  PostgreSQL among them; the four generated files are current; no credential in 421 files or in any of the
  152,854 lines any commit has added; the build succeeds; nothing server-only in 157 client-facing files
  (`evidence/phase-16/tests.txt`, `scans.txt`).
- The server suites again with the database behind a transaction pooler: 107 of 107
  (`evidence/phase-16/pooler.txt`).
- The seeded mutation run: 20 of 20 killed (`evidence/phase-16/mutants.txt`).
- Browser tests, run spec by spec while the fixes were made — the whole loop on the phone project, the
  keyboard on desktop, accessibility and target sizes on the phone project, both resilience tests, the owner's
  console on both projects (through the pooler). **The whole suite in one run, in a clean checkout**
  of `de2f0e1`, with nothing else on the machine: `pnpm check` exits 0 with 491 tests in 40 files; `pnpm e2e`
  ends with 28 passed, 5 skipped by design and one timed out, in 39.7 minutes. The one is the renderer-fallback
  test, which ran out of a 300-second limit with nothing it asserts having failed; its limit is now ten minutes
  and it passes on its own in 4.5. The same commit's whole suite passed on GitHub's runners, both projects
  (`evidence/phase-20/tests.txt`, `e2e-run.txt`, `e2e-fallback-rerun.txt`, `ci.txt`). An earlier whole-suite
  run, at `36ff011`, is how the stale laboratory test was found. That run was stopped part-way and is not
  evidence of anything else: one more test failed in it because the developer started another browser run
  beside it, and every browser run begins by dropping the test server's schema. The test in question (signing
  out) passes in the run above and in CI.
- The registered studies: 48 cells of the confirmatory batch and 24 of the pilot re-run and matched to the hash
  (`evidence/phase-16/*/verify.txt`).

## Not run

Stated so that nothing above is read as more than it is.

- **No person has played, tested or attacked this application.** No human playtest; no usability session.
- **No physical device.** Phone results are Chromium's emulation of a 390 × 844 screen with touch.
- **No graphics chip.** Every frame-time number is from a software rasterizer and says nothing about a real
  phone or laptop (`docs/PERFORMANCE.md`).
- **No screen reader.** Accessibility was checked by axe, by measured target sizes and by the keyboard test.
- **No browser but Chromium.** Firefox and Safari have not run it.
- **No sound heard.** The soundscape is checked by its signal level, not by an ear.
- **No request to the Anthropic API, ever.** $0 spent; no key has been present. The live adapter, the smoke
  script's paid path and the cost of a real call are unmeasured.
- **No deployment of the console.** Since 2026-11-26 the game alone runs on Vercel and passes the release check
  there (`docs/DEPLOYMENT.md`); nothing has run against a hosted database.

## Remaining risks, in order

1. **The live path is untested against reality.** Everything about it is by construction and by canned
   responses. The first authorized smoke test is where its assumptions meet the service.
2. **One origin** for the game and the money console (`SECURITY.md`). Bounded by the ceiling; closed only by a
   separate host.
3. **A stolen session** can spend up to the ceiling. There is no second factor.
4. **Models were not adversaries here.** Quoting, cleaning and bounding in-world text is tested against
   strings, not against a model that is being persuaded.
5. **Performance on real devices is unknown.** The fallbacks (lower resolution, then a simpler preset) are
   tested for their logic, not for whether they suffice on a given phone.
6. **The positive control failed** (D-044). The laboratory works; what it has shown so far does not include
   that agreements help anyone in this world.
