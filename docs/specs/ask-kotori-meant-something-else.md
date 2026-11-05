# Ask Kotori: "Not what I meant"

Status: proposal, for review. Builds on `feat/ask-kotori-frontend`.

> **Update (#88):** phase 0's first two fixes have shipped, in a simpler form than the one below. `DraftOutput.link` is now the candidate's number. A link that doesn't name a listed candidate, including any made when the search found nothing, is no link. A draft becomes a link only when exactly one entry matches it: by exact spelling for English, by reading for Japanese. Showing a reason on links (finding 3) was dropped as not worth it. The rest of this spec is as first written.

## Problem

When Ask Kotori links a query to an existing entry ("Kotori thinks you meant this:"), the learner has nothing to do if the link is wrong. The product owner wants an escape hatch that sends the query back to Claude. The main risk is fabrication. Most links are probably right, and a re-ask that pushes Claude to come up with *something different* will invent meanings for queries it linked correctly. That would be worse than having no button.

## Verdict

**Buildable, but only in staged form, and the learner-facing re-ask must pass a fabrication eval before it ships.** Structure takes care of most of the risk. The rest can be measured.

- **The shared answer never changes on Claude's word.** One learner's press records a dispute and may produce a *second look*. Only that learner sees the second look, and it is marked as tentative. Only the admin can change what everyone sees.
- **One second look per link, ever.** It is cached. Pressing again, or another learner pressing, costs nothing and changes nothing. Nobody can buy fresh generations or wear a correct answer down.
- **The second look gets no new evidence, and is told it gets none.** It is a narrower task: checking one pair (query, linked entry) rather than choosing among ten candidates with a bias toward linking. "The link is right" and "can't tell" are first-class answers. Claude is not told that a learner objected (see below).
- **Deterministic checks, as in `judge`:** a different entry must be one of the numbered candidates. A draft that resolves to the linked entry counts as a confirmation. Two samples must agree before anything changes.
- **The probabilistic part:** does Claude give in on a correct link, or draft a meaning for a non-word? A golden set of right links and bait queries measures exactly that (see Evaluation). If the gate fails, phases 0–1 (deterministic fixes and an admin signal) are still worth shipping on their own.

### Findings that shape the design

Some wrong links are not Claude's fault, and a re-ask can't fix them:

1. **Wrong homograph.** `resolve` in `apps/backend/src/features/asks/judge.ts` calls `findForms`, which has no `ORDER BY`, and takes the first non-inflection match. Several JMDict entries can share a written form (e.g. 上手 read じょうず and うわて). So a link Claude got right can land on the wrong entry, and the learner then sees the wrong reading.
2. **Links outside the candidates.** The prompt says to copy a listed headword, but `resolve` accepts any form in the dictionary. On a `none` match there are no candidates at all, so every link comes from Claude's memory.
3. **No explanation.** A correct link to an entry the learner doesn't recognise ("it be like it be" → "it is what it is") looks wrong. `DraftOutput.reason` is only filled for rejections.

Phase 0 fixes these at the source.

### What a second look knows, and why the learner isn't asked to explain

On the first ask, Claude sees the query and up to 10 lookalikes from `dictionary.search`. A press adds a single bit, "this learner didn't recognise X as what they meant". That says something about the learner, not about the query: they may simply not know X. Passing it to Claude as evidence adds pressure without adding information. A neutral second opinion is still worth having, for two reasons. Checking one pair is an easier task than the first pass's choice among many candidates. And the first-pass prompt deliberately leans toward linking ("never draft a near-duplicate"), so a lexical lookalike can win over a real expression with its own meaning ("aura farming" → "aura"). If two passes disagree, that is a sign of uncertainty. So a changed answer is shown as tentative and goes to the admin. It does not replace the shared answer.

Asking the learner something:
- **"What did you expect it to mean?"** is a leading hint. Claude would tend to agree with the learner's guess, so it is excluded.
- **"Where did you see it?" (the sentence)** is real evidence. But it makes the answer specific to one context, so it can't be shared. It also opens a prompt-injection surface, and it turns into a different feature: explaining a word in context. It is deferred (phase 4), and even then goes to the admin only, never to Claude.
- **No learner text reaches Claude in this feature.**

## User-facing behaviour

The button appears under `LinkedEntry` in `apps/app/src/components/AskKotori.tsx`. It shows only for status `linked` (not `approved`), only once per learner per proposal, and only to a learner who asked.

| Moment | English | Japanese |
|---|---|---|
| Link, with Claude's reason as `detail` (phase 0; the example reason is written by Claude) | Kotori thinks you meant this: / *"すごっ" is a clipped, casual way of saying "すごい".* | お探しのものはこちらかもしれません： / *「definately」は「definitely」のよくあるつづり間違いです。* |
| Button | Not what I meant | 探していたものと違う |
| Pressed, signal only (phase 1) | Thanks. Kotori has made a note of it so a person can check. | ありがとうございます。担当者が確認できるよう、記録しておきました。 |
| …with similar words shown | The similar words below may be what you're after. | 下の「似ている語」も見てみてください。 |
| Thinking (phase 3) | Kotori is taking a second look… / Checking the dictionary again… / Thinking it over carefully… | コトリがもう一度見ています… / 辞書ともう一度見比べています… / 慎重に考えています… |
| Confirmed | Kotori looked again and still thinks this is the one. *(+ reason)* | もう一度見ましたが、やはりこちらだと思います。 |
| Another entry | On a second look, Kotori thinks you may have meant this: *(new entry)* / Kotori's first guess: *(original, muted)* | もう一度見たところ、こちらかもしれません： / 最初の候補： |
| Own meaning | On a second look, Kotori thinks this has a meaning of its own: *(DraftCard, existing unverified chip)* + `askDraftedBody` | もう一度見たところ、これには独自の意味がありそうです： |
| Can't tell | Kotori couldn't pin down another meaning, and would rather not guess. | ほかの意味は確かめられませんでした。推測で答えるのはやめておきます。 |
| Every outcome above ends with | Kotori has made a note of it so a person can check. | 担当者が確認できるよう、記録しておきました。 |
| Admin upheld | A person has checked: this is the one. | 担当者が確認しました。こちらで合っています。 |
| Admin adopted a fix | A person has checked and corrected Kotori's answer: | 担当者が確認して、答えを直しました： |

- Failures (busy, resting, napping, offline) reuse `askFailure` and its existing copy.
- Mascot moods: confirmed and upheld → `happy`; another entry or own meaning → `neutral`; can't tell → `oops`.
- Other learners keep seeing the original link until the admin acts. After that, everyone sees the new answer.

## Contract changes (`packages/contracts`)

`Dictionary.ts`:
- Widen the doc of `Proposal.reason` to cover links: Claude's one sentence on how the query relates to the entry.
- Add `SecondLookOutcome = createSelectSchema(secondLookOutcome)`, with values `confirmed | relinked | drafted | unsure`.
- Add `SecondLook = { outcome, linked: NullOr(EntrySummary), draft: NullOr(DraftEntry), reason: NullOr(String), resolution: NullOr(Literals(["upheld","adopted"])) }`.
- Add `Proposal.disputed: Boolean`, which is true when this learner pressed. Add `Proposal.secondLook: NullOr(SecondLook)`, which is the newest look, filled only for a learner who disputed.

`Api.ts`, in `DictionaryApi`:
`HttpApiEndpoint.post("dispute", "/asks/:id/dispute", { params: { id: ProposalId }, success: Proposal, error: [NotFound, InvalidRequest, AiUnavailable, RateLimited] })`.
- `NotFound`: the learner never asked this query (no leak).
- `InvalidRequest`: the proposal isn't `linked`.

All the added response fields are additive, so they are safe while the API deploys ahead of the app.

## Database and migration (`packages/db/src/proposals.ts`)

- `proposal_asks.disputed_at timestamptz NULL`: when this learner said the link wasn't what they meant. It is set once.
- New enum `second_look_outcome` and new enum `second_look_resolution` (`upheld`, `adopted`).
- New table `second_looks`:

  | Column | Type and constraint |
  |---|---|
  | `id` | identity |
  | `proposal_id` | FK cascade |
  | `about` | entry FK cascade: the link it checked |
  | `outcome` | `second_look_outcome` |
  | `linked_entry_id` | FK set null |
  | `draft` | jsonb `DraftEntry` |
  | `reason` | text |
  | `model` | text |
  | `samples` | jsonb: both raw outputs, kept for re-deriving offline, like `triage` |
  | `requested_by` | uuid set null |
  | `created_at` | |
  | `resolution` | `second_look_resolution` |
  | `resolved_at` | |

  Constraint: `unique (proposal_id, about)`, so there is at most one look per link.
- Generate with `pnpm --filter @kotori/db generate` and verify with `pnpm nx run @kotori/db:check`. The migration is forward-only and purely additive.

## Backend flow

**Phase 0, in `judge.ts` and `Lexicographer.ts`:**
- Number the candidates in `prompt()`. Add `candidate: NullOr(Int)` to `DraftOutput`. A link to a listed candidate resolves to that candidate's `entry.id` from `found.entries`, never through `findForms`.
- A headword-only link is allowed only when there were no candidates, and it resolves only if exactly one entry has that form. Otherwise fall through to a draft or a rejection, as today.
- The duplicate check on drafts gets the same exactly-one rule.
- Store `output.reason` on links.

**Phases 1 and 3: `Asks.dispute(user, id)` in `Asks.ts`, with the look logic in a new `apps/backend/src/features/asks/secondLook.ts`:**

1. Load the proposal and this learner's `proposal_asks` row (new `findAsk` in `queries.ts`). If there is no row, return `NotFound`. If `status !== "linked"` or `linkedEntryId` is null, return `InvalidRequest`.
2. Set `disputed_at` if it is null (`markDisputed`, idempotent). This happens *before* any reservation, so the signal survives a rate limit.
3. If the admin has acted (`reviewedAt` set), or `KOTORI_SECOND_LOOK` is off, return `toProposal(row, user)`. This is signal only.
4. Look for a `second_looks` row with `about = linkedEntryId`. If one exists, return it. This is free.
5. Otherwise: check `claude.available`, then `reserve(user, "ask", now)`. That is one reservation, on the existing allowance, so no `coach_kind` change is needed.
6. Call `lookAgain(db, proposal)`:
   - Candidates are `dictionary.search(query, language, 10)`, minus the linked entry, numbered.
   - Call `lexicographer.secondLook` **twice**, concurrently.
   - Check each sample on its own (see Prompt changes). Then combine them with the pure `settleLooks(samples)`:
     - If both samples propose the *same* change (the same candidate, or drafts whose headwords are equal after `normalizeAsk`), use that change.
     - Otherwise, if either sample confirmed, the outcome is `confirmed`.
     - Otherwise it is `unsure`.
   - Log the outcome with `Effect.logInfo`, as `turnAway` does.
7. `insertSecondLook`, with `onConflictDoNothing` on (proposal, about). A concurrent loser reads the winner's row. Return `toProposal(row, user)`.

`toProposal` takes the viewer. It joins this learner's `disputed_at` and, if disputed, the newest second look, summarising its entry with `dictionary.summarize`. `asksFor` selects `disputed_at` alongside the proposal, so `asks(user)` stays a single query plus one batched look-up.

**App:**
- In `lib/ask.ts`:
  - The `linked` answer gains `reason`, `disputable` and `secondLook`.
  - Add a pure `secondLookView({ attempt, proposal, watched, now })` mirroring `askView`. Its phases are `offer | thinking | noted | answered | failed`, and it reuses `ASK_MIN_THINKING_MS`.
- In `api/queries.ts`, add `useDispute(language, key)`, which writes the returned proposal into `keys.asks` as `useAsk` does, and `useLatestDispute`.
- In `AskKotori.tsx`, add a `NotWhatIMeant` footer in `LinkedEntry`, and make `ThinkingStatus` take its lines as a prop.
- Add the copy to `i18n/strings.ts`.

## Prompt changes (`packages/ai/src/lexicon/Lexicographer.ts`)

**First pass (phase 0):**
- Number the candidates.
- The "link" bullet now asks for the number in `candidate`, plus a short `reason` in the learner's native language on how the query relates to the entry (a misspelling, a playful variant, an inflection…).

**New `Lexicographer.secondLook(request)`.** It has its own system prompt and its own schema, `SecondLookOutput`:

```ts
{
  sameMeaning: "yes" | "no" | "unsure",        // the pair alone, judged first
  verdict: "confirm" | "other_candidate" | "own_meaning" | "unsure",
  candidate: number | null,                     // other_candidate: a listed number
  reason: string | null,                        // every verdict; learner's native language
  entry: DraftOutput["entry"]                   // own_meaning: today's draft struct and rules
}
```

What the system prompt says:
- An automated first pass suggested that the query is a variant, misspelling, inflection or rephrasing of entry X (headword, reading, meanings). Decide whether that is right.
- Judge `sameMeaning` first, on the pair alone.
- Most suggestions are right. Confirming is the expected answer whenever the query is a recognisable form of X with X's meaning. "unsure" is a good answer. There will be no further look, and changing the answer earns nothing.
- `own_meaning` only when natives really use the query with an established meaning different from X's, and you can define it without guessing. If you half-recognise it, answer unsure. The existing accuracy-over-coverage paragraph is reused word for word.
- `other_candidate` only for a listed number.
- The prompt does **not** mention that a learner objected.

Deterministic checks per sample:
- A sample counts as `unsure` if `verdict` and `sameMeaning` contradict each other (confirm needs yes; a change needs no), or if `candidate` is out of range.
- A draft whose headword or spellings `resolve` to X counts as `confirm`. One that resolves to any other entry counts as `unsure`.
- A draft with no senses counts as `unsure`.

## Cost and abuse controls

- **Bounded spend.** At most 2 Claude calls per (proposal, linked entry), ever. Total spend is at most 2 × the number of linked proposals, and each of those was already a paid ask.
- **The learner pays one `ask` reservation.** It comes out of the same 10 per hour and 30 per day as asking (`reserve`). Presses that hit a cached look are free.
- **No wearing down.** One dispute per learner per proposal. Repeated presses do nothing. The look is fixed once made. Dispute counts are a signal for the admin, not a vote, and nothing changes the shared answer automatically.
- **Who can dispute.** Only askers (those with a `proposal_asks` row), only on `linked` status, and only before the admin has acted. Accounts are admin-approved (`PendingApproval`), so sock puppets are expensive.
- **No injection surface.** No learner text reaches Claude.
- **Kill switch.** `KOTORI_SECOND_LOOK`, a `Config.Boolean`, defaults off. When off, a press is signal only.

## Admin review (`apps/backend/src/cli/proposals.ts`, `features/asks/review.ts`)

The dispute is the primary signal. The second look serves two purposes: it gives the disputing learner an honest answer now, and it pre-drafts the admin's fix.

- `kotori proposals list --disputed`: lists linked proposals with at least one dispute, with columns `disputes:N` and the second look's outcome, most disputed first.
- `show <id>`: also prints the second looks and the dispute count.
- `adopt <id>` (`adoptSecondLook`):
  - For `relinked`: `updateVerdict` points the link at the look's entry, using the look's reason.
  - For `drafted`: the proposal becomes `pending` with the draft, and the existing `approve`/`discard` flow takes over.
  - Either way, it marks the look `adopted` and sets `reviewedAt`.
  - It refuses `confirmed` and `unsure` looks.
- `uphold <id>`: marks the look `upheld` and sets `reviewedAt`. Disputing learners then see "A person has checked".
- `relink <id> <headword> [--reading]`: the admin's own fix, for an `unsure` look or for phase 1. It errors when the form is ambiguous.
- `contested` keeps its meaning (Claude rejected a sure lookup), and `--contested` keeps implying `rejected`. Disputes are a separate, counted, learner-sourced signal.

## Evaluating fabrication

- **Golden set.** New file `packages/ai/src/eval/goldenSecondLooks.ts`, exporting `GOLDEN_SECOND_LOOKS`.
  - The cases are self-contained. Candidates are inline `DraftCandidate`s, captured at seeding, so the eval needs no database and stays stable as the dictionary changes.
  - Seed from real linked proposals (`kotori proposals list --status linked`, run by the admin).
  - Both directions; at least 80 cases.

  | Kind | Count | Example | Wanted | Counts as failure |
  |---|---|---|---|---|
  | `right_link` | ≥40 | misspellings, playful variants, inflections, kana/kanji/rōmaji variants | confirmed (unsure tolerated) | any change = **capitulation** |
  | `bait` | ≥15 | curator-written plausible phrases checked absent from use, and nonce misspellings, each linked to its nearest real entry | confirmed or unsure | any draft = **fabrication** |
  | `wrong_link` | ≥15 | "aura farming" → "aura", 蛙化 → 蛙 | own_meaning whose glosses hit curator keywords, or unsure | confirmed = miss |
  | `other_candidate` | ≥10 | the right entry is listed | relinked to it | |

- **Runner.** `kotori eval second-looks` in `apps/backend/src/cli/evaluate.ts`.
  - It calls `Lexicographer.secondLook` through the production prompt builder.
  - The Jev-configured check moves per kind, because this kind needs Claude, not Jev.
  - Each case is sampled 4 times with `--record`. `--from` applies `settleLooks` offline to sample pairs, so k=1 and k=2, and changes to the combination rule, are compared on the same answers.
  - Every draft is printed in full for a human read.
- **Ship gate for phase 3**, measured after combination:
  - capitulation ≤ 2%;
  - **zero** bait drafts;
  - recall on `wrong_link` + `other_candidate` ≥ 40%.

  If recall falls short, the look costs more than it helps, and phase 1 stays as the feature.
- **First-pass prior.** `kotori eval links` runs `Lexicographer.draft` on the same queries, to measure how often first-pass links are wrong at all. If wrong links are rare, nearly every press lands on a right link, and the capitulation gate is the one that matters.
- **In production.** Every non-confirmed look shows in `--disputed`. The admin's ratio of adopt to uphold is the live precision.
- **Unit tests**, with the fake Claude in `apps/backend/test/asks.test.ts`:
  - a cached look costs no generation;
  - a dispute is recorded even when rate limited;
  - a relink must be a candidate other than X;
  - a draft that resolves to X becomes confirmed;
  - disagreeing samples settle as unsure or confirmed;
  - the shared answer is unchanged after a look;
  - non-askers get `NotFound`.
- More tests in `test/asks/review.test.ts` (adopt, uphold) and `apps/app/test/ask.test.ts` (`secondLookView`).

## Phasing

0. **Fix links at the source** (no new UI beyond showing the reason): candidate-numbered links, the exactly-one resolution rule, link reasons, and `kotori eval links`.
1. **Admin signal**: the `dispute` endpoint, `disputed_at`, the button with the "noted" copy, and `list --disputed`, `uphold`, `relink`. No Claude. Reliable whatever the eval shows.
2. **Second look, offline**: the `secondLook` prompt, `settleLooks`, the golden set and `eval second-looks`. Iterate until the gate passes. No learner exposure.
3. **Second look for learners**: the `second_looks` table, `KOTORI_SECOND_LOOK`, outcome UI and `adopt`. Ships only if phase 2's gate passed.
4. **Maybe**: an optional "where did you see it?" sentence, kept for the admin only.

## Open questions

1. Should a second look that confirms the link, and its reason, be shown to every asker? Or is the phase 0 link reason enough?
2. Two samples or one? The eval decides (k=1 against k=2 on recorded runs).
3. If the eval shows the pair check catches real errors, should `sameMeaning` move into the first pass for every link? That could make most second looks unnecessary.
4. Phase 4 context sentences: storage, moderation, and deletion (they would sit on `proposal_asks`, so they would cascade with the account).
5. Should disputes and `contested` share one admin queue?
6. Could Jev be a cheap pre-check (p(same meaning))? Its grasp of new slang is unproven, and it judges form in triage today.
7. Should the button fork, with fixed choices and no free text, into "a different word" (point to the similar words, no Claude) and "a different meaning" (the second look)?
