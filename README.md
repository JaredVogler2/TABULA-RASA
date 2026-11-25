# TABULA RASA — Civilization Without Instructions

**A living world. Fifty independent minds. No civilization blueprint.**

An original, visually exceptional browser simulation/game and experimental laboratory in which autonomous agents discover how to survive, cooperate, specialize and invent institutions within a bounded virtual world. The player observes, investigates, intervenes and forks history. The actual consequences come from executable simulation rules, not an LLM's narrative claims.

**Status:** under active construction from the prompt program in [`prompts/`](prompts/). Honest, phase-by-phase status lives in [`docs/PROGRESS.md`](docs/PROGRESS.md) and [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md); evidence for every claim is in [`docs/EVIDENCE.md`](docs/EVIDENCE.md). **No Anthropic API calls have been made and no credits have been spent.**

## Run it

```bash
pnpm install
pnpm dev        # http://localhost:3000 — needs no keys, no database, no network
pnpm check      # lint + typecheck + unit/property tests + build
pnpm e2e        # Playwright against the production build (run `pnpm build` first)
```

Key documents: [charter](docs/CHARTER.md) · [experiment protocol (pre-registered)](docs/EXPERIMENT_PROTOCOL.md) · [affordance registry](docs/AFFORDANCES.md) · [architecture](docs/ARCHITECTURE.md) · [decisions](docs/DECISIONS.md) · [security](docs/SECURITY.md) · [cost](docs/COST.md) · [resume instructions](docs/CONTINUE_HERE.md).

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
