# Changelog

What changed, pull request by pull request. Dates are UTC. Versions named here are the engine's
(`src/engine/version.ts`): a world saved under one engine version is not continued under another. Why each
thing was done is in [`docs/DECISIONS.md`](docs/DECISIONS.md); what backs each claim is in
[`docs/EVIDENCE.md`](docs/EVIDENCE.md).

## Pull request 3 — phases 15–20 (2026-11-25, open)

Engine 0.7.0, frozen. Snapshot schema 6. Affordances 2026.11-i. Prompt p2.

**For someone playing**
- The aim on each scenario's card is counted. The Atlas says where it stands — open, met or lost on a named
  day — for your world and for its untouched twin, and there is a notice on the morning it is decided. Two
  aims that could not be met in any world measured were reworded: The Long Winter now asks for three in five
  by spring, Thin Commons for four in five through the year (D-049).
- The Chronicle gathers the same sentence at the same hour into one line with a count; it opens out again.
- A notice you have to be told is no longer replaced within a moment by a line of journal news.
- On a phone every pressable thing is at least 44 × 44 px, the six speeds have a row of their own, and the
  first-steps card no longer sits over the inspector.
- The top bar fits itself to whatever it has to show, at any width (D-045).
- The fastest speed is the speed it says: the simulation no longer drops ticks it owes.
- One tab keeps the autosave; a hidden tab stops time and saves; a renderer that cannot keep up simplifies
  its picture and says so.
- Two Shores has two unequal shores, as its card always said (D-041).
- A world file that is opened is checked field by field, tried, and labelled for what it is (D-043).
- The keyboard alone drives the whole game.

**For the laboratory**
- The confirmatory batch was run, once, on holdout seeds 9000–9031: 448 runs, published as it came out.
  H1, H2, H3 and the first clause of H5 supported; H4 falsified by a ceiling; **H6a, the positive control,
  falsified** (D-044). The laboratory opens on it; the pilot that sized it is one choice away.

**For the owner**
- A spending ceiling that lives in the deployment's configuration and that the passphrase cannot raise; a
  live smoke test that is a numbered, unreplayable script; sign-in that strangers cannot lock; sign-out that
  ends every session; recovery of calls interrupted in flight (D-042).
- The database's time limits travel with each transaction, so the ledger works through a hosted database's
  connection pooler, and a lost connection fails one transaction instead of the process (D-047).
- `docs/DEPLOYMENT.md`, and `pnpm release:check -- <address>` to check a running site.
- `engines.node` is 22.x, the version every test ran on (D-048).

**Under the bonnet**
- Citizens can tell one another only what they know; role names are quoted labels; what a mind may attach is
  bounded (engine 0.7.0, D-040).
- An exact memory of failed route searches: 250 people run at 240–278 ticks a second where they ran at 41,
  with identical state hashes (D-046).
- Two independent reviews, every finding fixed or accepted (`docs/QA_REPORT.md`); scans of every line any
  commit has added; a lint rule against turning strings into markup or code; a seeded mutation run; a licence
  manifest.

**Not in it:** any call to a model; any deployment; a person or a device.

## Pull request 2 — phases 06–08 and 11–14 (2026-11-25, merged)

- Minds outside the engine: one observation and one answer format for every external mind, a mock provider, a
  recording format anyone can replay at no cost, three schedulers for rationing deliberation (D-016, D-019,
  D-023).
- The Claude adapter and the budget ledger: every call reserved before it is sent, bounded by bytes, settled
  from the provider's own usage report; unknown outcomes stay held (D-020, D-021). The owner's console, with
  spending authorized in words (D-025). Server runs that step, lease and resume (D-026).
- A second art pass; synthesized sound that is silent until asked for (D-028); what a citizen knows drawn by
  washing out what they have not seen (D-029); the field journal (D-030); agreements marked in the world once
  ratified (D-031).
- History as moments and lines: return to a stored morning, re-run it exactly, or leave on a new line; a
  loaded world's past is trusted only if re-living it arrives where it left (D-033). The untouched twin can be
  looked at (D-034).
- The laboratory: paired seeds, intervals before tests, a runner that will not touch holdout seeds by
  accident; the pilot on development seeds (D-036, D-037).

## Pull request 1 — phases 01–05, 09, 10 (2026-11-25, merged)

- Charter, pre-registered experiment protocol, affordance registry, five scenarios.
- A deterministic engine: keyed randomness, integer state, restricted arithmetic (D-003); terrain, seasons and
  weather; needs, illness and death; twenty physical actions validated and arbitrated; knowledge-limited
  pathfinding; perception and belief.
- The playable slice: a 3D diorama, six speeds, an inspector, the Chronicle with recorded causes, eight
  interventions that fork an untouched twin (D-012), Compare, saves.
- Agent cognition and a bounded-rational planner baseline (D-015); the reference ecology (D-014).
- An institution grammar in which rules are proposed, ratified and executed by an interpreter, a labelled
  grammar search, and an honest positive control (D-006, D-017, D-018).
- Society measures computed from the engine's own ledger; baseline exchange; the ODD model description.
