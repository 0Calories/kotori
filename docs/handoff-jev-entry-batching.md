# Handoff: one Jev request per entry, with per-question scoped state

> Agreed direction, 2026-10-29, not yet built. Follows from the nuance rework
> (`nuance-rework.md`, commits df16195..256a1a4 on this branch). Ash's call: batch the
> whole entry into a single `systemOne` call, and stop leaking irrelevant state across
> questions by using object-form `instructions`.

## The problem

Commit 256a1a4 merged the Japanese and English-side questions into one `systemOne`
request — but still **one request per sense**. An entry with six senses costs six Jev
round-trips (`NuanceEnricher.ts:78-92`, `Effect.forEach` with `concurrency: 3`).
TypeSafe evaluates every question in a request in parallel, so questions are cheap and
requests are the expensive unit: the right shape is **one request per entry**, with each
sense's questions included and each question seeing only the state it needs.

Second, we have a blind spot: every question's `instructions` is a plain string that
points into one big shared `state` by backticked path (`` `word` ``, `` `meaning` ``).
The SDK accepts more than strings:

```ts
// @typesafe-ai/sdk 0.6.0, dist/index.d.mts
type EntryType = string | { [key: string]: JsonValue } | JsonValue[] | null
interface ChoiceQuestion { instructions?: EntryType; ... }   // score and noul likewise
```

`instructions` can be a JSON object. That lets each question carry its own scoped
state — the question text plus exactly the fields it judges — so sense 2's formality
question doesn't see sense 0's similar-word candidates, and the English-side questions
don't see the dictionary-notes evidence meant for the Japanese ones. Today everything in
`senseState` (`packages/nuance/src/state.ts`) is visible to every question in the
request, which both wastes tokens and risks cross-contamination of judgments.

## Target design

One `jev.ask` per entry:

- **Shared `state`**: only what is genuinely entry-wide — `word`, `reading`,
  `other_forms`, and the sense list (index → glosses) so any question can refer to "this
  entry's other meanings" if its scope includes them.
- **Questions keyed per sense**: a naming scheme like `s0_formality`, `s0_keigo`,
  `s0_english_loan`, `s0_similar_1`, `s1_formality`, … Question builders become
  factories over `(senseIndex, scope)` the way `candidateQuestions(index)` already is
  (`questions.ts:~190`).
- **Object instructions per question**: e.g.

  ```ts
  {
    question: "How formal does the Japanese word `word` sound when a native speaker uses it with this meaning?",
    meaning: sense.glosses.join("; "),
    part_of_speech: [...],
    dictionary_notes: [...]          // only the fields THIS question judges
  }
  ```

  The English-side questions get `{ question, english_word, meaning }` and nothing else;
  similar-word questions get the candidate pair only. Decide per question what belongs in
  its scope vs. the shared state — the current `senseState`/`english_word` fields are the
  inventory to redistribute.

## What has to change

