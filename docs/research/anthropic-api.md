# Anthropic Messages API — verified reference for budget-reserved structured "decision" calls

- **Research date:** 2026-11-25. Every live page cited below was fetched on 2026-11-25 between 02:45 and 02:55 UTC.
- **Scope:** first-party Claude API (`https://api.anthropic.com`) called from a TypeScript / Next.js server route handler through `@anthropic-ai/sdk`. Cloud-platform variants (Amazon Bedrock, Google Cloud, Microsoft Foundry, Claude Platform on AWS) are out of scope.
- **Method:** (1) read the bundled `claude-api` reference skill (a cached summary); (2) verified it against the live official docs by downloading the raw Markdown of each page (`https://platform.claude.com/docs/en/<page>.md`) with `curl`, plus the public pricing site, two Claude Help Center articles, the official TypeScript SDK repository and the npm registry entry. The docs MCP server that the skill recommends was not connected in this session, so `curl` was the fallback the skill prescribes.
- **Not done:** no Anthropic API call was made, no API key was looked for or read, nothing was measured. Token overheads and behaviors marked UNCONFIRMED need a paid, owner-authorized probe.
- **Evidence tags**
  - `[LIVE]` — read on the live official page on the research date.
  - `[SKILL]` — found only in the local reference skill (relative path given).
  - `[SDK-SRC]` — read in the official SDK source (GitHub `main`, package version 1.14.0) and spot-checked against the `@anthropic-ai/sdk@1.14.0` installed in this repository. Not stated in the docs.
  - `[NPM]` — npm registry metadata for `@anthropic-ai/sdk`.
  - `[HELP]` — Claude Help Center (support.claude.com), an official Anthropic site.
  - `[DERIVED]` — arithmetic or inference from tagged facts. Not a documented statement.
  - **UNCONFIRMED** — could not be confirmed on an official page.
