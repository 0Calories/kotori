# What a tool-using Ask Kotori agent costs in time and tokens

Research for [#116](https://github.com/0Calories/kotori/issues/116), part of the map in [#114](https://github.com/0Calories/kotori/issues/114). Researched 2026-11-09 against the repo at `0104b79`.

Every claim below is tagged with where it comes from:

- **Documented**: stated on an Anthropic or TypeSafe docs page fetched on 2026-11-09 (linked inline).
- **Repo**: read from this repository's code.
- **Measured**: counted on 2026-11-09 with the free `POST /v1/messages/count_tokens` endpoint, using the repo's real prompt builders and schemas. No billed request was made.
- **Estimated**: arithmetic on measured sizes and documented prices, with stated assumptions. Nothing here was timed, and no model output was generated.

## Answer in short

- A learner turn is **one request** when Claude can answer straight away (a plain answer, phrasings, a naturalness verdict) and **two requests** when it searches the dictionary first. Each extra client tool call is one more round trip.
- On Claude Opus 5.5 with prompt caching warm, a turn costs **about 1 to 3 cents**: roughly what one `packages/ai` call costs today (about 2 to 3.5 cents). Claude Sonnet 5.5 is half that, Claude Haiku 5.5 about one fortieth.
- **Prompt caching is what keeps the agent at today's price.** Without it a two-request turn costs about 6 cents on Opus 5.5, because the 4,800-token tools-plus-system prefix is paid in full on every request.
- The two things that get dearer are **cold starts** (the first request after more than 5 idle minutes rewrites the cache: about +2.3 cents on an empty conversation, 15 cents or more on a long one) and **the loss of today's answer reuse** (a stored proposal or cached coaching answer costs nothing to serve again; a conversation turn is always paid for).
- **Time was not measured.** The docs publish no latency numbers, only a ranking (Haiku fastest, Sonnet fast, Opus moderate). Structurally, a search turn waits for two model responses instead of one, and on Opus 5.5 thinking cannot be turned off, so the first visible text of a search turn arrives only in the second response.
- The biggest single lever is one the app already holds: Ask Kotori is entered from a search that found nothing, so **send those search results with the first message** and most first turns stay at one request.

## What `packages/ai` does today

**Repo.** One structured Claude call per route, no tools, no conversation:

- `Claude.generate` (`packages/ai/src/providers/Claude.ts`) sends one system prompt and one user message with `output_config.format` (a JSON Schema derived from an Effect `Schema`) and `effort: "medium"`. The model defaults to `claude-opus-5-5` (`KOTORI_CLAUDE_MODEL`). It calls `client.beta.messages.stream(...).finalMessage()`, so the request streams on the wire but the caller only ever sees the finished message. It sets no `cache_control`, and opts into the server-side refusal fallback (`fallbacks: "default"`).
- Three routes use it for learner-facing answers: `Coach.naturalness` and `Coach.howToSay` (`packages/ai/src/coaching/Coach.ts`, prompts in `coaching/prompts.ts`) and `Lexicographer.draft` (`packages/ai/src/lexicon/Lexicographer.ts`).
- In front of the lexicographer, `Asks.ask` (`apps/backend/src/features/asks/Asks.ts`) runs free deterministic checks (`turnAway`), a stored-proposal lookup, a dictionary search, then a Jev triage call (`packages/ai/src/asks/triage.ts`). Only queries Jev reads as lookups (or cannot sort) reach Claude.
- Answers are reused. A proposal is stored per normalized query and served to every later asker ("a question is only ever paid for once"). Coaching answers are cached for 30 days by a hash of the request (`apps/backend/src/features/coaching/Coaching.ts`).
- Per-learner limits: 10 asks an hour and 30 a day, 60 triage calls an hour, 60 coaching calls an hour (config defaults in `Asks.ts` and `Coaching.ts`).

**Measured** request sizes on `claude-opus-5-5` (identical on `claude-sonnet-5-5` and `claude-haiku-5-5`):

| Call | System prompt | User prompt | Whole request with the output schema |
| --- | ---: | ---: | ---: |
| Naturalness check (Japanese sentence, situation and intent given) | 711 | 93 | 1,671 |
| How to say (one English sentence, situation, register) | 632 | 75 | 1,550 |
| Draft an entry (Japanese query, 10 lookalikes listed) | 984 | 302 | 2,177 |
| Draft an entry (English query, no lookalikes) | 985 | 18 | 1,894 |

`output_config.format` adds about 830 to 880 input tokens per request for these schemas (each about 1,000 characters of JSON Schema). The docs say this is expected: "Claude automatically receives an additional system prompt explaining the expected output format" and "the injected prompt costs you tokens like any other system prompt" ([Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)).

**Estimated** cost of one call today on Opus 5.5 ($4 input, $20 output per million tokens). Output sizes are measured on hand-written sample answers that fit the schemas (a naturalness card with 2 issues and 3 rewrites is about 750 tokens, a phrasing card with 3 phrases about 1,090, a one-sense draft about 200). Thinking is billed as output and cannot be turned off on Opus 5.5; how much it thinks on these prompts is unknown, so the table shows three assumptions.

| Call | No thinking | 300 thinking tokens | 1,000 thinking tokens |
| --- | ---: | ---: | ---: |
| Naturalness check | $0.022 | $0.028 | $0.042 |
| How to say | $0.028 | $0.034 | $0.048 |
| Draft an entry (10 lookalikes) | $0.013 | $0.019 | $0.033 |

Jev triage is negligible beside these: **documented** at $0.042 per million input tokens with output free ([TypeSafe models](https://docs.typesafe.ai/models.md)), so a triage request of a few hundred tokens costs well under a hundredth of a cent. The triage request size was not counted.

## How the tool-use loop works

**Documented** ([How tool use works](https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works)):

- "Client-executed tools ... require your application to drive a loop. The model can't run your code, so every tool call is a round trip: the model asks, you execute, you report back, the model continues."
- The loop: send the request with `tools`; Claude answers with `stop_reason: "tool_use"` and one or more `tool_use` blocks; run each tool; send a new request with the original messages, the assistant's response and a user message of `tool_result` blocks; repeat while `stop_reason` is `"tool_use"`. Any other stop reason (`end_turn`, `max_tokens`, `stop_sequence`, `refusal`) ends the loop.
- With the default `tool_choice: auto`, "Claude determines on each turn whether to call a tool or respond directly", and this is steerable from the system prompt ([Tool use overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)).
- "Every tool call is at least one extra round trip; for lightweight tasks the overhead can exceed the work."
- Several tool calls can share one response, so they share one round trip. Results go back together in one user message.
- Lower effort tends to "combine multiple operations into fewer tool calls" and "make fewer tool calls" ([Effort](https://platform.claude.com/docs/en/build-with-claude/effort)).
- Claude Opus 5.5 and Claude Sonnet 5.5 reject forced tool use: the tool-use system prompt table lists no `any`/`tool` column for them, and the model selection guide flags it as a breaking change ([Choosing a model](https://platform.claude.com/docs/en/about-claude/models/choosing-a-model)). So "always call one of the answer tools" can only be asked for in the prompt, and the code must handle a plain-text reply. For Ask Kotori that is fine: a plain written answer is one of the wanted answer kinds.

**Repo.** The installed SDK (`@anthropic-ai/sdk` 0.133.0) ships the beta tool runner (`client.beta.messages.toolRunner`), which drives this loop, and helpers for JSON Schema and Standard Schema tools. A hand-written loop is equally supported by the docs.

**Estimated** round trips for Ask Kotori's five answer kinds:

| Turn | Requests |
| --- | ---: |
| Plain written answer, phrasings, or a naturalness verdict (nothing to look up) | 1 |
| Anything that needs the dictionary first: entries, a drafted entry, a follow-up about a word | 2 |
| A second search, or a draft the backend finds is a duplicate and hands back | 3 |

The share of each kind is a product question, not something the docs can answer. A cap on loop iterations (the tool runner has `max_iterations`) bounds the worst case.

A design consequence worth stating: a tool that only *shapes the answer* (a card) need not cost a second request. The backend can treat that tool call as the end of the turn and send its `tool_result` at the start of the learner's next message. This is inferred from the loop contract above and was not tested.

## Streaming with tool calls

**Documented** ([Streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)):

- A streamed message is `message_start`, then content blocks (each a `content_block_start`, deltas, `content_block_stop`), then `message_delta` and `message_stop`. Text arrives as `text_delta`; tool input arrives as `input_json_delta` fragments of a JSON string, to be parsed when the block stops. The tool's name is known at `content_block_start`, before its input arrives.
- "Current models only support emitting one complete key and value property from `input` at a time. As such, when using tools, there might be delays between streaming events while the model is working." A card written as one tool input therefore arrives key by key, and a long array such as `phrases` arrives in one burst.
- Fine-grained streaming is available per tool with `eager_input_streaming`, which streams input as it is generated. The trade is that the API no longer validates the input, so the client must.
- With thinking display `"omitted"` (the default on current models) "no thinking text is streamed", and the docs name the benefit: "faster time-to-first-text-token when streaming ... You're still charged for the full thinking tokens. Omitting reduces latency, not cost" ([Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking)).
- On Opus 5.5 and Sonnet 5.5 the words the model writes between tool calls come back as progress-update thinking blocks, empty unless `display: "updates"` (beta) is set; "a pause of several seconds before the progress-update block opens is normal".
- `usage` in `message_delta` is cumulative. Errors such as `overloaded_error` can arrive mid-stream. "Tool use and thinking blocks cannot be partially recovered" after an interrupted stream.

What this means for a turn that searches first: the learner sees nothing readable from the first response (it is thinking plus a small tool call), then the answer streams in the second. The start of the `tool_use` block is the earliest honest signal for a "looking it up" state.

## Structured output for card-shaped answers

**Documented** ([Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)):

- Two features share one grammar pipeline: JSON outputs (`output_config.format`, what Claude says) and strict tool use (`strict: true`, how Claude calls a tool). "You can use these features independently or together in the same request."
- Limits across all strict schemas in one request: 20 strict tools, 24 optional parameters, 16 parameters with union types (`anyOf` or a nullable type). Over the limit is a 400, "Schema is too complex for compilation."
- "The first time you use a specific schema, there is additional latency while the grammar compiles." Compiled grammars are cached "for 24 hours from last use". The cache is invalidated by a change to the schema structure "or, when using both structured outputs and tool use, the set of tools in your request".
- "Changing the `output_config.format` parameter will invalidate any prompt cache for that conversation thread."
- The schema guarantee does not hold on `stop_reason: "refusal"` or `"max_tokens"`, and enum capitalization is not guaranteed.
- Structured outputs work with streaming; the JSON must be accumulated before it is decoded.

Two shapes fit Ask Kotori. Both were sized with the repo's schemas; neither was run.

| | Shape A: cards as strict tools | Shape B: one answer schema |
| --- | --- | --- |
| How | `search_dictionary` plus `draft_entry`, `phrase`, `check_naturalness` as strict tools whose input is the card. A plain answer is ordinary text. | `search_dictionary` as the only tool. The final message is JSON matching a union of the five answer kinds (`output_config.format`). |
| **Measured** stable prefix (tools, system, schema) | 4,820 tokens | 6,349 tokens |
| Plain answers | Stream as text, token by token | Arrive inside a JSON string |
| Cards | Arrive as tool input, key by key unless eager streaming is on | Stream as JSON text, token by token |
| History | Each card call needs a `tool_result` before the next turn | No extra bookkeeping |
| Union-typed parameters (limit 16) | 8, counted from the three schemas | 9 |

In both sketches the system prompt is the three current system prompts (naturalness, how-to-say, lexicographer) joined under a short preamble: 2,575 tokens. A purpose-written agent prompt would differ, so treat the prefix sizes as the right order of magnitude, not a specification. Whether either shape compiles within the complexity limits was not tested, because `count_tokens` does not compile grammars.

## Prompt caching for a long prefix and a growing conversation

**Documented** ([Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [Pricing](https://platform.claude.com/docs/en/about-claude/pricing)):

- Caching is a prefix match over `tools`, then `system`, then `messages`. The minimum cacheable prefix is 512 tokens on Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable 5.2; shorter prefixes are processed uncached with no error.
- A 5-minute cache write costs 1.25 times base input and a 1-hour write 2 times. A read costs 0.05 times on Opus 5.5 and Sonnet 5.5, 0.025 times on Fable 5.2, and 0.1 times on Haiku 5.5.
- "The cache is refreshed for no additional cost each time the cached content is used." The lifetime runs from the start of the request.
- Automatic caching (a top-level `cache_control`) moves the breakpoint forward as the conversation grows: "each new request caches everything up to the last cacheable block, and previous content is read from cache."
- Tool results and earlier assistant turns are cacheable. "Cache remains valid when only tool results are provided as user messages", which is exactly the second request of a tool loop.
- Changing tool definitions invalidates everything. Changing `tool_choice` or thinking settings invalidates the cached messages. Caches are scoped to the model and the workspace, so every learner shares one cached prefix as long as it is byte-identical.
- Cache reads are not deducted from rate limits.
- Thinking from earlier turns stays in context on current models and is billed as input on later turns ([Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking)).

Consequences for Ask Kotori:

- **Keep the prefix identical for every learner.** Today's prompts interpolate the learner's native and target language into the system prompt (`coaching/prompts.ts`, `Lexicographer.ts`). In an agent that would make two cached prefixes, one per learning direction. That is workable; putting anything per-learner or per-request there is not.
- **Inside one turn, caching always pays.** The second request of a search turn starts within seconds of the first and reads the whole prefix at 5 percent.
- **Between turns, it depends on the pause.** A learner who replies within 5 minutes reads the cache. One who comes back later pays a full cache write on the whole conversation so far, which is 25 percent more than sending it uncached. The 1-hour lifetime doubles the write price instead. With few users, most first messages of a conversation will be cold.
- **Long conversations are cheap warm and expensive cold.** See the table in the next section.
- Today's calls could be cached too (their system prompts exceed 512 tokens), but input is only about a quarter of their cost, so the saving would be small.

A beta feature, message threads, keeps the conversation server-side so each request sends only the new messages; the docs describe it as giving "a faster time to first token, especially in long conversations", at the same price, with thread contents deleted no more than 1 hour after last use and not eligible for zero data retention ([Message threads](https://platform.claude.com/docs/en/build-with-claude/message-threads)). It was not evaluated further.

## Price per turn at realistic sizes

**Measured** inputs: the Shape A prefix is 4,820 tokens. A learner question is about 20 tokens, a sentence to check with its situation about 95. A `search_dictionary` round trip (the tool call plus 10 entries returned as JSON) appends 710 tokens. Visible outputs are the sample sizes given earlier.

**Documented** prices per million tokens ([Pricing](https://platform.claude.com/docs/en/about-claude/pricing)):

| Model | Input | 5-minute cache write | Cache read | Output |
| --- | ---: | ---: | ---: | ---: |
| Claude Opus 5.5 | $4 | $5 | $0.20 | $20 |
| Claude Sonnet 5.5 | $2 | $2.50 | $0.10 | $10 |
| Claude Haiku 5.5 (prompts up to 100,000 tokens) | $0.10 | $0.125 | $0.01 | $0.50 |
| Claude Fable 5.2 | $8 | $10 | $0.20 | $40 |

Using tools adds a 286-token tool-use system prompt on Opus 5.5, Sonnet 5.5 and Haiku 5.5; that is already inside the measured prefix.

**Estimated** cost of the first turn of a conversation, Shape A, assuming 300 thinking tokens per request (an assumption; see the sensitivity row):

| Turn | Opus 5.5, cache warm | Opus 5.5, cache cold | Opus 5.5, no caching | Sonnet 5.5, warm | Haiku 5.5, warm |
| --- | ---: | ---: | ---: | ---: | ---: |
| Plain answer, no tool (1 request) | $0.010 | $0.033 | $0.028 | $0.005 | $0.0003 |
| Naturalness card (1 request) | $0.022 | $0.046 | $0.041 | $0.011 | $0.0006 |
| Phrasing card (1 request) | $0.029 | $0.052 | $0.047 | $0.015 | $0.0008 |
| Search, then a plain answer (2 requests) | $0.022 | $0.045 | $0.058 | $0.011 | $0.0006 |
| Search, then a drafted entry (2 requests) | $0.024 | $0.047 | $0.059 | $0.012 | $0.0006 |

"Warm" means another request with the same prefix started within the last 5 minutes. "Cold" means the turn pays the cache write itself. Claude Fable 5.2 comes out at about twice the Opus 5.5 figures (for example $0.042 for a warm search turn).

How the same search turn grows with the conversation behind it, on Opus 5.5:

| Conversation so far | Warm | Cold | No caching |
| --- | ---: | ---: | ---: |
| Empty | $0.022 | $0.045 | $0.058 |
| 10,000 tokens (roughly 6 to 8 turns) | $0.026 | $0.097 | $0.138 |
| 20,000 tokens | $0.030 | $0.149 | $0.218 |
| 40,000 tokens | $0.038 | $0.253 | $0.378 |

Thinking is the largest unknown. For the warm search turn on Opus 5.5: $0.009 with no thinking, $0.022 at 300 tokens per request, $0.054 at 1,000. A two-request turn thinks twice, so it is more sensitive than today's single call.

At today's limit of 30 asks a day, a learner who used every one on Opus 5.5 would cost roughly $0.30 to $0.90 a day warm.

### How this compares with today

| | Today (`packages/ai`) | Tool-using agent |
| --- | --- | --- |
| Claude requests per learner action | 1, or 0 when Jev routes the query elsewhere | 1 or 2, sometimes 3 |
| Cost of a fresh answer, Opus 5.5 | About $0.02 to $0.035 | About $0.01 to $0.03 warm, $0.03 to $0.05 cold on a new conversation |
| Cost of a repeated question | $0 (stored proposal, 30-day coaching cache) | Full price: the answer depends on the conversation |
| Cost of mash, names, the wrong language | Near $0 (free checks, then Jev) | A Claude request (about a cent on Opus 5.5) unless the free checks stay in front |
| Input paid per request | 1,550 to 2,180 tokens at full price | About 4,800 tokens plus history, at 5 percent when warm |
| What grows over time | Nothing | The conversation, resent or re-read every request |

## Which model fits

**Documented.** The models overview says to "start with Claude Opus 5.5 for most workloads". It describes Sonnet 5.5 as "the best combination of speed and intelligence" with "agentic tool use" among its example uses, and Haiku 5.5 as the model for "the lowest latency and price" including "real-time applications" ([Models overview](https://platform.claude.com/docs/en/about-claude/models/overview), [Choosing a model](https://platform.claude.com/docs/en/about-claude/models/choosing-a-model)). Comparative latency is listed as Moderate for Opus 5.5 and Fable 5.2, Fast for Sonnet 5.5, Fastest for Haiku 5.5.

Thinking controls differ, and they matter for the wait ([Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking), [Effort](https://platform.claude.com/docs/en/build-with-claude/effort)):

| Model | Can thinking be turned off? | Default effort | Effort advice for this kind of work |
| --- | --- | --- | --- |
| Opus 5.5 | No (`disabled` is a 400 at every effort) | `medium` | Effort is "the primary control for how much the model reasons and what a request costs" |
| Sonnet 5.5 | Up-front thinking off with `between_tools`, at `high` effort or below | `high` | "For chat and other latency-sensitive work, start with `medium` or `low`" |
| Haiku 5.5 | Yes, at `high` effort or below | `medium` | "Use `low` ... for chat, short tool tasks"; at `low` it "is more likely to skip a search, stop early, or skip a check" |

Caches are scoped to one model, so a conversation should stay on one model.

**Judgment, not a finding.** Price does not decide this: even Opus 5.5 is a few cents a turn. What decides it is whether a cheaper model's Japanese and English nuance judgments hold up, and only the repo's golden evaluations (`packages/ai/src/eval`) can say. A reasonable order: keep Opus 5.5 at `medium` or `low` effort, since the current prompts were written against it, and run the same goldens on Sonnet 5.5, which halves the price and is the only one of the two that can drop up-front thinking.

## Time to first token

**Documented.** Anthropic defines time to first token as "the time it takes for the model to generate the first token of the response, from when the prompt was sent" and lists three ways to reduce latency: choose the right model, shorten prompt and output, and stream ([Reducing latency](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-latency)). The pages fetched give no numbers in seconds or tokens per second for any model. The models overview adds that "actual latency depends on prompt length, output length, and thinking effort". Fast mode offers "up to 2.5x higher output speed at premium pricing" on Opus 5.5 ($8 input, $40 output per million tokens).

**Not measured.** No request was timed, so this document contains no seconds. What can be said from the structure:

- A turn's wait is roughly the number of requests times the wait for each response to start, plus the time to generate every output token (thinking included), plus tool time. The dictionary search itself is a local database query.
- Today the learner waits for one whole response and sees it all at once, because `Claude.generate` returns only the final message and the HTTP endpoints return whole results.
- A one-request agent turn that streams should show its first words sooner than today, after the up-front thinking.
- A search turn waits through a whole first response (thinking plus a roughly 20-token tool call) before the second response begins. Its first readable text therefore comes later than a one-request turn's, though its total output is similar.
- The first use of a new schema or tool set pays a one-off grammar compile, cached for 24 hours.
- A cold cache also means the whole prefix is processed rather than read, which the caching docs describe as a latency cost as well as a price one.

Levers, in the order the structure suggests:

1. **Send the search results the app already has.** Ask Kotori opens from a search that found nothing, and `Asks.ask` already runs that search. Putting those results in the first user message removes the first round trip for the most common entry point; `search_dictionary` stays for follow-ups.
2. **Stream the answer to the learner**, which today's code does not do.
3. **Keep effort low** for conversational turns: fewer thinking tokens, fewer tool calls.
4. **Keep free checks in front** so mash and wrong-language queries never reach Claude.
5. Model choice and fast mode, which trade money or quality for speed.

## What could not be verified

- **Any latency figure.** No request was timed. Time to first token, time to first visible text, and tokens per second for this workload are unknown until measured against the real prompt.
- **How much the models think** on these prompts at each effort level. Every dollar figure above assumes 300 thinking tokens per request; the sensitivity rows show how much that matters.
- **How often the agent calls a tool**, and so the real mix of one-request and two-request turns. This needs a run over real learner questions.
- **Output sizes.** They were measured on hand-written sample answers that fit the schemas, not on model output.
- **Whether the sketched schemas compile** under the structured-output complexity limits, and whether strict tools and eager input streaming can be combined. Neither is stated on the pages read, and neither was run.
- **Whether a card tool call can end the turn** with its `tool_result` deferred to the next learner message. It follows from the loop contract but was not tested.
- **Where the injected structured-output prompt sits in the cached prefix.** The docs say it costs tokens and that changing the format invalidates the cache, which implies it is cacheable when stable; this was not observed.
- **Token counts are estimates.** The token-counting docs say the count "is an estimate" and "might include tokens added automatically by Anthropic", which are not billed.
- **Jev's request size and latency.** The triage request was not counted, and the TypeSafe models page gives no latency figure.
- **Pages not read in full.** The structured-outputs and prompt-caching pages were longer than one fetch: the feature-compatibility list at the end of the structured-outputs page and the last third of the caching page were not read. Only the summary of the message-threads page was read, and the fast-mode page was not opened.

## Sources

Anthropic documentation, fetched 2026-11-09:

- [Tool use overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview) (loop example, tool-use system prompt tokens, pricing rules)
- [How tool use works](https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works)
- [Streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Models overview](https://platform.claude.com/docs/en/about-claude/models/overview) and [Choosing a model](https://platform.claude.com/docs/en/about-claude/models/choosing-a-model)
- [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking) and [Effort](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting) ("free to use")
- [Reducing latency](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-latency)
- [Message threads](https://platform.claude.com/docs/en/build-with-claude/message-threads)

Other:

- [TypeSafe models](https://docs.typesafe.ai/models.md) (Jev pricing and limits)
- `@anthropic-ai/sdk` 0.133.0 as installed from `pnpm-lock.yaml` (tool runner and helper files present)
- This repository at `0104b79`: `packages/ai/src/providers/Claude.ts`, `packages/ai/src/providers/Jev.ts`, `packages/ai/src/coaching/`, `packages/ai/src/lexicon/Lexicographer.ts`, `packages/ai/src/asks/triage.ts`, `apps/backend/src/features/asks/`, `apps/backend/src/features/coaching/Coaching.ts`, `packages/contracts/src/Coach.ts`

## How the sizes were measured

A throwaway script (not committed) imported `Coach`, `Lexicographer` and `outputSchema` from `packages/ai`, ran them against a stand-in `Claude` service that recorded the system prompt, user prompt and schema each route builds, and sent those to `POST /v1/messages/count_tokens` for `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-haiku-5-5`. Counts were identical on all three. The agent sketches reused the same prompts and schemas as described above. Costs are those counts multiplied by the documented prices; the cost model treats each request's input as read from cache up to the previous request's end and written at the 5-minute rate after it.
