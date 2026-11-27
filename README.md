# TABULA RASA — Civilization Without Instructions

**A living world. Fifty independent minds. No civilization blueprint.**

**Play it: https://tabula-rasa-bay.vercel.app** — the offline game, with the engine's own baseline minds. No account, no key, nothing to install.

An original, visually exceptional browser simulation/game and experimental laboratory in which autonomous agents discover how to survive, cooperate, specialize and invent institutions within a bounded virtual world. The player observes, investigates, intervenes and forks history. The actual consequences come from executable simulation rules, not an LLM's narrative claims.

**Status:** built from the prompt program in [`prompts/`](prompts/) through phase 20. Start with [`docs/HANDOFF.md`](docs/HANDOFF.md): what exists, what does not, and what is the owner's to do. In the product: the offline game — since 2026-11-27 with a default scenario, The Long Road, in which a people can grow, learn crafts and build, and the player has a goal that takes skill (engine 0.8.0; [`docs/HANDOFF.md`](docs/HANDOFF.md) § Since this was written) — with six scenarios whose aims are counted against an untouched twin, the baseline minds, institutions, history, the laboratory with its one confirmatory batch, the owner's console and the budget ledger. Two things are **blocked on the owner**: the live pilot (it needs an authorization to spend) and the owner's console on the web (it needs a database, which has not been asked for). **The game itself is deployed: https://tabula-rasa-bay.vercel.app** (since 2026-11-26; 25 of 25 release checks, `docs/DEPLOYMENT.md`). Honest, phase-by-phase status is in [`docs/PROGRESS.md`](docs/PROGRESS.md) and [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md); evidence for every claim in [`docs/EVIDENCE.md`](docs/EVIDENCE.md); what was attacked and what is left in [`docs/QA_REPORT.md`](docs/QA_REPORT.md). **No Anthropic API calls have been made and no credits have been spent.** The game alone is deployed; the console and live minds are not. The owner has played it and reported on it five times (`docs/PROGRESS.md`, Human interventions); no other person is known to have, and nobody has yet played what was built on 2026-11-27. Every mind in the product today is a hand-written or search-based baseline, labelled as such.

## Run it

```bash
pnpm install
pnpm dev        # http://localhost:3000 — needs no keys, no database, no network
pnpm check      # lint, typecheck, unit/property/fuzz tests, generated-file checks, secret scans, build, bundle scan
pnpm e2e        # Playwright against the production build (run `pnpm build` first)
```

More commands, and what each proves, are in [`docs/CONTINUE_HERE.md`](docs/CONTINUE_HERE.md). Live model calls are off and cannot be turned on by accident; what it takes is in [`docs/COST.md`](docs/COST.md).

Key documents: [handoff](docs/HANDOFF.md) · [deployment](docs/DEPLOYMENT.md) · [changelog](CHANGELOG.md) · [scorecard](docs/SCORECARD.md) · [charter](docs/CHARTER.md) · [experiment protocol (pre-registered, with its results)](docs/EXPERIMENT_PROTOCOL.md) · [model description](docs/ODD.md) · [affordance registry](docs/AFFORDANCES.md) · [architecture](docs/ARCHITECTURE.md) · [decisions](docs/DECISIONS.md) · [security](docs/SECURITY.md) · [cost](docs/COST.md) · [performance](docs/PERFORMANCE.md) · [QA report](docs/QA_REPORT.md) · [third-party licences](docs/THIRD_PARTY.md) · [resume instructions](docs/CONTINUE_HERE.md).

## Start in Claude Code (Fable 5.2)

Open this repository with the requested Fable 5.2 model selected, read [CLAUDE.md](CLAUDE.md), [prompts/README.md](prompts/README.md) and [prompts/00-MASTER.md](prompts/00-MASTER.md). Then use the following as the session goal (use /goal only if supported in your installed Claude Code):

> Read CLAUDE.md and prompts/00-MASTER.md, follow the ordered phases in prompts/README.md, and implement TABULA RASA as a real, premium browser game and reproducible AI society laboratory. Build and test a complete playable vertical slice early; expand progressively. Exercise your own judgment and improve the proposed design under the change protocol, without weakening experimental integrity, security, budget controls, or visual quality. Work autonomously, run checks, record evidence and commit passing milestones. Use mock/replay providers until the owner explicitly enables bounded live API spending. Deploy to Vercel only when authorized and verified; do not claim success without evidence.

## Product contract

- Beautiful, responsive, genuinely interactive 3D world; citizens physically perform validated actions.
- Start with roughly 50 distinct agents, ecological constraints, needs and generic affordances; no hardcoded government, money, occupations, religion, class, or preordained stages in the blank-slate treatment.
- Institutions can arise through explicit proposals, adoption, executable bounded rules and consequences; distinguish affordances supplied by designers from genuine emergent outcomes.
- Offline deterministic baseline, recorded live-model decisions, replayable histories, branch comparison and rigorous control experiments.
- Fable 5.2 preferred for live runtime decisions if available on the owner's Anthropic API account. Model ID and prices verified against official documentation; no silent paid substitutes.
- Server-side key and owner-only live mode, persistent budget ledger, default live spending disabled; $200 total stated credit envelope, not automatic spending authorization.
- Vercel deployment; no indefinitely running request or browser-held secret.

See [prompts/README.md](prompts/README.md) for the build sequence, and [prompts/01-PRODUCT-AND-SCIENCE.md](prompts/01-PRODUCT-AND-SCIENCE.md) for the experiment charter. Never commit API keys or real personal/company data.
