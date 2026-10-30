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
- **Steps 1–4 done (2026-10-30, uncommitted, everything green).** Step 1: real goldens,
  production builders, the order check and the similar-word pairs; the v2 baseline ran on
  both models. Step 2: one Jev request per entry, v3, jev-1.14.0. Step 3: the `english` job,
  judged per gloss with code-found katakana candidates, and the `lsource` import. Step 4:
  both evals re-run; results below. Three new migrations (`20261030152820_loan_sources`,
  `20261030152833_english_job_kind`, `20261030152851_english_nuance_per_gloss`), none
  applied anywhere.
- The eval never saw a database: every run had `DATABASE_URL` and `NEON_AUTH_*` pointed at
  `127.0.0.1:9`, the other provider keys set to dummies, and only `TYPESAFE_API_KEY` read
  from `.env`. Seven paid runs, 1.33M input tokens in all, about 6 cents.
- Implementer's log: (append here)

### Step 1: real goldens, production builders, order check, pairs

- **Golden set** (`packages/nuance/src/golden.ts`): every golden names an entry id and sense
  (English goldens also the gloss judged). The entries live in a committed fixture,
  `packages/nuance/golden/entries.json`, cut from `data/jmdict/JMdict_e.gz` by
  `tools/golden-fixture.ts` (`pnpm golden`; reads only the file, no database). The tool
  checks each golden against JMDict: the entry exists, the word is one of its forms, the
  sense is one Kotori judges, the English word is one of its first `MAX_GLOSSES` glosses.
  The fixture is slim (spellings, judged senses' glosses, POS and tag codes, tag labels, and
  since step 3 each English word's loan candidates; 86 KB) and `goldenEntry` builds the
  synthetic `EntryRecord`; full records were 12k lines.
  `test/golden.test.ts` fails if the golden set and the fixture drift apart.
- **Remapped goldens.** Senses were picked to match each golden's meaning: やばい is sense 2
  ("terrific; amazing"), the one the slang expectation is about; 了解 is sense 1 ("OK;
  roger"), the 了解です to a boss. 拝見する and ご逝去 aren't entries: they are 拝見 and 逝去.
  Two English goldens had no JMDict entry carrying them as a leading gloss: "whom" became
  "motorcar" (自動車, `currency: dated`) and "wanna" became "guy" (やつ, `register: casual`,
  `currency: current`). Other English goldens moved to entries that really carry the word:
  naive→甘い sense 4, juice→汁 (果汁's gloss is "fruit juice"), table→卓 (机 is "desk"),
  flat→部屋, crap→うんこ sense 1, fuck→はめる sense 5. Loan goldens name the expected
  katakana word (`loanWord`); coffee's is its own entry, コーヒー.
- **Eval** (`apps/worker/src/commands/evaluate.ts`, requests in
  `packages/nuance/src/evaluation.ts`): interprets with the entry's real tags and reports,
  per dimension, accuracy where Jev decides what is shown, where a JMDict tag decides, and
  Jev's own answer with tags ignored. A caution counts as tag-decided when a tag changed
  it. Each golden request carries only that sense's questions (answers don't depend on
  the other questions in a request), so the eval pays for one sense, not six.
- **Option-order check:** every Choice is asked a second time with its options reversed,
  under `name~reversed` in the same request. The report gives flips (the two orders
  disagree) and how many flips went to each order's first option.
- **Similar-word pairs:** 20 pairs (`GOLDEN_PAIRS`), 17 near-synonyms with acceptable
  differences and 3 related non-synonyms, reported at p ≥ 0.5 and ≥ 0.7.
- **English v2 baseline judges the golden gloss.** v2 production judged only each sense's
  first gloss; the eval puts the golden gloss in `english_word`, so v2 and v3 are measured on
  the same items with their own questions.
- **Recordings** are in `data/eval/` (gitignored): `v2-jev-1.13.0-{nuance,english}.{json,txt}`
  and the same for jev-1.14.0. `kotori eval … --from <file>` reinterprets one offline.
- **Found while building it, not fixed (Ash):**
  - いらっしゃる (1000940) imports with the headword 居らっしゃる, a search-only (`sK`) form:
    `chooseHeadword` falls back to `kanji[0]` when no kanji form is visible, instead of the
    reading. Jev, and learners, see 居らっしゃる.
  - JMDict tags お茶 `pol`, which `KEIGO_TAGS` reads as teineigo; the golden says bikago.
    よろしい is tagged `hon`, which `FORMALITY_TAGS` reads as formal; the golden says
    polite. Both are tag-decided misses, so they don't count against Jev.

### Step 2: one request per entry (v3, jev-1.14.0)

- **Builders** (`packages/nuance/src/state.ts`, `questions.ts`): `entryState` (word, reading
  with romaji, other forms, each judged sense's first three glosses as `senses`),
  `senseScope` (`meaning`, `part_of_speech`, `dictionary_notes`) and `candidateScope`
  (`candidate_word`, `candidate_reading`, `candidate_meaning`; flat keys, so nothing nested
  reuses a name). `entryRequest` keys every question `s{i}_{name}` and `answersOfSense`
  strips the prefix, so rows keep the shape stored today and v1/v2/v3 rows interpret alike.
  `senseState`, `other_meanings` and the `candidates` state array are gone.
- **Wording:** each question's existing text sits under `question`, beside the scope and a
  `focus` line that names the sense by content ("The word has the senses listed in
  `senses`. Judge only the sense whose meaning is `meaning`; …"). The difference question
  now says "with the meaning in `meaning`", which it had left to the old per-sense state.
- **Version and model:** `QUESTIONS_VERSION` 3, history line included; `jev-1.14.0` is the
  default in `Jev.ts`, `.env.example` and the README (whose nuance paragraph was out of date
  and is rewritten). The model stays a pinned ID, not `jev-latest`.
- **Similar words** are kept at p ≥ 0.7 (`SIMILAR_KEPT`): on jev-1.14.0 every golden pair
  is right at 0.7, with v2 and v3 questions alike.
- **Order bias: no mitigation.** Flip rates are 0–5% on both models, 9% for v3's
  registerShape, and at most one flip per dimension went to each order's first option. The
  first-option lean the 1.13 docs describe doesn't show on these questions, on 1.13 or 1.14;
  registerShape's flips are near-ties between `scaled` and `fixed`. Asking both orders
  would add six Choices per sense for nothing measurable.
- **The English questions left the nuance request here, not in step 3,** together with
  `englishAnswersOf` and fix 3's interim `loans` step, so step 2 never had to scope
  questions that step 3 replaces.
- **Not done:** `difference_{j}` stays one question. It holds at 88% with 5% flips. Its two
  misses (存じる judged more_formal rather than humble, お腹 more_colloquial rather than
  more_formal) are the overlap the handoff describes, but splitting it into a question per
  dimension would add about ten questions per candidate for two misses in 17.

### Step 3: the `english` job, per gloss, with code-found loans

- **When:** `Dictionary.entry`/`requestEnrichment` take the viewer (`CurrentUser`'s profile).
  The English job is queued only for viewers with `targetLanguage === "en"`, and refreshed
  on view like fix 1, by `ENGLISH_QUESTIONS_VERSION`. `english()` always queues it for its
  top three entries. **Non-natives see `english: "unavailable"`**, even while a job runs
  for someone else, so their app never waits for it. No backfill command.
- **`ENGLISH_QUESTIONS_VERSION` starts at 3, not 1:** rows from the merged v2 request carry
  `questionsVersion` 2, and a lower current version would never refresh them.
- **Schema:** `job_kind` gains `english` in a migration of its own; `english_nuance` gains
  `gloss` (default 0, so v2 rows read as the first gloss they judged) and the key
  `(entry_id, sense, gloss)`; drizzle-kit wrote all three migrations.
- **Questions** (`packages/nuance/src/english.ts`): variety and currency keep their wording;
  strength (none, mild, strong, avoid) and register (casual, neutral, formal) are Scores
  whose levels describe situations, `avoid` its own top level. Each gloss carries
  `english_word` and `meaning`; the state is `word`, `reading` (with romaji) and `senses`.
  Scores show as chips by rounding.
- **Loans:** `DictionaryRepo.loanCandidates` finds common, katakana-only headwords with the
  English word as a gloss or as their `lsource`, most frequent first, at most three per
  gloss (`loanCandidatesIn` is the same rule over parsed entries; the PGlite test checks they
  agree). Per candidate a Noul ("is `katakana_word` the everyday katakana loanword of
  `english_word`?") and a Choice (`matches` first, `diverges`), with examples kept out of
  the golden set. The candidate's scope carries its senses' translations with their usage
  notes ("tension [physics]") and the wasei-eigo mark. Interpretation keeps the likeliest
  candidate at p ≥ 0.7; a candidate JMDict names as the source counts as the loan outright,
  as tags override Jev on the Japanese side. `loanWord` is the candidate's headword; each
  row's answers store the candidates asked about, so `--reinterpret` can re-derive it.
- **Decisions:**
  - The entry itself can be its own candidate: コーヒー is the loan of "coffee", and
    テンション's own "tension" sense is the trap. The app hides the "same as the katakana
    word" chip when the loan is the word on screen.
  - Uncommon katakana words aren't candidates, since an everyday loan is a common one.
  - No recall fallback for glosses without a candidate: gloss matching misses exactly the
    three `lsource` loans (mansion, naive, cunning), and with `lsource` every golden loan
    has its candidate.
- **`lsource` import:** the parser keeps a sense's English sources (not `ls_type="part"`,
  not other languages) and its `ls_wasei` flag in `senses.sources` and `senses.wasei`.
  Until JMDict is re-imported, the lookup works on gloss matches alone.
- **Claude:** `LoanWriter` writes only `loanTrap`, for a `diverges` at confidence ≥ 0.55,
  once per English word and loan, in the `english` job after the verdict; a re-judge naming
  the same loan keeps the sentence (`saveEnglishNuance`'s upsert), another loan clears it.
- **Display:** `Sense.english` is the first gloss's judgment; `EnglishMeaning.english` the
  judgment for `match.position` (null past `MAX_GLOSSES`), replacing fix 2's gate. The entry
  page's waiting banner includes the English job.
- **`kotori enrich nuance --reinterpret`** also re-derives English rows of the current
  English question set; older ones are re-judged when viewed.
- **One iteration on the loan wording, measured:** the first v3 run (recorded as
  `data/eval/v3a-jev-1.14.0-english.*`) judged テンション, シール, スタイル, ジュース and
  ナイーブ to match. Their dictionary translations repeat the English word ("tension",
  "seal"). Adding the usage notes, a line saying dictionaries list the source word even
  where use has drifted, and JMDict's word on sources raised loan accuracy from 70% to 85%,
  with no matching loan turned into a warning.

### Step 4: results (v2 on jev-1.13.0, v2 on jev-1.14.0, v3 on jev-1.14.0)

Accuracy where Jev decides what is shown; flips with options reversed in brackets.

| dimension | v2 · 1.13 | v2 · 1.14 | v3 · 1.14 |
|---|---|---|---|
| formality | 93% (39/42) | 93% (39/42) | 90% (38/42) |
| medium | 94% (16/17) | 94% (16/17) | 94% (16/17) |
| keigo | 1/1 [0%] | 1/1 [1%] | 1/1 [3%] |
| gender (all JMDict-decided) | — [3%] | — [1%] | — [0%] |
| age | 3/3 [3%] | 3/3 [3%] | 3/3 [0%] |
| currency | 6/6 [4%] | 5/6 [1%] | 6/6 [4%] |
| connotation | 3/3 [4%] | 3/3 [1%] | 3/3 [4%] |
| registerShape | 86% (6/7) [3%] | 86% (6/7) [3%] | 86% (6/7) [9%] |
| rudeToSuperiors | 97% (29/30) | 97% (29/30) | 93% (28/30) |
| stiffWithFriends | 86% (18/21) | 86% (18/21) | 85% (17/20) |
| slang | 4/4 | 4/4 | 4/4 |
| difference (pairs) | 88% (15/17) [5%] | 88% (15/17) [5%] | 88% (15/17) [5%] |
| similar at 0.7 | 90% (18/20) | 100% (20/20) | 100% (20/20) |
| English variety | 83% (5/6) [3%] | 83% (5/6) [0%] | 83% (5/6) [3%] |
| English strength | 5/5 | 5/5 | 5/5 |
| English currency | 3/3 | 3/3 | 3/3 |
| English register | 4/4 | 4/4 | 4/4 |
| English loan | 50% (10/20) [3%] | 50% (10/20) [5%] | 75% (15/20) now, 85% (17/20) with `lsource` [3%] |

- JMDict-decided judgments are 95% (formality), 100% (medium), 88% (keigo: お茶), the same
  on every run. Mean confidence moved little; English loan confidence rose from 0.57 to 0.81.
- **The model alone** (v2, 1.13 → 1.14) changed one currency golden (銀幕, dated → current at
  0.52/0.48) and the similar-word cut-off (two pairs that sat at 0.66–0.69 rose above 0.7).
- **The scoping** (v2 → v3 on 1.14) moved formality by one golden and rudeToSuperiors by one.
  Each change is a rounding-boundary flip with an almost unchanged distribution: 死ぬ's
  score went 1.52 → 1.46 (neutral → casual) and its rude-to-superiors noul 0.55 → 0.65;
  遺憾 went 3.54 → 3.44; 浣腸 went the other way, 2.69 → 2.48 (polite → neutral, now right).
  No field went missing from a scope. Reading formality by its most likely level instead of
  the rounded score would score 40/42 for v3 and 41/42 for v2 · 1.14, and is free to try
  with `--from` and `--reinterpret`.
- Request size: the eval's Japanese requests cost 46% more input tokens (436k against
  298k), as the handoff predicted. A six-sense entry is about 15k tokens before candidates,
  about 25k with a full set (estimated). The English request is 12–13k for 行く or 見る,
  about 37k if every gloss had three katakana candidates, and at most about 48k (24 glosses
  × 10 questions), under the 64k limit.

### For Ash, from this work

- **Re-import JMDict** for `senses.sources`/`wasei`; until then the English job finds loans
  by gloss alone and misses マンション, ナイーブ, カンニング and the like.
- **Deploy the API before (or with) the app:** `Enrichment` gained `english`, and an app built
  with it can't decode an older API's response.
- **The English goldens overlap the question examples:** all six variety goldens, four of
  five strength goldens, all four register goldens and one of three currency goldens appear
  as examples in their own question's criteria, in v2 and v3 alike, so those scores say
  little (candy is missed although it is an example). The loan section is clean. Goldens
  that aren't examples would measure generalisation.
- **Debatable goldens:** スタイル and ジュース still come out `matches`, and both words do
  carry the English sense in everyday use (ヘアスタイル, fruit juice). ナイーブ ("innocent;
  sensitive") is a true miss.
- Fixes 2 and 3 are gone: replaced by per-gloss rows and the English job, as planned.
