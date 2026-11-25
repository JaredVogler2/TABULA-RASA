# Cost sheet

Status: baseline (phase 02, 2026-11-25). Prices and limits are filled in from verified sources in phase 06
(`docs/research/anthropic-api.md`) and phase 18 (`docs/research/vercel-platform.md`). Until then every number
below marked *planning* is an assumption, not a quote.

## Spend to date

| Item | Amount | Evidence |
|---|---|---|
| Anthropic API calls made by this project | **$0.00** (none made) | No key is configured in the development environment; live mode is disabled by default. |
| Billable infrastructure provisioned | **none** | — |

## The stated envelope is not an authorization

The owner mentioned **$200** of Anthropic credit; its actual balance, expiry and model eligibility are unverified.
The application's authorized budget defaults to **zero**. Nothing is spent until the owner, in the owner console
or CLI, (1) enables live mode, (2) sets a dollar ceiling for a specific run, and (3) confirms a preview that
shows the model, the price record and the worst-case cost.

Planning ceilings from the prompt program (S03) — *not approvals*:

| Stage | Ceiling | Requires |
|---|---|---|
| Smoke test (one schema-constrained decision, then a handful) | $2 | explicit authorization |
| Pilot (5–10 agents over a few epochs) | $10 | separate explicit authorization |
| Cognition / orchestration comparison | up to $48 | separate approval |
| Matched civilization experiments | up to $60 | separate approval |
| Replication / analysis | up to $40 | separate approval |
| Adversarial testing | $20 | separate approval |
| Contingency (never planned against) | $20 | — |

## How a worst-case cost is computed

For every dispatch the ledger reserves, **before** the request is sent:

```
reservation = ceil( maxInputTokens  × inputPrice
                  + maxOutputTokens × outputPrice      (thinking tokens are billed as output)
                  ) × (1 + priceMargin)
```

- No cache hits are assumed. If caching is enabled, cache-write pricing is used for the cacheable prefix.
- `maxInputTokens` is enforced server-side by bounding the observation; `maxOutputTokens` is the request's
  `max_tokens`.
- Retries are never free: each attempt has its own reservation.
- After the response, the reservation is settled to the provider-reported usage. Timeouts and dropped connections
  leave the reservation in place as `unknown` until reconciled by the owner.

## Infrastructure

| Component | Needed for | Cost status |
|---|---|---|
| Static hosting + functions | Public offline game, owner API | To be verified against current plan limits (phase 18). No deployment is made without authorization. |
| PostgreSQL | Live mode only (budget ledger, live-run state) | Not provisioned. Requires owner approval; free tiers to be verified. The public game needs no database. |
| Anything else (queues, auth services, analytics, asset CDNs) | — | **Not used.** |

## Limits of the in-app cap

The ledger caps what *this application* dispatches. It cannot see other uses of the same key. Recommended
provider-side guardrail: a dedicated workspace and key for TABULA RASA with its own spend limit (availability to
be confirmed in `docs/research/anthropic-api.md`).
