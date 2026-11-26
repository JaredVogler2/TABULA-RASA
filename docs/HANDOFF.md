# Handoff

Written 2026-11-25, at the end of phase 20. This is the one document to read if you read one: what exists,
what does not, what it would take to finish, and how to do each thing that is yours to do. Everything it says
is backed elsewhere, and says where.

## What you have

A browser game and a laboratory, built from the prompts in `prompts/` in one session. **The game is live at
https://tabula-rasa-bay.vercel.app.**

- **The game** (`/`). A deterministic simulated island with fifty citizens who gather, build, speak, promise,
  trade and — within a grammar the designers supplied and nothing more — propose and sign agreements that the
  engine then enforces. You watch, inspect anyone, read what the engine logged and why, change the weather or
  the abundance (never a mind), and compare your world with an untouched twin that shares its luck. Five
  scenarios; each states one aim, and the Atlas now says how it stands in your world and in the twin. Saves,
  world files, a history you can return to, and a bundled recording that replays to the bit. It needs no
  account, no key, no database and no network after the page has loaded.
- **The laboratory** (`/lab`). Six registered studies run as paired experiments on the engine's baseline
  minds: a pilot on development seeds and one confirmatory batch on holdout seeds, published as it came out —
  including the failed positive control. Any cell can be re-run in your own browser and compared to its hash.
- **The owner's console** (`/owner`), for runs in which a language model decides for citizens: a budget ledger
  on PostgreSQL that reserves before every call and fails closed, a ceiling the passphrase cannot raise, a kill
  switch, and recordings anyone can replay at no cost. **It has never made a call.**

## What you do not have

Said first, because the rest should be read in its light.

| | State | What it waits for |
|---|---|---|
| A live call to Claude | **never made; $0 spent** | your authorization (below) |
| The owner's console and live minds on the web | **not deployed**: the game alone is, at https://tabula-rasa-bay.vercel.app | a database (a billable integration, yours to approve), then phase 17 |
| A person who has played it | none but you, briefly: on 2026-11-26 you opened it on your phone and reported two defects, both fixed (D-052) | a playtest |
| A real device | yours, for those few minutes; none here: no phone, no graphics chip | a look on your own hardware, again |
| A screen reader, Firefox | not tried | — |
| Safari | not installed here, so nothing was tested in it. The nearest it has come is the browser on your phone, whichever that is: the two reports above | — |
| Evidence that agreements help the citizens | **the registered positive control failed** (D-044) | a redesigned control, registered anew |
| A licence | `package.json` says `UNLICENSED` | your decision |

## Status of every phase

`docs/PROGRESS.md` has a paragraph for each. PASS means its gate was proven by checks that were run and whose
output is in `evidence/`.

| Phase | | Status | The one thing to know |
|---|---|---|---|
| 01 | Product and science | PASS | hypotheses registered before any batch |
| 02 | Architecture | PASS | engine purity and server isolation enforced by lint |
| 03 | World engine | PASS | deterministic by construction; same digests in Node, page and worker |
| 04 | Playable slice | PASS | |
| 05 | Agent cognition | PASS | baseline minds are hand-written and say so everywhere |
| 06 | Claude API adapter | PASS | against canned responses only |
| 07 | Budget and security | PASS | reviewed adversarially in phase 16 |
| 08 | Orchestration | PARTIAL | one item needs a model |
| 09 | Institution grammar | PASS | |
| 10 | Economy and society | PASS | |
| 11 | Art direction | PARTIAL | judged from stills under a software renderer |
| 12 | Observer UX | PARTIAL | no person, no device |
| 13 | History and causality | PARTIAL | no live recording exists to compare with |
| 14 | Experiment lab | PASS | |
| 15 | Scale and performance | PARTIAL | frame rate on real hardware not measurable here |
| 16 | Adversarial QA | PASS | two independent reviews; every finding fixed or accepted |
| 17 | Live pilot | **BLOCKED** | needs your authorization to spend |
| 18 | Vercel release | PASS (the game alone) | https://tabula-rasa-bay.vercel.app, made by your import; 25 of 25 release checks; the console and live minds are not deployed |
| 19 | Scorecard | PASS | a self-assessment: 68 of 100, no veto triggered, two incidents disclosed |
| 20 | Redesign and handoff | PASS | this document; two improvements made, three recorded |

## The release, looked at against the promise