| Area | Change |
|---|---|
| `packages/nuance/src/questions.ts` | Questions become factories taking a per-sense scope; instructions become objects. Keep `SUBJECT_NOT_REGISTER` and all the accumulated wording — only the plumbing changes, not the semantics. |
| `packages/nuance/src/english.ts` | Same; the `english_` prefix becomes part of the per-sense key scheme (`s{i}_english_*`). |
| `packages/nuance/src/state.ts` | `senseState` splits into `entryState` (shared) + per-question scope builders. |
| `packages/nuance/src/NuanceEnricher.ts` | One `jev.ask` per entry. Split the answers by key prefix back into per-sense groups. **Persist per-sense answer subsets with the prefixes stripped**, so the stored `answers` shape in `sense_nuance`/`english_nuance` is unchanged and `interpretSense`/`interpretEnglish` and `--reinterpret` keep working on old and new rows alike. |
| `packages/nuance/src/questions.ts` `QUESTIONS_VERSION` | Bump to 3. The wording survives, but the state scoping changes what the model sees, which can shift judgments and confidences — treat it as a question change like any other. |
| `apps/worker/src/commands/evaluate.ts` + `golden.ts` | The eval must send exactly what production sends: build a one-sense synthetic entry per golden word and go through the same entry-state/scope builders (don't hand-mirror the shape again — export and reuse the builders; the current `goldenState`/`goldenEnglishState` duplication is what made this drift possible). |
| Tests | `packages/nuance/test/nuance.test.ts` and `apps/worker/test/work.test.ts` fake Jev by answering per question name — update for the `s{i}_` scheme. Token assertions change (one ask per entry: the two-sense test entry goes from 200 to 100). |

Out of scope, but note: `sentence.ts` and `casting.ts` make single-question calls per
sentence; batching those per-entry (all of an entry's example sentences in one request)
is the same idea and probably worth a follow-up, and the object-instructions pattern
applies there too.

## Order of work

1. **Baseline first.** Run `kotori eval nuance --record baseline-v2.json` and
   `kotori eval english --record baseline-v2-english.json` on the current code. This is
   the yardstick; without it the refactor's effect on judgment quality is invisible.
2. Refactor (table above), version 3.
3. Re-run both evals; compare per-dimension accuracy and confidence calibration against
   the baseline. Scoped state should *help* (less noise per question) — if any dimension
   regresses, the scope for that question is probably missing a field the old shared
   state provided implicitly (prime suspects: `other_meanings` for sense disambiguation,
   `dictionary_notes` for formality/medium).
4. Only then run the corpus backfill (`kotori enrich nuance --outdated --common-only`),
   which was deliberately deferred to be a single pass (see `nuance-rework.md` B5) and is
   still pending — nothing has been backfilled at v2, so v2 can be skipped entirely and
   the corpus goes straight from v1 to v3.

## Risks and open questions

- **Request size.** Six senses × ~15 questions plus up to 16 candidate questions ≈ 100+
  questions and a large state in one request. The SDK types document no per-request
  limit; confirm against TypeSafe's API docs before assuming. If there is one, chunk by
  sense groups (still far fewer calls than today). Watch the 30s client timeout
  (`Jev.ts`) — a whole-entry request may need it raised.
- **Failure granularity.** Today a failed sense fails the entry job anyway (the whole
  `enrich` effect fails), so one-request-per-entry doesn't worsen retry behaviour — it
  simplifies it. No action needed, just don't accidentally make retries re-pay
  per-sense work that succeeded.
- **`other_meanings`.** Each per-sense call today includes up to 4 other senses' glosses
  so Jev knows which meaning is being judged. In the entry request the shared state can
  carry the full sense list once instead of repeating it per sense — decide whether
  question scopes reference it ("judge sense 2 of `senses`") or embed their own copy.
- **Answer-key hygiene.** `interpretCandidates` parses `similar_{i}` keys; under the new
  scheme it receives the stripped per-sense subset, so it should not need changes —
  verify.
- **Calibration comparability.** Stored confidences from v1/v2 rows remain comparable to
  each other but not to v3; `questionsVersion` already records this. The on-view refresh
  and `--outdated` backfill handle migration; `--reinterpret` must keep working for all
  versions (it does, if stored answer shapes stay unchanged as specified above).

## Where things stand

Branch commit history (each commit typechecks and passes the full suite):

- `df16195` display prototype + per-sense notes
- `42976b7` spec (`docs/nuance-rework.md`)
- `3887bab` Phase A (derivation, `--reinterpret`, collapsed scales)
- `30229fc` Phase B (registerShape, versioning, golden set + `kotori eval`)
- `3b1d95f` Phase C (English-side nuance, loanword false friends)
- `256a1a4` English questions merged into the per-sense request (superseded by this
  refactor's per-entry request, but the `english_*` key idea and `englishAnswersOf`
  subsetting carry over)

Nothing has been run against production data yet: no migration applied, no eval
baselined, no backfill. The refactor can therefore change the v2 wire shape freely —
there are no v2 rows anywhere to stay compatible with.