- Source keys in square brackets (for example [pricing]) resolve to URLs in the [Source index](#source-index).

---

## A. Models: IDs, status, limits

| | Claude Fable 5.2 | Claude Opus 5.5 | Claude Sonnet 5.5 | Claude Haiku 5.5 |
| --- | --- | --- | --- | --- |
| API model ID (the alias is the same string) | `claude-fable-5-2` | `claude-opus-5-5` | `claude-sonnet-5-5` | `claude-haiku-5-5` |
| Status | Active (latest) | Active (latest) | Active (latest) | Active (latest) |
| Released | 2026-11-09 | 2026-09-22 | 2026-09-28 | 2026-10-07 |
| Retirement not sooner than | 2027-11-09 | 2027-09-22 | 2027-09-28 | 2027-10-07 |
| Context window | 1M tokens | 1M tokens | 1M tokens | 1M tokens |
| Max output, synchronous Messages API | 128K tokens | 128K tokens | 128K tokens | 128K tokens |
| Max output, Message Batches with beta `output-300k-2026-03-24` | no raised ceiling listed | 300K | 300K | 300K |
| Thinking | Adaptive, always on | Adaptive, always on | Adaptive, on by default | Adaptive, on by default |
| Default `output_config.effort` | `high` | `medium` | `high` | `medium` |
| Reliable knowledge cutoff | Jun 2026 | Jun 2026 | Jun 2026 | Jun 2026 |

All rows `[LIVE]`: [models], [fable], [opus], [sonnet], [haiku], [deprecations], [thinking] (output-limit table). The local reference (`skill file: shared/models.md`) gives the same IDs, context windows and output limits.

- **IDs are dateless pinned snapshots.** "Every Claude model ID is a pinned snapshot, including the dateless IDs used from the 4.6 generation on." Never append a date suffix. `[LIVE]` [models]
- **Thinking can be turned off on only some of these models** `[LIVE]` [thinking]:
  - Fable 5.2 and Opus 5.5: `thinking` of `enabled`, `disabled` or `between_tools` each return a 400. Thinking is always on.
  - Sonnet 5.5: `{"type": "between_tools"}` turns off up-front thinking at `high` effort or below. `disabled` returns a 400.
  - Haiku 5.5: `{"type": "disabled"}` turns thinking off at `high` effort or below. At `xhigh` or `max` it returns a 400.
  - With thinking off, output is the JSON alone, so `max_tokens` can be sized to the schema. With thinking on, it must also leave room for thinking, and the docs give no bound on thinking length other than `max_tokens` itself. `[DERIVED]`
- **Tokenizer.** Claude 4.7 and later models use a newer tokenizer that produces approximately 30% more tokens for the same text than earlier models. Count prompts with the model ID you will call. `[LIVE]` [pricing], [count]
- **Programmatic check.** `GET /v1/models/{id}` returns `max_input_tokens`, `max_tokens` and a `capabilities` object that includes `structured_outputs`. `[LIVE]` [models-api], [models]
- **Docs' own model guidance.** Start with Claude Opus 5.5 for most workloads. Use Claude Fable 5.2 "when your evals on Claude Opus 5.5 at higher effort still fall short". For "High-volume work with outputs you can check", the cost guide says "Try Claude Haiku 5.5 first". `[LIVE]` [models], [costopt]
- Claude Mythos 5.2 (`claude-mythos-5-2`) is the same model as Fable 5.2 with the same prices, limited to verified organizations. `[LIVE]` [fable]

---

## B. Pricing

USD per million tokens (MTok). All rows `[LIVE]` on [pricing]; base, cache and Haiku tier figures also match the public pricing site [pricing-site] and `skill file: shared/models.md`.

| Model | Base input | 5-minute cache write | 1-hour cache write | Cache read | Output | Batch input / output | Fast mode input / output |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Fable 5.2 | $8 | $10 | $16 | $0.20 (0.025x) | $40 | $4 / $20 | $16 / $80 |
| Claude Opus 5.5 | $4 | $5 | $8 | $0.20 (0.05x) | $20 | $2 / $10 | $8 / $40 |
| Claude Sonnet 5.5 | $2 | $2.50 | $4 | $0.10 (0.05x) | $10 | $1 / $5 | not offered |
| Claude Haiku 5.5, prompt up to 100,000 tokens | $0.10 | $0.125 | $0.20 | $0.01 (0.1x) | $0.50 | $0.05 / $0.25 | not offered |
| Claude Haiku 5.5, prompt over 100,000 tokens | $0.50 | $0.625 | $1 | $0.05 (0.1x) | $2.50 | $0.25 / $1.25 | not offered |

- **Cache multipliers.** 5-minute write 1.25x base input, 1-hour write 2x, read 0.1x on most models (exceptions in the table). "These multipliers stack with other pricing modifiers, including the Batch API discount and data residency." `[LIVE]` [pricing]
- **Batch API.** 50% discount "on both input and output tokens"; the batch FAQ adds "input tokens, output tokens, and any special tokens". It stacks with prompt-caching prices. `[LIVE]` [pricing], [batch]
- **Long-context premium.**
  - Fable 5.2, Opus 5.5 and Sonnet 5.5 bill the full 1M context at standard prices. "A 900k-token request is billed at the same per-token rate as a 9k-token request." `[LIVE]` [pricing]
  - Haiku 5.5 is the exception: a request whose prompt is over 100,000 tokens pays the higher rate card, input and output. "A request's prompt length counts all of its input tokens, including cache reads and cache writes." Each request is priced on its own, so a request over the threshold pays the higher prices even when part of its prompt is a cache hit. `[LIVE]` [pricing]
- **Data residency.** `inference_geo: "us"` multiplies every token category by 1.1x on Claude 4.6 and later models. The default is `"global"` at standard prices. If the request omits the field, "the workspace's `default_inference_geo` is used". `[LIVE]` [pricing], [messages]
- **Fast mode.** `speed: "fast"` on the request, no beta header for Fable 5.2 or Opus 5.5. Prices in the table. Cache and data-residency multipliers apply on top. Not available with the Batch API. Sonnet 5.5 and Haiku 5.5 are not in the supported list, and requesting it on an unsupported model returns an error. `[LIVE]` [pricing], [fast]
- **Thinking tokens are billed as output tokens.** Thinking has a cost: "the tokens Claude spends reasoning are billed as output tokens, even when the thinking text isn't returned to you, and they count toward `max_tokens` alongside the response text." The `display` setting changes what you see, not what you pay. `[LIVE]` [thinking], [steering]
- **Hidden input overheads** (billed as input, sizes mostly undocumented):
  - Structured outputs: "Claude automatically receives an additional system prompt explaining the expected output format." "Your input token count is slightly higher." "The injected prompt costs you tokens like any other system prompt." Size not documented. `[LIVE]` [so]
  - Thinking: "When thinking is active, the API automatically includes a specialized system prompt to support this feature." Size not documented. `[LIVE]` [steering]
  - Tools: when `tools` is non-empty the API adds a tool-use system prompt of 286 tokens on Opus 5.5, Sonnet 5.5 and Haiku 5.5 with `tool_choice` `auto` or `none`. The table has no row for Fable 5.2. `[LIVE]` [pricing], [tools]
- Service tiers are legacy. Priority Tier is no longer sold and does not support any of these four models. `[LIVE]` [service-tiers]

### B.1 Worst-case unit costs `[DERIVED]` from the table

| Model | 1,000 uncached input tokens | 1,000 input tokens written to the 5-minute cache | 1,000 output tokens (each 1,000 of `max_tokens`) |
| --- | --- | --- | --- |
| Claude Fable 5.2 | $0.008 | $0.010 | $0.040 |
| Claude Opus 5.5 | $0.004 | $0.005 | $0.020 |
| Claude Sonnet 5.5 | $0.002 | $0.0025 | $0.010 |
| Claude Haiku 5.5 (prompt up to 100,000 tokens) | $0.0001 | $0.000125 | $0.0005 |

Example: one call with 1,500 uncached input tokens and `max_tokens: 2048`, fully used.

| Model | Worst case per call | Calls that fit in $200 |
| --- | --- | --- |
| Claude Fable 5.2 | $0.09392 | 2,129 |
| Claude Opus 5.5 | $0.04696 | 4,258 |
| Claude Sonnet 5.5 | $0.02348 | 8,517 |
| Claude Haiku 5.5 | $0.001174 | 170,357 |

---

## C. Claude Fable 5.2 request-surface rules

- **Thinking: omit the field.** Adaptive thinking is always on. Omit `thinking` or send `{"type": "adaptive"}`. `{"type": "enabled"}` with `budget_tokens` and `{"type": "disabled"}` both return a 400 `invalid_request_error`. `[LIVE]` [fable-new], [thinking], [errors]
  - Optional `display`: `"omitted"` is the default on Fable 5.2 and returns `thinking` blocks with an empty `thinking` field plus a `signature`. `"summarized"` returns a summary. Billing is identical. `[LIVE]` [thinking]
  - A response can therefore begin with one or more `thinking` blocks. Select content blocks by `type`; do not read `content[0].text`. `[LIVE]` [fable-mig]
  - "No level guarantees a thinking block on every request." `[LIVE]` [steering]
- **Effort.** `output_config.effort` accepts `low`, `medium`, `high`, `xhigh`, `max`. The API default on Fable 5.2 is `high`. Setting the default explicitly is identical to omitting it. `[LIVE]` [messages], [effort]
  - "Effort is a behavioral signal, not a strict token budget." `[LIVE]` [effort]
  - "At `high` and above, the model thinks before almost every reply, including a reply to a greeting." `[LIVE]` [fable-prompt]
  - A prompt line that asks for less thinking "didn't stop Claude Fable 5.2 from thinking at `medium` and above". Lower the effort level instead. `[LIVE]` [fable-new]
  - `low` "suits quick back-and-forth, well-specified tasks, and high-volume workloads". `[LIVE]` [fable-prompt]
  - "Effort has little effect on the length of assistant turn responses." `[LIVE]` [fable-prompt]
- **Sampling parameters: omit all three.** On API version `2026-10-21`, which SDK 1.x sends, "a request that includes `temperature`, `top_p`, or `top_k` at any value returns a 400 error on every model". On `2023-06-01`, non-default values return a 400 on Fable 5.2. `[LIVE]` [thinking], [versioning], [fable]
- **Forced tool choice is rejected.** `tool_choice` of `{"type": "any"}` or `{"type": "tool", "name": "..."}` returns a 400: `tool_choice: type "tool" and "any" are not supported for this model.` `auto` (the default) and `none` are accepted. The same 400 applies on the token-counting endpoint. `[LIVE]` [errors], [fable-new]
  - Same rule on Opus 5.5 and Sonnet 5.5. `[LIVE]` [errors]
  - Haiku 5.5 is not in the live list of models that reject it. The local reference states that it accepts forced tool choice. `[SKILL]` `skill file: shared/model-migration.md`
- **Prefill is removed.** A final `assistant` message returns a 400: "This model does not support assistant message prefill. The conversation must end with a user message." Applies to Claude 4.6 and later models. `[LIVE]` [errors]
- **`max_tokens` covers thinking plus text.** "`max_tokens` is a hard cap on total output for the request, thinking and response text combined. Claude never generates past it." `[LIVE]` [steering]
  - Range: minimum 0, maximum 128,000 on these models. `0` is the cache pre-warm mode and is rejected together with `output_config.format`. `[LIVE]` [messages], [caching]
  - Thinking tokens count toward `max_tokens`, "so a request with a small `max_tokens` can stop with `stop_reason: "max_tokens"` after a `thinking` block and before any text". `[LIVE]` [fable-mig]
  - Truncated turns are "discarded and still billed". `[LIVE]` [costopt]
  - "At `high` and above, set a large `max_tokens`." `[LIVE]` [effort]
- **`stop_reason` values:** `end_turn`, `max_tokens`, `stop_sequence`, `tool_use`, `pause_turn`, `refusal`, `model_context_window_exceeded`. `[LIVE]` [messages], [stop]
- **`stop_details`** is `null` except on a refusal, where it is `{ type: "refusal", category, explanation }`. `[LIVE]` [messages], [refusals]
  - `category` is one of `"cyber"`, `"bio"`, `"frontier_llm"`, `"reasoning_extraction"`, `"general_harms"`, or `null`.
  - `explanation` is a string or `null`. "The text is not stable, so display it rather than parse it."
  - `recommended_model` is present only on requests that set `fallbacks`.
  - Branch on `stop_reason === "refusal"`, never on the inner fields.
- **A refusal is an HTTP 200**, with empty or partial `content`. See section G for billing. `[LIVE]` [refusals]
- **`reasoning_extraction` trap for JSON schemas.** A `reasoning`, `thinking` or `trace` field "in JSON output or in a tool input" can trigger this refusal, and this category is billed even before any output. Ask for "a short explanation" instead. `[LIVE]` [refusals], [so]
- **Server-side fallback is opt-in and beta** (`client.beta.messages`, header `server-side-fallback-2026-07-01`, `fallbacks: "default"` or up to three named models). Permitted targets for Fable 5.2 are Claude Opus 4.8 and Claude Opus 5. Not supported on the Message Batches API. `[LIVE]` [refusals], [fable-new]
- **30-day data retention is required.** Fable 5.2 is a Covered Model and "isn't available under legacy zero data retention (Legacy ZDR) unless expressly authorized by Anthropic". `[LIVE]` [fable], [retention]
  - A non-compliant organization gets a 400 `invalid_request_error`: "In order to access this model, your organization or workspace must have data retention enabled." The live sentence that shows this message names Claude Fable 5; the requirement covers every Covered Model, and the local reference applies the same 400 to Fable 5.2. `[LIVE]` [retention], `[SKILL]` `skill file: shared/error-codes.md`
- **Structured outputs are unavailable in a CMEK organization** for Fable 5.2 (both JSON outputs and strict tool use). `[LIVE]` [fable-new]
- **History-editing (prefix) check.** Fable 5.2 returns a 400 when a request sends back a thinking block after `system`, `tools` or an earlier message changed. Enforced for every account. `[LIVE]` [fable-new]
  - A stateless single-turn call that never sends an assistant turn back cannot trigger it. `[DERIVED]`
- **Rate limits for Fable 5.2** (own bucket, separate from Fable 5.1): Start 4,000 RPM / 500,000 ITPM / 100,000 OTPM; Build 10,000 / 1,500,000 / 300,000; Scale 13,000 / 4,000,000 / 800,000. `[LIVE]` [limits]

---

## D. Structured outputs

### D.1 Request shape and support

- **Shape:** `output_config: { format: { type: "json_schema", schema: { ... } } }` on `POST /v1/messages`. Generally available, no beta header. `[LIVE]` [so], [messages]
- The old top-level `output_format` parameter is deprecated and returns a 400 unless the `structured-outputs-2025-11-13` beta header is sent. `[LIVE]` [so]
- **Where the JSON arrives:** "Claude returns valid JSON that matches your schema in the response's text content block." `[LIVE]` [so]
- **Supported models:** the page's list includes `claude-fable-5-2`, `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-haiku-5-5`, and states "Structured outputs are available on every model". Exception: Fable and Mythos models in a CMEK organization. `[LIVE]` [so], [fable-new]
- **Grammar scope:** "Grammars apply only to Claude's direct output, not to tool use calls, tool results, or thinking tags". Thinking stays unconstrained and still consumes `max_tokens`. `[LIVE]` [so]
- **Works with:** batch processing, token counting ("Count tokens without compilation"), streaming, and strict tool use in the same request. `[LIVE]` [so]
- **Incompatible with:** citations (400) and message prefilling. `max_tokens: 0` is rejected with `output_config.format`. `[LIVE]` [so], [caching]

### D.2 JSON Schema limitations `[LIVE]` [so]

Supported:

- All basic types: object, array, string, integer, number, boolean, null.
- `enum` and `const` (strings, numbers, booleans or nulls only).
- `anyOf` and `allOf`, with the exceptions below.
- `$ref`, `$defs`, `definitions`.
- `default`.
- `required`, and `additionalProperties` (must be `false` for objects).
- String formats: `date-time`, `time`, `date`, `duration`, `email`, `hostname`, `uri`, `ipv4`, `ipv6`, `uuid`.
- Array `minItems` with values 0 and 1 only.
- `pattern`, for simple regular expressions: full or partial matching, quantifiers `*`, `+`, `?` and simple `{n,m}`, character classes, groups.

Not supported ("If you use an unsupported feature, you'll receive a 400 error with details"):

- Recursive schemas.
- `oneOf` (use `anyOf`), and `not`.
- `anyOf` in the same schema object as keywords such as `type` or `properties`.
- `allOf` with conflicting schemas, or with two or more schemas when one directly contains `$ref`, `anyOf` or `allOf`.
- Complex types within enums.
- External `$ref`.
- Numerical constraints: `minimum`, `maximum`, `multipleOf`.
- String constraints: `minLength`, `maxLength`.
- Array constraints beyond `minItems` of 0 or 1.
- `additionalProperties` set to anything other than `false`.
- In `pattern`: backreferences, lookahead and lookbehind, `\b` and `\B`, complex `{n,m}` quantifiers with large ranges. "Complex patterns might result in 400 errors."

Complexity limits, across all strict schemas in one request:

| Limit | Value |
| --- | --- |
| Strict tools per request | 20 |
| Optional parameters (each property not listed in `required`) | 24 in total |
| Parameters with union types (`anyOf` or type arrays such as `["string", "null"]`) | 16 in total |
| Grammar compilation timeout | 180 seconds |

- Beyond those, internal limits on compiled grammar size return a 400 with "Schema is too complex for compilation."
- No maximum schema size in bytes is published. **UNCONFIRMED.**

Behaviors to code for:

- **Objects with arbitrary keys are impossible.** An object with empty or missing `properties` can only come back as `{}`. Use an array of `{key, value}` objects.
- **Property order:** required properties first, then optional ones, each group in schema order.
- **Enum casing is not guaranteed.** "Claude might return a value that differs from your schema only in capitalization". Compare enum values case-insensitively and avoid enum values that differ only in capitalization.

### D.3 Truncation, refusal, compilation

- **`stop_reason: "max_tokens"`:** "The output might be incomplete and not match your schema." Retry with a higher `max_tokens`. `[LIVE]` [so]
- **`stop_reason: "refusal"`:** HTTP 200. "You'll be billed for the tokens generated." "The output might not match your schema because the refusal message takes precedence over schema constraints." `[LIVE]` [so]
- **First-request latency:** "The first time you use a specific schema, there is additional latency while the grammar compiles." `[LIVE]` [so]
- **Grammar cache:** compiled grammars "are cached for 24 hours from last use". Changing the schema structure invalidates the entry; changing only `name` or `description` fields does not. `[LIVE]` [so]
- **Prompt-cache interaction:** "Changing the `output_config.format` parameter invalidates any prompt cache for that conversation thread." `[LIVE]` [so]

### D.4 TypeScript helpers

- `client.messages.parse({...})` with `output_config: { format: zodOutputFormat(Schema) }`. Import `zodOutputFormat` from `"@anthropic-ai/sdk/helpers/zod"`. The result is in `response.parsed_output`, typed from the schema. `[LIVE]` [so]
- `jsonSchemaOutputFormat(schema, { transform?: boolean })` from `"@anthropic-ai/sdk/helpers/json-schema"` takes a plain JSON schema without Zod. It does not validate the response. `[LIVE]` [so], [gh-helpers]
- **SDK transformation:** the helpers remove unsupported constraints (for example `minimum`, `maxLength`), append them to the field's description, add `additionalProperties: false` to all objects, filter string formats, and (Zod helper only) validate the response against the original schema. `[LIVE]` [so]
- Use `z.object()`, not `z.record()`: a record is sent as an object with empty `properties`. `[LIVE]` [so]
- **`parse()` throws on unparseable text.** `[SDK-SRC]` [gh-parser], [gh-zod]
  - `parse()` is `create()` followed by a parse of each `text` block. Invalid JSON or a Zod validation failure throws an `AnthropicError` whose message starts `Failed to parse structured output`.
  - The thrown error does not carry the `Message`, so `usage` is lost to the caller.
  - `parsed_output` is `null` only when the response has no `text` block.
  - For a budget ledger, call `client.messages.create()` with the same `output_config`, record `usage` and `stop_reason` first, then parse. The helper's doc comment says it "can be passed directly to the `.create()` method but will not result in any automatic parsing".
- **Zod version.** The helper imports `zod/v4`. `zod` is an optional peer dependency, `^3.25.0 || ^4.0.0`. `[SDK-SRC]` [gh-zod], `[NPM]` [npm]
  - The docs example uses `import { z } from "zod"`; the SDK repository example uses `import { z } from 'zod/v4'`. With `zod@4` both give the v4 API. `[LIVE]` [so], [gh-helpers]

### D.5 Strict tool use as the alternative

- Set `strict: true` as a top-level property of the tool definition, next to `name`, `description` and `input_schema`. The schema needs `additionalProperties: false`. Same JSON Schema subset and limits as D.2. `[LIVE]` [strict]
- It guarantees that `tool_use.input` follows the schema and that the tool `name` is valid. It does not guarantee that the model calls the tool. `[LIVE]` [strict]
- On Fable 5.2, Opus 5.5 and Sonnet 5.5 the call cannot be forced, so the docs recommend JSON outputs "when you need the response itself in a fixed JSON shape". `[LIVE]` [errors]

---

## E. The response `usage` object

Fields on `Message.usage`, exactly as listed in the Messages API reference `[LIVE]` [messages]:

| Field | Type | Meaning |
| --- | --- | --- |
| `input_tokens` | number | Input tokens not read from or written to the cache (tokens after the last cache breakpoint) |
| `output_tokens` | number | "the inclusive, authoritative total used for billing"; includes thinking tokens |
| `cache_creation_input_tokens` | number or null | Input tokens written to the cache |
| `cache_read_input_tokens` | number or null | Input tokens read from the cache |
| `cache_creation` | object or null | `ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens`; their sum equals `cache_creation_input_tokens` |
| `output_tokens_details` | object or null | `thinking_tokens`: output tokens generated as internal reasoning; "Always ≤ `output_tokens`"; a read-only breakdown |
| `server_tool_use` | object or null | `web_search_requests`, `web_fetch_requests` |
| `service_tier` | `"standard"`, `"priority"`, `"batch"` or null | Tier the request used |
| `inference_geo` | string or null | "The geographic region where inference was performed" |
| `speed` | `"standard"`, `"fast"` or null | Inference speed mode used |

- "Total input tokens in a request is the summation of `input_tokens`, `cache_creation_input_tokens`, and `cache_read_input_tokens`." `[LIVE]` [messages]
- "`output_tokens` will be non-zero, even for an empty string response from Claude." Token counts "will not match one-to-one with the exact visible content". `[LIVE]` [messages]
- There is no separate reasoning-token charge. `thinking_tokens` is already inside `output_tokens`; do not add it again. `[LIVE]` [steering]
- **Beta only:** `usage.iterations` appears with server-side fallback. It is "the per-attempt record of what you're billed"; top-level `usage` then describes "only the attempt that produced the returned message". `[LIVE]` [refusals]
- **Streaming:** `message_start` carries usage, and counts in `message_delta` are cumulative. The thinking breakdown appears only on the final `message_delta`. `[LIVE]` [streaming], [steering]

### E.1 Billed cost from `usage` `[DERIVED]` from the pricing rules in section B

```text
prompt_tokens = input_tokens + cache_creation_input_tokens + cache_read_input_tokens

cost_usd = ( input_tokens                              * P_input
           + cache_creation.ephemeral_5m_input_tokens  * P_input * 1.25
           + cache_creation.ephemeral_1h_input_tokens  * P_input * 2
           + cache_read_input_tokens                   * P_cache_read
           + output_tokens                             * P_output ) / 1_000_000
           * (1.1 if the request ran with inference_geo "us", else 1)
           * (0.5 if service_tier is "batch", else 1)
```

- Use the fast-mode prices when `usage.speed` is `"fast"`.
- On Haiku 5.5, use the higher rate card for the whole request when `prompt_tokens` exceeds 100,000.
- Add $0.01 per web search if a server tool is used ($10 per 1,000 searches).
- With `fallbacks`, apply the formula to each `usage.iterations` entry at that entry's model prices.

### E.2 Worst-case reservation before the call `[DERIVED]`

```text
reserve_usd = attempts * ( input_estimate * P_input_worst + max_tokens * P_output ) / 1_000_000 * modifiers
```

- `max_tokens * P_output` is the only hard bound on output. Effort and prompt wording are soft, and thinking is always on for Fable 5.2 and Opus 5.5.
- `input_estimate` comes from `count_tokens` on the identical request (section F). The docs call the count "an estimate" that "might differ by a small amount", so add a margin.
- `P_input_worst` is the base input price with no caching, 1.25x when a 5-minute cache write is possible, 2x for a 1-hour write. Parallel requests all miss (section I).
- `attempts` is 1 only with `maxRetries: 0`. The SDK default re-sends up to twice, and a request that the client times out of "is still charged" (section G).
- `modifiers`: 1.1x for US-only inference, fast-mode prices if `speed: "fast"`.
- With `fallbacks`, add one worst case per fallback attempt at the fallback model's prices.
- Settle the reservation against section E.1 once `usage` is known.

---

## F. Token counting

- **Endpoint:** `POST /v1/messages/count_tokens`. TypeScript: `await client.messages.countTokens({ model, system, messages, ... })` returns `{ input_tokens }`. `[LIVE]` [count], [count-ref]
- **Accepted body parameters:** `messages`, `model`, `system`, `tools`, `tool_choice`, `thinking`, `output_config` (both `effort` and `format`), `cache_control`, `speed`. There is no `max_tokens`. `[LIVE]` [count-ref]
- **Free.** "Token counting is free to use but subject to requests per minute rate limits based on your usage tier." `[LIVE]` [count]

| Usage tier | Token-counting RPM |
| --- | --- |
| Start | 5,000 |
| Build | 10,000 |
| Scale | 20,000 |

- "Token counting and message creation have separate and independent rate limits." `[LIVE]` [count]
- **It is an estimate.** "In some cases, the actual number of input tokens used when creating a message might differ by a small amount." No numeric bound is given. `[LIVE]` [count]
- "Token counts might include tokens added automatically by Anthropic for system optimizations. You are not billed for system-added tokens." `[LIVE]` [count]
- Counts follow the tokenizer of the `model` you pass. Count with `"claude-fable-5-2"` for Fable calls. `[LIVE]` [count]
- It does not use caching logic; `cache_control` blocks are accepted but do nothing. `[LIVE]` [count]
- Rejected inputs: server tools (web search, web fetch, code execution, tool search), the MCP connector, and `image` or `document` blocks with a `url` or `file` source. `[LIVE]` [count]
- Forced `tool_choice` returns the same 400 here as on the Messages API. `[LIVE]` [errors]
- Not stated: whether the returned count includes the structured-output and thinking system prompts that the Messages API bills. **UNCONFIRMED.**

---

## G. Errors, retries, timeouts, and what is billed

### G.1 HTTP status to error type

| HTTP | `error.type` | TypeScript class | SDK retries it by default |
| --- | --- | --- | --- |
| 400 | `invalid_request_error` | `BadRequestError` | No |
| 401 | `authentication_error` | `AuthenticationError` | No |
| 402 | `billing_error` | `PaymentRequiredError` `[SDK-SRC]` | No |
| 403 | `permission_error` | `PermissionDeniedError` | No |
| 404 | `not_found_error` | `NotFoundError` | No |
| 408 | not in the docs list | `RequestTimeoutError` `[SDK-SRC]` | Yes |
| 409 | `conflict_error` | `ConflictError` | Yes |
| 413 | `request_too_large` | `ContentTooLargeError` `[SDK-SRC]` | No |
| 422 | not in the docs list | `UnprocessableEntityError` | No |
| 429 | `rate_limit_error` | `RateLimitError` | Yes |
| 500 | `api_error` | `InternalServerError` | Yes |
| 504 | `timeout_error` | `GatewayTimeoutError` `[SDK-SRC]`, a subclass of `InternalServerError` | Yes |
| 529 | `overloaded_error` | `OverloadedError` `[SDK-SRC]`, a subclass of `InternalServerError` | Yes |
| no response | none | `APIConnectionError`, `APIConnectionTimeoutError` | Yes |

Statuses and types `[LIVE]` [errors]. Class names for 400, 401, 403, 404, 409, 422, 429, 500 and above, and connection errors `[LIVE]` [ts-sdk]; the rest `[SDK-SRC]` [gh-error]. Retry column `[LIVE]` [ts-sdk].

- **Error body:** `{"type": "error", "error": {"type": "...", "message": "..."}, "request_id": "req_..."}`. Some errors add `error.details.error_code`. `[LIVE]` [errors], [messages]
- **A 400 can mean a spend limit.** "The API also returns a 400 when usage reaches an organization or workspace spend limit you set." `[LIVE]` [errors]
- **A 429 has four causes**, told apart by `error.details.error_code` `[LIVE]` [limits], [messages]:
  - An ordinary rate limit, with a `retry-after` header.
  - The usage tier's monthly spend cap: `enforced_spend_limit_reached`, no `retry-after`. Retrying, "including the SDK's automatic retries, fails until access resumes".
  - A contract spend limit: `contract_spend_limit_reached`.
  - A ramp limit: `ramp_limit_exceeded`, with `retry-after`.
- **413 limit:** 128 MB for the Messages and Token Counting APIs, 256 MB for the Batch API. `[LIVE]` [errors]
- **Streaming:** an error can arrive after the 200 as an SSE `error` event. `[LIVE]` [streaming], [errors]
- **Error properties:** `err.status`, `err.name`, `err.headers` `[LIVE]` [ts-sdk]; `err.type`, `err.errorCode`, `err.details`, `err.requestID`, `err.apiMessage` `[SDK-SRC]` [gh-error].
- `APIConnectionError` extends `APIError` in TypeScript, so test for it before `APIError`. `[SDK-SRC]` [gh-error]

### G.2 Retries and timeouts in the TypeScript SDK

- **Retries:** "Certain errors are automatically retried 2 times by default, with a short exponential backoff. Connection errors (for example, because of a network connectivity problem), 408 Request Timeout, 409 Conflict, 429 Rate Limit, and >=500 Internal errors are all retried by default." `[LIVE]` [ts-sdk]
- **`maxRetries`:** client option or per-request option. Default 2; `0` disables retries. `[LIVE]` [ts-sdk]
- The SDK honors `retry-after`. `[LIVE]` [errors]
- Backoff starts at 0.5 s, doubles to a maximum of 8 s, with jitter. An `x-should-retry` response header overrides the status rule. `[SDK-SRC]` [gh-client]
- **`timeout`:** client option or per-request option, in **milliseconds**. Default 10 minutes (600,000 ms). On timeout the SDK throws `APIConnectionTimeoutError`. `[LIVE]` [ts-sdk]
- The page notes that "requests that time out are retried twice by default". `[LIVE]` [ts-sdk]
- **Non-streaming size guard:** "The SDK requires streaming when `max_tokens` is greater than 21,333". It is "a client-side validation, not an API restriction", and an explicit `timeout` or streaming disables it. `[LIVE]` [thinking], [ts-sdk]
- **Request ID:** every response has a `request-id` header. The SDK exposes it as `_request_id` on response objects, and `.withResponse()` returns the raw `Response` for other headers. `[LIVE]` [errors], [ts-sdk]
- Other response headers: `anthropic-organization-id`, `anthropic-workspace-id`. `[LIVE]` [api-overview]
- Logging: at `logLevel: "debug"`, "all HTTP requests and responses are logged, including headers and bodies". The default level is `"warn"`. `[LIVE]` [ts-sdk]

### G.3 Rate limits and their headers `[LIVE]` [limits]

| Model | Start: RPM / ITPM / OTPM | Build | Scale |
| --- | --- | --- | --- |
| Claude Fable 5.2 | 4,000 / 500,000 / 100,000 | 10,000 / 1,500,000 / 300,000 | 13,000 / 4,000,000 / 800,000 |
| Claude Opus 5.5 | 4,000 / 2,000,000 / 400,000 | 10,000 / 5,000,000 / 1,000,000 | 13,000 / 10,000,000 / 2,000,000 |
| Claude Sonnet 5.5 | 4,000 / 2,000,000 / 400,000 | 10,000 / 5,000,000 / 1,000,000 | 13,000 / 10,000,000 / 2,000,000 |
| Claude Haiku 5.5 | 4,000 / 2,000,000 / 400,000 | 10,000 / 5,000,000 / 1,000,000 | 13,000 / 10,000,000 / 2,000,000 |

- New organizations "may start in the Evaluation tier, with limits below the standard limits shown". Those values are not published. **UNCONFIRMED.**
- Token bucket algorithm; a 60 RPM limit "might be enforced as 1 request per second".
- Cache reads do not count toward ITPM. OTPM counts tokens actually generated; `max_tokens` "does not factor into OTPM".
- Headers:
  - `retry-after` (seconds).
  - `anthropic-ratelimit-requests-limit`, `-remaining`, `-reset`.
  - `anthropic-ratelimit-tokens-limit`, `-remaining`, `-reset` (the most restrictive limit in effect).
  - `anthropic-ratelimit-input-tokens-limit`, `-remaining`, `-reset`.
  - `anthropic-ratelimit-output-tokens-limit`, `-remaining`, `-reset`.
  - Reset values are RFC 3339 timestamps. Token `remaining` values are rounded to the nearest thousand.

### G.4 What is billed when a request does not complete normally

- **Failed requests are not charged.** "You're billed only for successful API calls and completed tasks. Failed requests aren't charged." `[HELP]` [help-billing]
- **Client-side timeout or disconnect is charged.** "If your client disconnects or times out in the middle of a request that was on track to succeed, that request is still charged." `[HELP]` [help-billing]
- **`max_tokens` truncation is charged:** the turns are "discarded and still billed". `[LIVE]` [costopt]
- **Refusals** `[LIVE]` [refusals]:
  - Before any output: billed when `stop_details.category` is `"bio"`, `"frontier_llm"` or `"reasoning_extraction"`. Not billed for any other category or a `null` category. "The request still counts against your rate limits."
  - Mid-stream: "bills the input tokens and the output already streamed at normal rates".
  - The docs warn that the billed categories "may change".
- **Batches:** `errored`, `canceled` and `expired` results are not billed. `[LIVE]` [batch]
- **Consequence for a ledger** `[DERIVED]`: a client-side timeout followed by an SDK retry can produce two charged requests for one logical call. Set `maxRetries: 0` and reserve per attempt, or reserve `(maxRetries + 1)` worst cases.
- No idempotency key for `POST /v1/messages` appears in the pages fetched. **UNCONFIRMED.**

---

## H. Message Batches API

- **Supported models:** "All active models support the Message Batches API." The page's list includes all four models. `[LIVE]` [batch]
- **Discount:** 50% of standard prices on all usage. See section B. `[LIVE]` [batch]
- **Size:** "limited to either 100,000 Message requests or 256 MB in size, whichever is reached first". `[LIVE]` [batch]
- **Completion window:** most batches finish within 1 hour. "Batches expire if processing does not complete within 24 hours." `[LIVE]` [batch]
- **Results:** available for 29 days after creation, at `results_url` or through `client.messages.batches.results(batch.id)`, as `.jsonl`. Poll `processing_status` until `"ended"`. `[LIVE]` [batch], [ts-sdk]
- Results "can be returned in any order". Match on `custom_id`. `[LIVE]` [batch]
- **Result types:** `succeeded`, `errored`, `canceled`, `expired`. The last three are not billed. `[LIVE]` [batch]
- **Structured outputs work in batches:** "Process structured outputs at scale with a 50 percent discount". `[LIVE]` [so]
- **Not allowed in a batch request:** `stream: true`, `speed`, `fallbacks`, `max_tokens: 0`. `[LIVE]` [batch]
- A refused batch item comes back as `succeeded` with `stop_reason: "refusal"`. `[LIVE]` [refusals]
- **Spend-limit overshoot:** "Because of high throughput and concurrent processing, batches might go slightly over the spend limit configured in the Claude Console for your Workspace." `[LIVE]` [batch]
- Prompt-cache hits inside a batch are best effort, "ranging from 30 percent to 98 percent". `[LIVE]` [batch]
- Batch rate limits: 1,000 / 2,000 / 4,000 RPM and 200,000 / 300,000 / 500,000 queued requests for Start / Build / Scale; 100,000 requests per batch at every tier. `[LIVE]` [limits]
- Batches are scoped to a workspace. They store request and response data for up to 29 days and are not ZDR eligible. `[LIVE]` [batch]
- "Batch results use the API version of the request that created the batch." `[LIVE]` [batch]

---

## I. Prompt caching

- **Minimum cacheable prompt length: 512 tokens** for Fable 5.2, Opus 5.5, Sonnet 5.5 and Haiku 5.5. `[LIVE]` [caching]
- A shorter prefix is processed without caching and no error is returned; both cache usage fields are then 0. `[LIVE]` [caching]
- **TTL:** 5 minutes by default; `"cache_control": {"type": "ephemeral", "ttl": "1h"}` for 1 hour. A read refreshes the entry at no extra cost. The lifetime is measured from the start of the request. `[LIVE]` [caching]
- **Parallel requests do not share a fresh entry.** For concurrent requests, "a cache entry only becomes available after the first response starts. If you need cache hits for parallel requests, wait for the first response before sending subsequent requests." `[LIVE]` [caching]
- **Isolation:** "Different organizations never share caches". On the Claude API, caches are also isolated between workspaces. `[LIVE]` [caching]
- The cached prefix runs `tools`, then `system`, then `messages`, and a hit requires 100% identical content up to the breakpoint. `[LIVE]` [caching]
- The thinking configuration and the resolved effort level are rendered into the prompt, so changing either can invalidate the cache. `[LIVE]` [thinking]
- Enable with a top-level `cache_control` (automatic) or `cache_control` on a content block (explicit). Four breakpoint slots per request. `[LIVE]` [caching]
- Cache prices are in section B.

---

## J. Provider-side spend controls and reconciliation

- **Prepaid credits are the hardest cap.** Console API usage is billed through prepaid usage credits. "If you run out of credits, you can no longer call the API or use the playground until you add more." Auto-reload is optional and can be turned off. Credits expire one year after purchase and are non-refundable. `[HELP]` [help-billing]
- **Organization monthly spend limit.** Set it in the Console at `platform.claude.com/settings/spend-limits`, at or below the tier cap. When reached, requests return HTTP 400 `invalid_request_error` with a message that starts "You have reached your specified API usage limits". `[LIVE]` [limits]
- **Tier monthly spend caps:** Start $500, Build $1,000, Scale $200,000 per calendar month. At the cap, requests return 429 with `enforced_spend_limit_reached` until 00:00 UTC on the first day of the next month. `[LIVE]` [limits]
- **Workspace monthly spend limit.** "You can set custom spend and rate limits for each workspace". Set it on the same Console page under Workspace limits, with optional email notifications. When reached, the 400 message starts "You have reached your specified workspace API usage limits". `[LIVE]` [workspaces], [limits]
  - A workspace limit can only be lower than the organization's limit. `[LIVE]` [workspaces]
  - Use a non-default workspace. The docs say a Default Workspace limit "might not count or stop some usage"; the Help Center says "You can't set a spend limit for the default Workspace." `[LIVE]` [workspaces], `[HELP]` [help-workspaces]
- **Workspace rate limits.** RPM, ITPM and OTPM per model can be lowered per workspace in the Console or through the Rate Limits API. `[LIVE]` [workspaces], [rl-api]
- **Per-workspace API keys.** "API keys can be scoped to a single workspace." Keys are created only in the Console, with a chosen expiration. `[LIVE]` [workspaces], [auth]
  - The Admin API cannot create keys. "You create API keys in the Claude Console. The Admin API can only read, rename, and change the status of existing keys." `[LIVE]` [admin]
  - A key can be disabled (reversible) or deleted (permanent) in the Console. `[LIVE]` [auth]
- **No per-API-key spend cap is documented.** `[DERIVED]`: the documented way to cap one key is to make it the only key in a dedicated workspace and set that workspace's spend limit.
- **Setting spend limits by API:** `POST /v1/organizations/spend_limits` for Console organization and workspace limits "is in an early access preview". The Spend Limits API guide says the API "is not available to Claude Platform (Claude Console) organizations". Plan on the Console UI. `[LIVE]` [spend-set], [spend-api]
- **Enforcement overshoot.** Documented only for batches (section H). For synchronous requests it is not stated. **UNCONFIRMED.**

### J.1 Usage and cost reconciliation APIs

- **Usage and Cost Analytics API (beta).** `GET /v1/organizations/analytics/usage` (tokens and request counts) and `GET /v1/organizations/analytics/cost` (USD). Requires the header `anthropic-beta: analytics-usage-cost-2026-08-24`. `[LIVE]` [analytics]
  - SDK: `client.beta.organization.analytics.usage.list({...})` and `.cost.list({...})`.
  - Dimensions include `model`, `workspace_id`, `api_key_id`, `service_tier`, `actor`. Up to five `group_by[]` dimensions.
  - Buckets: `time_bucket_width` of `1m`, `1h` or `1d`. A request spans at most 31 days, or 24 hours with `1m`.
  - Cost amounts are decimal strings in cents: `"41280.000000"` is $412.80. `amount` is after discounts and before credits.
  - **Delay:** "Data typically refreshes within 4 hours of the underlying usage and can take up to 24 hours." Each response carries `data_refreshed_at`. Values can be revised "until about 7 days after the end of the calendar month".
- **Legacy Usage and Cost API.** `GET /v1/organizations/usage_report/messages` (buckets `1m`, `1h`, `1d`) and `GET /v1/organizations/cost_report` (daily only). `[LIVE]` [usage-legacy]
  - "Usage and cost data typically appears within 5 minutes of API request completion, though delays might occasionally be longer."
  - "The API supports polling once per minute for sustained use."
- **Credential:** an Admin API key (a separate key type that an organization admin creates in the Console) or another Admin API credential. Workspace API keys do not work. `[LIVE]` [analytics], [rl-api]
- **Account requirement:** "The Admin API isn't available to organizations on the claude.ai Team plan or to individual Claude Console accounts." An individual Console account "must first set up an organization" on the Console's Organization page. `[LIVE]` [analytics]
- Console pages show the same data: `platform.claude.com/usage` and `platform.claude.com/cost`. `[LIVE]` [analytics]

---

## K. API version and the TypeScript SDK

- **Current `anthropic-version`: `2026-10-21`.** The previous version is `2023-06-01`. The header is required on raw HTTP; the SDK sets it. `[LIVE]` [versioning], [api-overview]
- **Latest `@anthropic-ai/sdk`: 1.14.0.** `[LIVE]` [sdk-versions], `[NPM]` [npm]. This repository pins `1.14.0`.
- "Version 1.0.0 is the first to use `2026-10-21`." You move to a new API version by upgrading the SDK major. `[LIVE]` [ts-sdk]
- **Breaking changes in 1.x that matter here** `[LIVE]` [migration]:
  - `temperature`, `top_p` and `top_k` are gone from the request types.
  - `MessageParam` is a union of `UserMessageParam`, `AssistantMessageParam` and `SystemMessageParam`.
  - The API key is sent as `Authorization: Bearer <key>` instead of `X-Api-Key`.
  - A client holds one credential. Passing two of `apiKey`, `authToken`, `credentials`, `config`, `profile` throws a `TypeError`.
  - Text Completions is removed.
  - The license is Apache 2.0.
- **Runtimes:** TypeScript 5.0 or later; Node.js 20 LTS or later (non-EOL versions); Vercel Edge Runtime, Cloudflare Workers, Bun 1.0 or later, Deno 1.28.0 or later. `[LIVE]` [ts-sdk]
- **ESM and CJS:** the published package exposes both. `exports["."]` resolves `import` to `./index.mjs` and `require` to `./index.js`; `./helpers/*` does the same. The docs page does not discuss module formats. `[NPM]` [npm]
- **Default import:** `import Anthropic from '@anthropic-ai/sdk';`. `[LIVE]` [gh-readme]
- **`dangerouslyAllowBrowser`:** browser use is disabled by default "to avoid exposing your secret API credentials". Setting it to `true` enables it and makes the SDK send `anthropic-dangerous-direct-browser-access: true`. Keep it unset in server code. `[LIVE]` [ts-sdk], [auth]
- **Credentials from the environment:** with no credential passed, the SDK reads `ANTHROPIC_API_KEY` first, then `ANTHROPIC_AUTH_TOKEN`. `[LIVE]` [migration]
- `zod` is an optional peer dependency, `^3.25.0 || ^4.0.0`. `[NPM]` [npm]

---

## Verbatim TypeScript snippets from the official docs

Each block is copied unchanged from the cited page as fetched on 2026-11-25. Only the leading indentation of nested doc tabs is removed. The docs examples use `claude-opus-5-5` or `claude-sonnet-5`; swap the model string as needed. The docs tabs omit the import line; the SDK README gives it as `import Anthropic from '@anthropic-ai/sdk';`.

### Client construction, `maxRetries` and `timeout`

Verbatim from [ts-sdk], section "Usage":

```typescript
const client = new Anthropic({
  apiKey: process.env["ANTHROPIC_API_KEY"] // This is the default and can be omitted
});

const message = await client.messages.create({
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello, Claude" }],
  model: "claude-opus-5-5"
});

for (const block of message.content) {
  if (block.type === "text") {
    console.log(block.text);
  }
}
```

Verbatim from [ts-sdk], section "Retries":

```typescript
// Configure the default for all requests:
const client = new Anthropic({
  maxRetries: 0 // default is 2
});

// Or, configure per-request:
await client.messages.create(
  {
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello, Claude" }],
    model: "claude-opus-5-5"
  },
  { maxRetries: 5 }
);
```

Verbatim from [ts-sdk], section "Timeouts":

```typescript
// Configure the default for all requests:
const client = new Anthropic({
  timeout: 20 * 1000 // 20 seconds (default is 10 minutes)
});

// Override per-request:
await client.messages.create(
  {
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello, Claude" }],
    model: "claude-opus-5-5"
  },
  { timeout: 5 * 1000 }
);
```

### Structured-output request

Verbatim from [so], section "Usage", TypeScript tab (Zod helper with `parse()`):

```typescript
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const ContactInfoSchema = z.object({
  name: z.string(),
  email: z.string(),
  plan_interest: z.string(),
  demo_requested: z.boolean()
});

const client = new Anthropic();

const response = await client.messages.parse({
  model: "claude-opus-5-5",
  max_tokens: 1024,
  messages: [
    {
      role: "user",
      content:
        "Extract the key information from this email: " +
        "John Smith (john@example.com) is interested in our Enterprise plan " +
        "and wants to schedule a demo for next Tuesday at 2pm."
    }
  ],
  output_config: { format: zodOutputFormat(ContactInfoSchema) }
});

// Automatically parsed and validated
console.log(response.parsed_output);
```

Verbatim from [so], section "Using a raw JSON schema", TypeScript tab:

```typescript
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";

const client = new Anthropic();

const response = await client.messages.parse({
  model: "claude-opus-5-5",
  max_tokens: 1024,
  messages: [
    {
      role: "user",
      content: "Extract contact info: John Smith, john@example.com, interested in the Pro plan"
    }
  ],
  output_config: {
    format: jsonSchemaOutputFormat({
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        planInterest: { type: "string" }
      },
      required: ["name", "email", "planInterest"],
      additionalProperties: false
    } as const)
  }
});

// response.parsed_output is typed as { name: string; email: string; planInterest: string } | null
console.log(response.parsed_output);
```

Verbatim from [so], section "Using both features together", TypeScript tab (`messages.create()` with a raw `output_config.format` and a `strict: true` tool):

```typescript
const client = new Anthropic();

const response = await client.messages.create({
  model: "claude-opus-5-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Help me plan a trip to Paris departing May 15, 2026" }],
  // JSON outputs: structured response format
  output_config: {
    format: {
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          next_steps: { type: "array", items: { type: "string" } }
        },
        required: ["summary", "next_steps"],
        additionalProperties: false
      }
    }
  },
  // Strict tool use: guaranteed tool parameters
  tools: [
    {
      name: "search_flights",
      description: "Search for available flights to a destination on a specific date",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          destination: { type: "string" },
          date: { type: "string", format: "date" }
        },
        required: ["destination", "date"],
        additionalProperties: false
      }
    }
  ]
});

// Claude might call the tool first (tool_use) or respond with JSON (text)
console.log("Stop reason:", response.stop_reason);
for (const block of response.content) {
  switch (block.type) {
    case "tool_use":
      console.log(`Tool call: ${block.name}(${JSON.stringify(block.input)})`);
      break;
    case "text":
      console.log("Response:", block.text);
      break;
  }
}
```

Effort is set in the same `output_config` object. Verbatim request body from [steering], section "Effort levels":

```json
{
  "model": "claude-opus-5-5",
  "max_tokens": 4096,
  "output_config": { "effort": "medium" },
  "messages": [{ "role": "user", "content": "..." }]
}
```

### Reading `usage` and the request ID

Verbatim from [ts-sdk], section "Counting tokens":

```typescript
const message = await client.messages.create({
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello, Claude" }],
  model: "claude-opus-5-5"
});
console.log(message.usage);
// { input_tokens: 25, output_tokens: 13 }
```

Verbatim `usage` object from the example response in [messages]:

```json
"usage": {
  "cache_creation": {
    "ephemeral_1h_input_tokens": 0,
    "ephemeral_5m_input_tokens": 0
  },
  "cache_creation_input_tokens": 2051,
  "cache_read_input_tokens": 2051,
  "inference_geo": "global",
  "input_tokens": 2095,
  "output_tokens": 503,
  "output_tokens_details": {
    "thinking_tokens": 0
  },
  "server_tool_use": {
    "web_fetch_requests": 2,
    "web_search_requests": 0
  },
  "service_tier": "standard",
  "speed": "standard"
}
```

Verbatim from [errors], section "Request ID", TypeScript tab:

```typescript
const client = new Anthropic();

const message = await client.messages.create({
  model: "claude-sonnet-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello, Claude" }]
});
console.log("Request ID:", message._request_id);
```

Verbatim from [ts-sdk], section "Accessing raw Response data" (the way to read `anthropic-ratelimit-*` headers):

```typescript
const { data: message, response: raw } = await client.messages
  .create({
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello, Claude" }],
    model: "claude-opus-5-5"
  })
  .withResponse();
console.log(raw.headers.get("X-My-Header"));
console.log(message.content);
```

### Typed error handling

Verbatim from [ts-sdk], section "Handling errors":

```typescript
const message = await client.messages
  .create({
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello, Claude" }],
    model: "claude-opus-5-5"
  })
  .catch(async (err) => {
    if (err instanceof Anthropic.APIError) {
      console.log(err.status); // 400
      console.log(err.name); // BadRequestError
      console.log(err.headers); // {server: 'nginx', ...}
    } else {
      throw err;
    }
  });
```

Verbatim from [stop], section "Stop reasons versus errors", TypeScript tab:

```typescript
const client = new Anthropic();

try {
  const response = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello!" }]
  });

  // Handle successful response with stop_reason
  if (response.stop_reason === "max_tokens") {
    console.log("Response was truncated");
  }
} catch (err) {
  // Handle actual errors
  if (err instanceof Anthropic.APIError) {
    switch (err.status) {
      case 429:
        console.log("Rate limit exceeded");
        break;
      case 500:
        console.log("Server error");
        break;
    }
  } else {
    throw err;
  }
}
```

### `count_tokens`

Verbatim from [count], section "Count tokens in basic messages", TypeScript tab:

```typescript
const client = new Anthropic();

const response = await client.messages.countTokens({
  model: "claude-opus-5-5",
  system: "You are a scientist",
  messages: [
    {
      role: "user",
      content: "Hello, Claude"
    }
  ]
});

console.log(response);
```

---

## Source index

All fetched 2026-11-25. Docs pages were read as raw Markdown by appending `.md` to the URL. GitHub files were read through `raw.githubusercontent.com`. Each key below is a link, and the URLs are listed as link definitions at the end of this section.

- **Models and pricing:** [pricing] · [pricing-site] · [models] · [fable] · [fable-new] · [fable-mig] · [fable-prompt] · [opus] · [sonnet] · [haiku] · [deprecations] · [models-api] · [costopt]
- **Request features:** [messages] · [thinking] · [steering] · [thinking-ts] · [effort] · [so] · [strict] · [tools] · [stop] · [refusals] · [streaming] · [caching] · [batch] · [fast] · [count] · [count-ref]
- **Errors, limits, versions:** [errors] · [limits] · [service-tiers] · [versioning] · [migration] · [api-overview]
- **Organization and billing:** [workspaces] · [auth] · [admin] · [rl-api] · [analytics] · [usage-legacy] · [spend-api] · [spend-set] · [retention] · [help-billing] · [help-workspaces]
- **TypeScript SDK:** [ts-sdk] · [sdk-versions] · [gh-readme] · [gh-helpers] · [gh-error] · [gh-parser] · [gh-zod] · [gh-client] · [npm]
- **Redirects seen:** `https://www.anthropic.com/pricing` leads to [pricing-site]; `/docs/en/about-claude/models/overview` leads to [models]; `/docs/en/build-with-claude/adaptive-thinking` leads to [steering].
- **Local reference skill files read** (paths relative to the skill's base directory): `SKILL.md`, `shared/live-sources.md`, `shared/models.md`, `shared/model-migration.md`, `shared/error-codes.md`, `shared/prompt-caching.md`, `shared/token-counting.md`, `shared/platform-availability.md`, `shared/admin-api.md`, `shared/api-version-migration.md`, `shared/cost-optimization.md`, `shared/tool-use-concepts.md`, `typescript/claude-api/README.md`, `typescript/claude-api/tool-use.md`, `typescript/claude-api/batches.md`.

[pricing]: https://platform.claude.com/docs/en/about-claude/pricing
[pricing-site]: https://claude.com/pricing
[models]: https://platform.claude.com/docs/en/models/overview
[fable]: https://platform.claude.com/docs/en/models/fable-5-2/overview
[fable-new]: https://platform.claude.com/docs/en/models/fable-5-2/whats-new-fable-5-2
[fable-mig]: https://platform.claude.com/docs/en/models/fable-5-2/migration-guide
[fable-prompt]: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2
[opus]: https://platform.claude.com/docs/en/models/opus-5-5/overview
[sonnet]: https://platform.claude.com/docs/en/models/sonnet-5-5/overview
[haiku]: https://platform.claude.com/docs/en/models/haiku-5-5/overview
[deprecations]: https://platform.claude.com/docs/en/about-claude/model-deprecations
[models-api]: https://platform.claude.com/docs/en/api/models/list
[thinking]: https://platform.claude.com/docs/en/build-with-claude/thinking
[steering]: https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost
[thinking-ts]: https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting
[effort]: https://platform.claude.com/docs/en/build-with-claude/effort
[so]: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
[strict]: https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use
[tools]: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
[messages]: https://platform.claude.com/docs/en/api/messages/create
[count]: https://platform.claude.com/docs/en/build-with-claude/token-counting
[count-ref]: https://platform.claude.com/docs/en/api/messages/count_tokens
[errors]: https://platform.claude.com/docs/en/api/errors
[limits]: https://platform.claude.com/docs/en/api/rate-limits
[stop]: https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons
[refusals]: https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback
[streaming]: https://platform.claude.com/docs/en/build-with-claude/streaming
[batch]: https://platform.claude.com/docs/en/build-with-claude/batch-processing
[caching]: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
[fast]: https://platform.claude.com/docs/en/build-with-claude/fast-mode
[retention]: https://platform.claude.com/docs/en/manage-claude/api-and-data-retention
[costopt]: https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence
[service-tiers]: https://platform.claude.com/docs/en/api/service-tiers
[workspaces]: https://platform.claude.com/docs/en/manage-claude/workspaces
[auth]: https://platform.claude.com/docs/en/manage-claude/authentication
[admin]: https://platform.claude.com/docs/en/manage-claude/admin-api
[rl-api]: https://platform.claude.com/docs/en/manage-claude/rate-limits-api
[analytics]: https://platform.claude.com/docs/en/manage-claude/usage-cost-analytics-api
[usage-legacy]: https://platform.claude.com/docs/en/manage-claude/usage-cost-api
[spend-api]: https://platform.claude.com/docs/en/manage-claude/spend-limits-api
[spend-set]: https://platform.claude.com/docs/en/api/beta/organization/spend_limits/set
[versioning]: https://platform.claude.com/docs/en/api/versioning
[migration]: https://platform.claude.com/docs/en/api/migration-2026-10-21
[api-overview]: https://platform.claude.com/docs/en/api/overview
[ts-sdk]: https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript
[sdk-versions]: https://platform.claude.com/docs/sdk-versions.json
[help-billing]: https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage
[help-workspaces]: https://support.claude.com/en/articles/9796807-create-and-manage-workspaces-in-the-claude-console
[gh-readme]: https://github.com/anthropics/anthropic-sdk-typescript/blob/main/README.md
[gh-helpers]: https://github.com/anthropics/anthropic-sdk-typescript/blob/main/helpers.md
[gh-error]: https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/core/error.ts
[gh-parser]: https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/lib/parser.ts
[gh-zod]: https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/helpers/zod.ts
[gh-client]: https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/client.ts
[npm]: https://registry.npmjs.org/@anthropic-ai/sdk/latest

---

## UNCONFIRMED / discrepancies between the cached reference and the live docs

### UNCONFIRMED on any official page

1. **Size of the injected system prompts.** The docs say structured outputs and thinking each add a system prompt that is billed as input, but give no token counts. Measuring them takes one paid call per model and schema, which needs owner authorization.
2. **Tool-use system prompt size on Fable 5.2.** The table lists 286 tokens for Opus 5.5, Sonnet 5.5 and Haiku 5.5 and has no Fable row. Irrelevant if the call sends no `tools`.
3. **Accuracy of `count_tokens`.** The count "might differ by a small amount", with no bound given. Also not stated whether its result includes the injected structured-output and thinking prompts.
4. **Whether `usage.output_tokens` can exceed `max_tokens` by a few tokens.** The docs call `max_tokens` a hard cap and never state the inequality for the billed count.
5. **Maximum JSON schema size.** Only the counts in D.2 and "internal limits" are published.
6. **Spend-limit overshoot for synchronous requests.** Documented for batches only. No statement on how quickly a reached limit blocks in-flight or concurrent requests.
7. **Per-API-key spend limit.** None documented. Limits exist per organization and per workspace.
8. **Idempotency key for `POST /v1/messages`.** Not found. Treat every re-send as a new billable request.
9. **Evaluation-tier limits.** New organizations may start there with lower, unpublished rate limits. No spend cap or token-counting RPM is listed for that tier.
10. **Billing of a 5xx or 529 that arrives mid-stream after output began.** The Help Center says failed requests are not charged and client-side disconnects are; this case is not addressed.
11. **Thinking volume per effort level.** No numbers. `effort` is "soft guidance", so worst-case output is always `max_tokens`.

### Discrepancies: cached reference skill versus live docs

1. **Rate-limit header names.** `skill file: shared/error-codes.md` names `x-ratelimit-limit-*` and `x-ratelimit-remaining-*`. The live page lists `anthropic-ratelimit-*`. Use the live names.
2. **`parsed_output` on a parse failure.** `skill file: typescript/claude-api/tool-use.md` says "parsed_output is null if parsing failed". The SDK 1.14.0 source throws `AnthropicError` when the text is not valid JSON or fails Zod validation.
3. **User-set spend limit status code.** The skill's error table lists only the 429 tier cap. Live: a limit you set returns **400** `invalid_request_error`.
4. **Missing statuses.** The skill's summary table omits 409 `conflict_error` and 504 `timeout_error`, which the live errors page lists.
5. **Sampling parameters on Fable.** The skill says "Removed - 400". Live is more precise: any value is a 400 on API version `2026-10-21`; on `2023-06-01` only non-default values are. Same practical rule: omit them.
6. **Streaming threshold.** The skill advises streaming above about 16,000 `max_tokens`. Live: the SDK requires streaming above 21,333. The skill is the more conservative of the two.
7. **Large-`max_tokens` timeout.** The skill and the live SDK page both say the default timeout scales up to 60 minutes. The 1.14.0 source instead throws an `AnthropicError` whose message starts `Streaming is required for operations that may take longer than 10 minutes` when `max_tokens` is above 21,333, unless `timeout` is set or the request streams.
8. **Legacy usage report delay.** `skill file: shared/admin-api.md` says it "lags by about 30 minutes". The live legacy page says data "typically appears within 5 minutes".
9. **Admin SDK namespace.** The skill puts the Admin API under `client.beta.organization`. Live examples use `client.organization` for rate limits and `client.beta.organization.analytics` for usage and cost.
10. **Spend Limits API availability.** The live guide [spend-api] says it "is not available to Claude Platform (Claude Console) organizations"; the live reference [spend-set] and `skill file: shared/admin-api.md` both say Console organization and workspace limits are in an early access preview.
11. **Server-side fallback platforms.** The skill lists Claude Platform on AWS as supported. The live refusals page names only the Claude API and Claude Models on Google Cloud (Anthropic managed). Not relevant to first-party use.
12. **Bedrock model ID for Fable 5.2.** The skill gives `anthropic.claude-fable-5-2`; live gives `global.anthropic.claude-fable-5-2` on `bedrock-runtime` only. Not relevant to first-party use.
13. **Fallback by default.** `SKILL.md` tells code authors to add the `fallbacks` parameter to Fable code by default. That is skill guidance; the live docs present it as an opt-in beta. For a pre-reserved budget it multiplies the worst case and moves billing data to `usage.iterations`.

### Disagreements between official sources

1. **Workspace count:** docs say "Maximum 1,000 workspaces"; the Help Center says "limited to 100 workspaces per organization".
2. **Default Workspace spend limit:** docs imply one can exist but "might not count or stop some usage"; the Help Center says it cannot be set.
3. **`anthropic-version` header:** the API overview and versioning page say it is required; the Messages reference lists it as optional. The SDK always sends it.
4. **Zod import:** docs use `"zod"`, the SDK repository uses `'zod/v4'`.

### Matches (cached reference confirmed live, no change needed)

Model IDs, context windows and output limits · all base, cache, batch and fast-mode prices · Haiku 5.5's 100,000-token rate-card split · thinking always on for Fable 5.2 and Opus 5.5 · effort values and per-model defaults · forced `tool_choice` 400 · prefill 400 · `stop_details` categories · 30-day retention requirement · structured-output request shape and helper import paths · 512-token cache minimum · cache TTLs and multipliers · workspace cache isolation · concurrent-request cache rule · batch size, window and 29-day results · SDK retry defaults and millisecond timeout unit · `anthropic-version: 2026-10-21` and SDK 1.0.0 as the first release to send it.
