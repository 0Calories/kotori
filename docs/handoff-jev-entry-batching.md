# Handoff: one Jev request per entry, and the English side as its own job

> Rewritten 2026-10-30 after a review of the nuance rework (`nuance-rework.md`, commits
> df16195..04d5411 on local `main`) and of the previous version of this handoff. Ash's calls:
> (1) batch each entry's Japanese judgments into **one** `systemOne` request, with each
> question carrying its own scoped data in object-form `instructions`; (2) the English-side
> judgments are generated **only when a Japanese native views the entry**, so they move out
> of the nuance request into their own job. This reverses `nuance-rework.md` C2's "same
> request, single `nuance` job kind" decision.

## Ground rules (read first)

- **The local `.env` points at the production database.** `DATABASE_URL` and
  `NEON_AUTH_BASE_URL` are the production Neon branch. Never run `kotori migrate`,
  `kotori seed`, `kotori enrich`, `kotori work`, `pnpm dev` or `pnpm dev:setup` with it.
  Nothing in this checkout refuses a remote database: a guard exists only on the unmerged
  `guard-remote-database` branch.
- Run checks with the `.env` kept out of the environment:
  ```sh
  export NX_LOAD_DOT_ENV_FILES=false
  unset DATABASE_URL DATABASE_URL_UNPOOLED NEON_BRANCH NEON_AUTH_BASE_URL NEON_AUTH_JWKS_URL \
        ANTHROPIC_API_KEY TYPESAFE_API_KEY ELEVENLABS_API_KEY RESEND_API_KEY
  pnpm nx run-many -t typecheck && pnpm nx run-many -t test && pnpm exec oxlint
  ```
  Tests run on PGlite in memory, and the paid providers are fakes.
- `pnpm --filter @kotori/db generate` (drizzle-kit) only diffs `src/schema` against the
  migration snapshots and connects to nothing. It's the way to write migrations. Never edit
  an existing migration: add a new one, so the chain is correct whether or not the earlier
  ones have been applied somewhere.
- **`kotori eval` is the only command that may call a paid API.** It calls TypeSafe, which
  costs about a cent per full run. It needs `TYPESAFE_API_KEY`. It goes through `WorkerLive`,
  which builds `DatabaseLive`, so it must **not** see the production `DATABASE_URL`. Point
  `DATABASE_URL` elsewhere: an unreachable URL if the pool connects lazily, otherwise a
  throwaway `postgres:18-alpine` container on port 55432. Environment variables beat `.env`.
  The compose Postgres doesn't start, and the fix (`docker compose down -v`) deletes Ash's
  data: don't. If the eval can't run safely, skip it and say so.
- Don't push. Pushing `main` deploys production and runs migrations (`ci.yml`, `fly.toml`
  `release_command`). Don't commit either: leave the work uncommitted for Ash to review.
  Record what you did, step by step, in "Where things stand" at the end of this file.
- Ignore `.claude/worktrees/`: other sessions' checkouts.

## What TypeSafe charges and allows (docs.typesafe.ai, read 2026-10-29)

Start at <https://docs.typesafe.ai/llms.txt>; appending `.md` to a page path gives
Markdown. The `typesafe-ai` skill points at the right pages. Facts the design depends on:

- **Billing is input tokens only**, $0.042 per million for jev-1.13.0 and jev-1.14.0. There
  is no per-request fee. State is ingested once per request, and each question's
  instructions and criteria are billed separately. So data in a question's
  object-form `instructions` is paid once per question that carries it. **Batching doesn't
  save money:** about 94% of a nuance request is question text, so scoped data costs
  slightly *more* than today. The gains are one round trip per entry instead of up to six
  (today's six senses at concurrency 3 run in two waves while a learner waits), fewer
  requests against the per-organization requests-per-second limit during the backfill, and
  simpler failure handling. Never strip evidence out of a scope to save tokens.
- **Limits:** 64k tokens per request (state plus all questions) and 32k per question (state
  plus that question). Request bodies can be up to 32 MiB, and there's no cap on the
  number of questions. A Japanese-only entry request is about 20k tokens worst case:
  6 senses × 10 questions plus 3 senses × 8 candidates × 2 questions. That's well under
  the limit, and the 30s client timeout in `Jev.ts` is fine, since questions run in
  parallel and a call typically takes about 100 ms.
- **Every question sees the whole `state`;** there is no per-question scoping. Per-item data in
  object-form `instructions` is an endorsed pattern (the duplicate check in
  `primitives/noul.md`). Answers don't influence each other ("batching adds no noise"),
  but irrelevant state content lowers accuracy (context rot), so keep the shared state
  small.
- **Question keys are not sent to the model.** `s0_formality` tells Jev nothing, so every
  scope must say in its content which sense, gloss or candidate it's about.
- Backticked references (`` `meaning` ``) can point into the instructions object. What happens
  when a name exists in both the state and an instructions object is undocumented, so
  **never reuse a state key inside a scope.**
- **jev-1.14.0** shipped 2026-10-14, and `jev-latest` points to it. Kotori pins
  `jev-1.13.0` (`packages/nuance/src/Jev.ts`, env `KOTORI_JEV_MODEL`). Bump the pin together
  with the question change below, so one refresh covers both. Rows record their `model`.
  `fly.toml` doesn't set `KOTORI_JEV_MODEL`; whether a Fly secret does is Ash's to check.
- **Language:** "Jev's primary training language is English; other languages, including CJK
  scripts, are accepted but currently have lower accuracy" (`concepts/state.md`,
  `models.md`). That makes the golden eval and its measured thresholds the only evidence
  the judgments are right. Keep the instructions in English and keep the romaji in
  `reading`.