Phase 20 asks five questions. The build was "played" by the browser tests and looked at in stills by the agent
that made it; **not by a person**, and at two or three frames a second. The answers are bounded by that.
(After this was written you opened the deployed game on your phone and reported two things within minutes: a
list whose words crowded off the screen, and a Follow that did not appear to follow. Both were real, both had
passed every test here, and both are fixed — D-052. That is all a person and a device have yet contributed.
It answers none of the five questions; it does measure what the stills and the tests were missing.)

1. **Is it fun to watch?** Not known. What there is to watch is there — people at work, weather, day and
   night, fires at dusk, paths wearing in, a follow camera, six speeds — and none of it has been seen moving
   as a player would see it. This is the first thing a playtest should answer.
2. **Surprising, yet causally legible?** Legible: the Chronicle's lines come with the causes the engine
   recorded, the inspector shows what a citizen set out to do and what came of it, and Compare counts the two
   worlds side by side. Surprising: worlds differ a great deal (in Thin Commons, between 5 and 50 of 50 alive
   after a year on ten seeds), agreements arise in most worlds without being asked for, and the experiment
   surprised its designer — the control meant to show that agreements help did not.
3. **Does it look premium?** In stills, within the limits of what was drawn here: a consistent palette and
   type, a diorama with depth, paper sheets over forest glass (`docs/ART_BIBLE.md`). On a real screen: unseen.
4. **Can the rules be learned?** There is a five-step first run, a page listing every affordance the designers
   supplied, charters written out as sentences generated from their rules, and a journal of things witnessed.
   Whether a newcomer learns from them is a playtest question.
5. **Are institutions generated and ratified, not scripted?** With the baseline minds: charters are composed
   by a labelled search over the grammar and judged by a fixed rule, then signed or not by citizens following
   their own planner. That is generated and ratified, and it is not invention by a mind. The one scripted
   charter is marked "Scripted control · not emergence" wherever it appears. With model-driven minds — the
   case the project is named for — **nothing is known, because none has run.**

### The five things most worth doing, and which were done

| | What | State |
|---|---|---|
| 1 | **Say how the scenario's aim turned out.** Each card stated an aim and nothing ever reported it; an observer changed a world and got two columns of numbers. | **Done** (D-049). The Atlas counts it, for the world and its untouched twin; a notice on the morning it is decided. Two aims that could not be met in any world measured were reworded to ones that can go either way |
| 2 | **Make the Chronicle readable at a glance.** A spring morning logged six identical "A root patch began to recover." lines and pushed everything else off the page. | **Done.** The same sentence at the same hour is one line with a count, and opens out again; nothing is dropped |
| 3 | **Run a model.** A smoke test, then a small pilot: the project's central claim has no evidence either way. | Blocked on your authorization |
| 4 | **Put it in front of a person and a device.** | Cannot be done from here. Begun by you: a few minutes on your phone found two defects (D-052). A playtest and a pass over devices are still to do |
| 5 | **Repair what the experiment and the long benchmark found:** a positive control that does not hold (D-044), and baseline planners that ask for the unreachable in a crowded famine (D-046). | Recorded, not done: both change behaviour, which means a new engine version and a new registration on new seeds |

Also noted and not done: a per-shore reading in Compare; a resources overlay; a view of everyone's ties at
once; a separate host for the console.

## What is yours to do

### Play it

```bash
pnpm install
```

```bash
pnpm dev
```

Then http://localhost:3000. Nothing else is needed. No subscription, key or database is required to play.

### Deploy it

**It is deployed: https://tabula-rasa-bay.vercel.app** — the game alone, since 2026-11-26, from your import of the
repository in Vercel (the assistant's own attempt was refused: its connector may read your projects, not
create one). It needs no variable and costs nothing on Vercel's Hobby plan, whose terms are "personal or
non-commercial use". A merge to `main` now deploys itself. [`DEPLOYMENT.md`](./DEPLOYMENT.md) has the rest:
what was checked, how to undo it, and what the console would need. After any deployment that changes the
product:

```bash
pnpm release:check -- https://tabula-rasa-bay.vercel.app
```

### Keep a key safe

The key lives in the deployment's server environment as `ANTHROPIC_API_KEY`, set as a Secret for Production
only. It is never in the repository, never in a variable beginning `NEXT_PUBLIC_`, never in a chat, never in a
log (the scans in `pnpm check` fail the build if one appears anywhere, in any commit). Give the project its own
workspace at the provider with a spend limit and no auto-reload: that limit holds whatever this application
does (`COST.md` § Limits of the in-app cap).

### Turn on a little live mode

Four separate acts, none of which the application can do for itself (`COST.md`):

1. Configure the deployment: the key, an exact `ANTHROPIC_MODEL` (there is no default), a database,
   `pnpm owner:hash` for sign-in, `LIVE_ENABLED=true`, and `BUDGET_CEILING_USD` — the most it may ever spend.
2. In the console, authorize an amount at most the ceiling, in words.
3. Release the kill switch.
4. Approve a run with its own cap, after reading its upper bound.

Start with the smoke test, which is the first paid request this project will ever make: three decisions,
at most $2. Run it without arguments first; it spends nothing and prints the exact words the next step needs:

```bash
pnpm live:smoke
```

What a call can cost at most, per model, is in `COST.md`: on the dearest model a decision holds about $0.32
before it is sent and gives back what it did not use. That is a bound, not an estimate; nobody knows the real
figure until a call is made.

### Hold the budget

The ceiling is in the environment. The authorized amount, the daily cap and the kill switch are in the
console. Every call is reserved before it is sent and settled from the provider's own usage report; a call
whose outcome is unknown stays held until you decide. If a charge ever exceeds its hold the switch turns
itself on.

### Turn paid things off

In order of how fast and how sure: **revoke the key at the provider** (holds whatever state anything is in);
the kill switch in the console; remove `LIVE_ENABLED` and redeploy. Signing out ends every session.

### Run and read a study

```bash
pnpm study -- --study all --seeds 1-16 --out /tmp/pilot
```

```bash
pnpm study -- --analyse --study all --seeds 1-16 --out /tmp/pilot
```

Development seeds only: the runner refuses holdout seeds unless given a registered plan, and seeds 9000–9031
are spent. `/lab` shows the published bundles; `public/studies/*/manifest.json` are their manifests (engine,
seeds, configuration, every cell's hash); `docs/EXPERIMENT_PROTOCOL.md` is what was registered and §11 is what
came out.

### Replay and compare worlds

In the game: History returns to any stored morning, re-runs a stretch exactly and checks it arrived where it
left, or leaves from there on a new line; Compare sets your world against its twin; the title screen plays
recordings. From a terminal:

```bash
pnpm sim -- --scenario first_light --seed 1 --days 40 --policy planner --replay
```

## Next steps, and what each could cost

| Step | Cost | Risk |
|---|---|---|
| ~~Deploy the game alone~~ **done** | $0 | a flood of visitors pauses a Hobby project; it does not bill |
| Add the console (a database) | $0 on a free plan; a billable integration | the first hosted database is the first real test of D-047 |
| Smoke test | at most $2 | the first meeting of the adapter with the real service: expect to learn something |
| A pilot of a few people consulted often | $10, separately authorized | cost per decision is unmeasured; the bound is several times what is expected |
| A society of fifty for six days | $49–57 at the bound on the dearest model, $0.61–0.71 on the cheapest | most of the stated $200 on one run if the dearest model is used |
| A registered contrast with model minds | beyond $200 on every model but the cheapest | do not start one without sizing it (`/lab` has the table) |
| A playtest, a device pass | your time | — |

## Where everything is

- **Start again from here:** [`CONTINUE_HERE.md`](./CONTINUE_HERE.md) — the commit, the commands, what each proves.
- **What was decided and why:** [`DECISIONS.md`](./DECISIONS.md), 51 entries.
- **What was claimed and what backs it:** [`EVIDENCE.md`](./EVIDENCE.md); raw outputs in `evidence/`.
- **What was found wrong:** [`QA_REPORT.md`](./QA_REPORT.md).
- **How good it is, by its builder's account:** [`SCORECARD.md`](./SCORECARD.md).
- **Changes, release by release:** [`../CHANGELOG.md`](../CHANGELOG.md).
- **Stills:** `evidence/phase-20/` for the release; earlier phases beside them. No film was made: the only
  renderer here draws two or three frames a second, and a film of that would misrepresent the game. The
  bundled recording on the title screen is a replayable run of the real thing.
- **Source:** `src/engine` (the simulation, pure), `src/providers` (minds outside it), `src/server` (ledger,
  gate, adapter), `src/worker` (owns the world), `src/render` (three.js), `src/ui` (React), `src/lab`.

## Known limitations

Everything under "What you do not have", and: one origin for the game and the console (`SECURITY.md`); a
price table that goes stale after 45 days by design; saves that live only in the browser that made them; a
server-side run limited to 120 people; no localization; sound synthesized and unheard; the laboratory's
studies are of hand-written baseline minds and say nothing about people or about language models.