## Already fixed (2026-10-30, uncommitted)

Four bugs are fixed in the working tree, with tests: three from the code review and one
from checking our Jev usage against the docs. Fixes 2 and 3 are **interim**, and step 3
below replaces them.

1. **On-view refresh of outdated nuance never fired for finished jobs.** `JobsRepo.enqueue`
   only revives *failed* jobs, so a `done` job with v1 rows stayed done.
   `Dictionary.enrichmentFor` now `requeue`s a `done` nuance job whose rows predate
   `QUESTIONS_VERSION`, and `enqueue`s in every other case. `requeue` isn't used for
   queued jobs because it resets `attempts` and `runAfter`, so polling would defeat retry
   backoff. `saveNuance` replaces all of an entry's rows, so this happens once per version.
   Test: `apps/api/test/dictionary.test.ts` "queues a finished nuance job again…".
   **Keep this, and give the English job the same logic.**
2. **The English page showed judgments about a different word.** Jev judged each sense's
   first gloss (`english_word = glosses[0]`), but `Dictionary.english()` attached that row
   whatever gloss matched. "smart" isn't the first gloss in 10 of the 11 common senses
   that list it, "naive" in 8 of 10, and "style" in 17 of 19. `english()` now sends
   `english: null` unless `match.position === 0`. That stops wrong chips but loses most of
   the coverage. **Step 3 replaces it with per-gloss judgments.**
3. **Loanword prose was missing for entries that already had examples.** Only the examples
   job wrote `loanWord`/`loanTrap`. It read the verdict when it started, so it lost the race
   whenever nuance hadn't finished, and it never re-runs for entries with examples. Re-running
   it would delete the sentences and their audio (`saveExamples` deletes, and audio links
   cascade). Now `packages/ai/src/LoanWriter.ts` is a small Claude call made by the
   **nuance** job (`apps/worker/src/Enrichers.ts` `loans`) right after the verdict, once per
   diverging sense. The examples prompt and schema no longer mention loans. A Claude failure
   fails the job, and the retry re-asks Jev, which is cheap. Tests: `apps/worker/test/work.test.ts`
   "names a drifted katakana loan…", `packages/ai/test/exampleWriter.test.ts` "LoanWriter.write".
   **Step 3 moves the call into the English job.**
4. **The derived "stiff between friends" caution read `confidence` as a probability.**
   `stiffBetweenFriends` (`packages/nuance/src/interpret.ts`) took the `confidence` of
   whichever judgment said formal, 尊敬語/謙譲語 or written. But `confidence` measures how
   peaked the distribution is, not how likely a label is (`confidence.md`). So a word split
   0.5/0.45 between 尊敬語 and 謙譲語 had low confidence, and got no caution, although Jev
   put 0.95 on "it's keigo". It now takes the probability mass on the stiff levels and
   options; a JMDict tag still decides outright. It's an interpretation change, so
   `--reinterpret` applies it to stored rows without Jev. Test: `packages/nuance/test/nuance.test.ts`
   "derives the stiff-between-friends caution…".

## How to write the questions (from the primitives docs)

Read `primitives.md`, `primitives/{choice,score,noul,advanced}.md` and
`model-jaggedness/jev-1.13.md` before writing v3 questions. They give these rules, and say
where today's questions break them:

- **Pick the type by the shape of the answer.** Choice is for "a known set of options with
  no order between them". Score is for "a position on a spectrum you can describe in
  steps", and a rare extreme gets its own top level. Noul is for one clean yes/no.
  - `english_strength` (none → mild → strong → avoid) and `english_register` (casual →
    neutral → formal) are spectra asked as Choices. Make them Scores, with levels that
    describe situations the way `formality`'s do, keeping `avoid` as the top level. Show
    them as chips by rounding the score to the nearest level, which the Score page endorses.
  - Japanese `formality` and `medium` are already Scores. `connotation`'s mixed case
    (probability on both negative and positive) means something, so it can stay a Choice.
- **Score levels are judged one at a time.** The model never sees a level's number or its
  neighbours. So each level must stand alone, describe a situation rather than a degree,
  and stay on one dimension. Never write "more than the previous level".
- **Don't make "none of the above" an option.** The Choice page warns it "may not work
  well" and suggests a companion Noul that checks whether anything fits.
  - Jev also isn't trained to generate: "extract possible options … and let jev pick".
  - The old `english_loan` broke both rules at once. It asked Jev to recall a loanword,
    then had `no_loan` compete with `matches`/`diverges`. Design B's code-found candidates
    plus noul plus choice is the documented shape.
- **Option order biases jev-1.13 toward the first option.** The docs say to "reorder the
  options to double check that the answer stays consistent".
  - Every Kotori Choice lists its default first: `keigo` `none`, `gender` `neutral`,
    `age` `any`, `currency` `current`, `connotation` `neutral`, `registerShape` `scaled`,
    `english_variety` `universal`, and `DIFFERENCES` `more_casual` among ten options. So
    the bias pushes toward the uninformative answer.
  - Give the eval an order check: ask each Choice again with its options reversed, under a
    second key in the same request, and report per-dimension disagreement.
  - If a dimension flips often, on jev-1.14 as well, mitigate it. For example, ask both
    orders in production and average the probabilities; it only costs tokens.
- **Noul thresholds:** the docs suggest starting at 0.7 for yes and 0.3 for no, and set
  the cut from the cost of being wrong. 0.5 means the model "gives yes and no equal
  probability".
  - `interpretCandidates` keeps similar words at `noul >= 0.5`, which is a coin flip. Raise
    it to 0.7 unless measurements say otherwise.
  - Nothing measures similar words today. Add a small golden set of pairs with expected
    `similar` and `difference` values (食べる/食う → more_casual, 食べる/召し上がる →
    respectful).
- **Never read `confidence` as the probability of a label.** Use `probabilities`, as fix 4
  does. Gating display on confidence, the way the app's chips do at 0.55, is the documented
  use. The thresholds should come from the eval.
- **Put code-built data in named fields of an instructions object, not in string
  templates.** That is the scoped-question design below. The docs add that supplementary
  data is what keeps questions with similar instructions distinct: exactly the per-sense
  case. When the eval shows two options confused, give them object descriptions with fields
  like `what`, `not_for` and `examples`, as `formality`'s levels already do.
- **Don't hide several judgments in one question.** `difference_{j}` picks one "main
  difference" from overlapping dimensions (register, medium, specificity, feeling), so a
  word that is both more formal and more literary splits its probability. If the eval or
  the order check shows that, ask one question per dimension for each pair and combine
  them in code (the docs' composite-scoring pattern).

## Target design

### A. Japanese: one request per entry, scoped questions

- **Shared `state`, entry-wide only:** `word`, `reading` (with romaji, as now),
  `other_forms`, and `senses`: each judged sense's first three glosses, joined. `senses`
  replaces the per-sense `other_meanings` contrast field. Nothing sense-specific goes in
  the state.
- **One question set per sense** (the first `MAX_SENSES = 6`), keyed `s{i}_{name}`. Each
  question's `instructions` becomes an object: the existing wording under `question`, plus
  the sense's scope: `meaning` (glosses joined), `part_of_speech`, `dictionary_notes`. The
  wording must identify the sense by content, e.g. "the meaning being judged is `meaning`,
  one of the senses in `senses`". Keep `SUBJECT_NOT_REGISTER` and all the accumulated
  wording; only the plumbing changes.
- **Similar-word questions** (`s{i}_similar_{j}`, `s{i}_difference_{j}`, senses below
  `SIMILAR_SENSES = 3`, up to `MAX_CANDIDATES = 8`) carry the judged sense's `meaning` and the
  candidate (`candidate_word`, `candidate_reading`, `candidate_meaning`, or a nested
  `candidate` object). Today they point at `` `candidates[i].word` `` in the state, and that
  array goes away.
- **Answers:** split by prefix, strip it, and store each sense's subset in the shape stored
  today (`formality`, …, `similar_0`, `difference_0`). Then `interpretSense`,
  `interpretCandidates` and `--reinterpret` keep working on v1, v2 and v3 rows alike.
- **`QUESTIONS_VERSION` → 3, and the model → `jev-1.14.0`.** The scoping changes what the model
  sees, so treat it as a question change.
- `state.ts` splits into `entryState` and per-sense scope builders, exported, so the eval
  sends exactly what production does.

### B. English: its own job, on view, per gloss

- **When:** only for a Japanese native, meaning the viewer's profile has
  `targetLanguage === "en"`, the condition the app already uses to show English notes
  (`apps/app/app/entry/[id].tsx`).
  - `entry` and `enrich` in `apps/api/src/http/handlers.ts` don't read `CurrentUser` today,
    but the dictionary group runs behind `Authorization`, so
    `Effect.flatMap(CurrentUser, (user) => …user.profile)` works as in the other groups.
    Pass the viewer into `enrichmentFor`.
  - `english()` (the English page) can always queue for its top `ENGLISH_ENRICHED = 3`
    entries, since only target-English users reach that page
    (`apps/app/app/(tabs)/index.tsx:358`).
  - There is **no English corpus backfill.** Lower meanings get judged when someone opens
    them.
- **Job kind:** add `english` to `job_kind` (`packages/db/src/schema/enrichment.ts:222`) with a
  new migration. `ALTER TYPE … ADD VALUE` can't be used in the transaction that adds it,
  so nothing else may reference the new value in that migration. Then add it to
  `Enrichers.available` (when Jev is configured) and `Enrichers.run`, and add `english` to
  the domain's `Enrichment` (`packages/domain/src/Dictionary.ts:101`) so the entry page
  polls while it's queued (`apps/app/src/api/queries.ts:41`).
  - For viewers who aren't Japanese natives, don't report a status that makes the app poll
    for something it won't show.
  - Refresh on view the way fix 1 does, with its own `ENGLISH_QUESTIONS_VERSION`, so
    rewording one side never re-judges the other.
- **What it judges, and the key:** each of the first 4 glosses of each of the first 6 senses,
  keyed `english_nuance (entryId, sense, gloss)`. Add a migration that adds `gloss` and
  changes the primary key; don't edit `20261029214507_english_nuance`.
  - The shared state has `word`, `reading` and `senses` (as in A). Each gloss's scope has
    `english_word` (the gloss) and `meaning` (the sense's glosses).
  - Variety and currency keep their wording from `english.ts`, re-plumbed as in A. Strength
    and register become Scores (see "How to write the questions").
  - At most 6 × 4 × 4 questions plus loan pairs, about 12k tokens.
- **Loanwords: select instead of generate.** Have code find each gloss's katakana loan
  candidates, and ask Jev to judge a named pair rather than recall the loan.
  - **Where candidates come from:** `lsource` names the English source word when it differs
    from the glosses: マンション←mansion, ナイーブ←naive, カンニング←cunning,
    タレント←talent. Otherwise a katakana-headword entry has the word as a gloss: スタイル's
    second sense is "style", テンション's is "tension", and スマート carries no `lsource`.
    `lsource` isn't imported today (`packages/jmdict`, the `senses` table). Importing it means
    a parser change, a column, a migration, and Ash re-running the JMDict import in
    production. Make the code work without it (gloss matches only) until then. JMDict's
    `ls_wasei` flag (和製英語) is worth keeping while you're there.
  - **The questions:** a noul, "is `katakana_word` the everyday katakana loanword of
    `english_word`?", and a choice, "does its everyday Japanese meaning match
    `english_word` in `meaning`?" (`matches` / `diverges`). The katakana entry's own glosses
    go in the scope as evidence of its everyday meaning.
  - **Why the noul is needed:** gloss matching gives false candidates (トラック has the gloss
    "lorry").
  - **Interpreting:** no candidate, or a noul below 0.7, means `no_loan`. 0.7 is the docs'
    starting point; tune it on the eval, because a false "diverges" warning costs trust in
    the feature (`nuance-rework.md` C3). With several candidates, keep the likeliest.
  - `loanWord` is the candidate's headword, from the dictionary. `LoanWriter` shrinks to
    writing `loanTrap` only, for a confident `diverges`, at ≥ 0.55 like the app.
  - Remove the interim `loans` step from the nuance job.
  - If the eval shows that gloss-only candidates miss too many golden loans, ask the old
    recall question for glosses with no candidate.
- **Display:** `Sense.english` (entry page) is the first gloss's judgment, matching the audio
  button, which speaks the first gloss. `EnglishMeaning.english` (English page) is the
  judgment for `match.position`, replacing fix 2's `position === 0` gate. Fix the doc
  comment on `EnglishMeaning.english`.
- **Removed from the nuance request:** `englishQuestions`, `english_word` in `senseState`,
  and `englishAnswersOf`.
- **Not moved:** `noteJa` stays in the examples call, where it costs a few output tokens
  in a call that runs anyway.

## Order of work

1. **Goldens from real data, eval through the production builders.**
   - **Why:** today's eval compares nothing useful.
     - `goldenState`/`goldenEnglishState` hand-mirror the production state, and
       `evaluate.ts:115` calls `interpretSense(answers, [])` without JMDict tags. 31 of the 77
       Japanese goldens checked have sense-0 tags that production uses and the eval drops
       (ございます is tagged `pol`).
     - 13 of the 37 English goldens have a `meaning` whose first word isn't the judged word
       (lift→elevator, fall→autumn, candy→sweets, smart→intelligent), unlike production.
   - **What to do:**
     - Write a script that reads `data/jmdict/JMdict_e.gz` (local, no database) and writes a
       fixture of each golden's real entry id, sense, glosses, POS and tag labels.
     - Build a synthetic `EntryRecord` from it and send it through the exported production
       builders.
     - Interpret with the real tags. Report Jev-decided and JMDict-decided dimensions
       separately, so overrides don't inflate Jev's accuracy.
     - Golden loan items name their expected katakana candidate. The candidate lookup gets
       its own PGlite test.
     - Add the **option-order check** and the **similar-word golden pairs** from "How to
       write the questions".
   - Then run the **v2 baseline** of both evals, if it can run safely (see ground rules):
     `kotori eval nuance --record …` and `kotori eval english --record …`. Keep the record
     files out of git unless Ash wants them.
2. **Japanese per-entry request (A),** v3 and jev-1.14.0, applying "How to write the
   questions". Raise the similar-word threshold. Update the fakes in
   `packages/nuance/test/nuance.test.ts` and `apps/worker/test/work.test.ts` for the `s{i}_`
   keys. One ask per entry, so the two-sense test entry goes from 200 input tokens to 100.
3. **English job (B),** with its migrations, API, domain, app polling and display. Move
   `LoanWriter` over, and add the `lsource` import if you get to it. Strength and register
   become Scores.
4. **Re-run both evals,** and compare per-dimension accuracy and confidence against the
   baseline. If a dimension regresses, the scope for that question probably lost a field the
   old shared state gave it implicitly. Suspects: `dictionary_notes` for formality and
   medium, and the `senses` contrast for sense disambiguation.
5. **Stop.** Ash does the operational steps below.

## For Ash after review (not for the implementer)

- **Get these commits off `main` before anything is pushed.** A push deploys and migrates
  production. Then open a PR.
- After deploying:
  - re-import JMDict if `lsource` was added;
  - run `kotori enrich nuance --outdated --common-only` (v1 → v3 directly, since no v2 rows
    exist; a few dollars of Jev at the token rates above);
  - run `kotori enrich nuance --reinterpret` (free, no Jev): it applies fix 4 to stored rows
    the backfill doesn't re-judge, such as non-common entries;
  - check the Fly secrets for a `KOTORI_JEV_MODEL` override.
- **Not in this plan:** the formality slider plots `score / 4` as an exact point. The Score
  docs say jev-1.13's levels are "weak in numerical calibration" between levels, and suggest
  using the score to rank, threshold or round. Snapping the marker to a level, or drawing the
  spread from `probabilities`, would show only what Jev actually judged.

## Where things stand

- Local `main`, unpushed, each commit green: `df16195` display prototype and per-sense notes,
  `42976b7` spec, `3887bab` Phase A, `30229fc` Phase B, `3b1d95f` Phase C, `256a1a4` English
  questions merged into the per-sense request (superseded by B), `04d5411` the previous
  handoff.
- Uncommitted: the four fixes above, this rewrite, and a superseded note in
  `nuance-rework.md` C2/C3.
- Nothing has run against production: no migration, no eval, no backfill. As long as
  nothing is pushed, there are no v2 rows anywhere.
- Implementer's log: (append here)
