# Dictionary enrichment: implementation plan

Tracks the build-out of [the enrichment model](dictionary-enrichment-model.md). One commit per phase, on one branch, deployed together at the end. The private beta can take brief disruption, so phases need not keep the old page working beyond their own commit.

Status key: ☐ not started · ◐ in progress · ☑ done

## Decisions

- The import downloads JMdict_e_examp (Tatoeba) like the other seeds; nothing is committed to `data/`.
- An Ask Kotori proposal has exactly the dictionary entry's data model (labels, patterns, examples, pitfalls, sources). It differs only in that it waits for approval before it becomes a real entry.
- Loan links store both `same` and `divergent` verdicts. `same` drives the English "same as 「アドバイス」" chip.
- Phases 1–7 come before the inference passes (Phase 8). The product is correct on dictionary data alone.
- Seeded example sentences have no formality (null), never a guessed one: voice casting needs the real register to sound natural. Casting learns to handle them in Phase 6.

## Phases

### ☑ Phase 1 — New tables, additive

- `source` enum shared by every new table.
- Label vocabulary (`LabelCode`, severity) in `@kotori/db`, the single place severity is defined.
- Tables: `labels`, `patterns`, `pitfalls` (rank 1–3, so the cap is a constraint), `usage_evidence`, `loan_links` (one row per katakana ↔ English pair, both entry ids nullable).
- `examples.source` (existing rows are `kotori`); `examples.model` nullable for seeded sentences.
- Relations for the new tables. No reader or writer yet; nothing dropped.

### ☑ Phase 2 — Deterministic import

- `entries.dictionary` names the source of an entry's senses (`jmdict`, `enwiktionary` for curated words, `jawiktionary`, or `kotori` for approved Ask Kotori words). Labels and patterns carry it as their source.
- `insertEntries` rebuilds the labels and patterns read from the senses (`misc`, dialects, `wasei`, `info`) on every insert. Rows from other sources (Kotori, learners) are layered on top and follow their sense when a re-import moves senses; a dictionary label replaces Kotori's on the same code.
- With `{ seeded: true }` (the importers), seeded example sentences and usage evidence are synced too: sentences keep their ids across re-imports. Re-inserting a stored entry (aliases) leaves them alone.
- The import downloads `JMdict_e_examp.gz` in place of `JMdict_e.gz`: the same entries plus 32k Tatoeba pairs. Japanese Wiktionary gives 5k English pairs.
- `linkLoans` runs after each dictionary import: adds the pairs JMDict names, drops those it no longer names, and resolves the English entry.
- Claude's examples job replaces only Kotori's sentences, and still runs for words that have only seeded ones. Seeded sentences are not voiced yet.
- The label vocabulary gained the codes the data uses: JMDict's other dialects, English regions, `m-sl`, `sens`, `nonstd`, `proverb`, `yoji`.
- Verified on the full data: 219k JMDict entries and 52k English words in 93 s; a second seed leaves the same content. It is not a no-op: dictionary patterns are deleted and reinserted with new ids, and evidence and loan links are rewritten in place.

Findings for later phases:

- JMDict's `lsource` is mostly on wasei-eigo and coinages (2,442 pairs; 141 have an English entry). Plain loans such as アドバイス have none, so the English "same as" chip depends on Phase 8's loan verdicts.
- Wiktionary examples attach only to words whose senses come from Wiktionary. Curated words would need sense matching by gloss.
- Seeded sentences carry no furigana (no reading source); `furigana` equals the sentence.
- Tatoeba is credited in the app's credits; the per-entry sources line is Phase 5's.

### ☑ Phase 3 — Contracts and API

- `Entry` gains `dictionary`, `usuallyKana`, `labels` (the first sense's; every sense's shared ones since Phase 5), `evidence`, `loanLink` and `pitfalls` (first first, `about` resolved to the word). `Sense` gains `labels` (only what it adds to the word's), `patterns` and `similarWords`; `Example` gains `source`. Labels carry their severity, so the app needs no copy of the table.
- The old fields stay until Phase 7. The old similar-word type is renamed `JudgedSimilarWord`; the dictionary's pitfall type is `WordPitfall` (the Coach owns `Pitfall`).
- Similar words are derived on view (`similar.ts`, `usage.ts`): cross-references first, then common words close by gloss, at most four per sense, each word once under its first sense. The difference is a code the app words: `respectful`, `humble`, `more_casual`, `more_formal`, `plain`, `masculine`, `feminine`, `american`, `british`, `older`, `similar`.
- A loan link shown from either end; with several, the one with a verdict, then the most used.
- Checked on the full data: 9–30 ms per entry after the first.

Changes from the prototype, after checking on the full data:

- A gloss-close word must share two glosses with the sense, or lead with the same one. One shared gloss tied 結構 to 罰金 ("fine") and マンション to 変 ("flat").
- Only a label the other word has says how it differs. The prototype read a label only the current word has as the opposite register (ご苦労様 → お疲れ様 "more casual"; slang *eat* → devour "more formal"). Now an unmarked word beside a marked one is `plain`.
- `masculine` and `feminine` differences were added: JMDict marks 食う `male`, not casual, so 食べる → 食う said only "similar".

Findings for later phases:

- The curated English synonyms are noisy on some senses (slang *eat* lists bang, rock, slap). Cross-references are shown as the dictionary gives them.

### ☑ Phase 4 — Proposals on the entry model

- A stored draft (`DraftEntry` in `@kotori/db`) is the dictionary's model: senses with `pos`, label codes and patterns, word-level `familiarity`, and up to three pitfalls (by sense index, `about` as written). The wire `Proposal.draft` reads like an entry: `Label`, `Pattern`, `WordPitfall` and `Tag`, all source `kotori`, labels stated once as on an entry.
- Claude's output is checked before it is stored (`asks/draft.ts`): label codes outside the vocabulary dropped, pitfalls kept only of a kind valid for the direction (`PITFALL_KINDS`), about a sense that exists, non-empty, at most three; familiarity clamped to 1–5.
- A pitfall's `about` links to an entry only when exactly one word is written that way (上手 links to neither).
- Approval writes labels as `misc` and patterns as `info`, so the import reads them back as Kotori's; pitfalls are saved directly and carried in both approved files, so a reseed restores them.
- Existing drafts are migrated in SQL, nothing inferred: `currency` → `arch`/`dated` labels and familiarity 1/2/4 (as approval derived them), `partOfSpeech` → `pos`, `note` → one pattern, no pitfalls. Tested on old-shape rows.
- The golden asks test only Jev's routing, not draft content; they needed no change.
- The `DraftCard` reads the new shape; Phase 5 restyles it.

Checked with live Claude drafts (bussin, rizz, ghosting, ぴえん, 蛙化現象, 了解です), which changed the prompt twice:

- Patterns carried unverifiable origin and date claims ("アフリカ系アメリカ人の英語に由来", "around 2019–2020"). Patterns and pitfalls are now usage only.
- Pitfalls restated the slang label ("avoid it in formal settings"). The prompt now says what each register label already tells the learner.

Findings for later phases:

- Draft pitfalls are inference with no golden eval. Phase 8's pitfall golden set should cover the Lexicographer too.
- No pitfall kind fits tone strength (ぴえん's "light, never real grief" came as `set_phrase`). Decide in Phase 8 whether a `tone` kind is needed.
- A reseed replaces Kotori's pitfalls on approved words with the approved file's. Phase 8 passes must skip approved words or write to that file.
- `trendy` and `current` both migrated to familiarity 4; the distinction had no place in the new model.
- Migrated notes may hold origin claims or warnings, now shown as Kotori patterns. Review pending drafts before approving.
- Drafts can still be careless with facts (bussin's pitfall says "bussing" is spelled the same). Approval remains the gate.

### ☑ Review of phases 1–4

Two reviews read phases 1–4 before Phase 5 and found these, now fixed:

- `linkLoans` kept a stale pair when JMDict respelled the katakana word, so the entry had two links. The wanted pairs are now computed once, and the delete and the upsert both use them. It also reads only Japanese entries.
- A word the curated file takes over from Ask Kotori kept the draft's labels and notes, which then looked like Kotori's fill on a dictionary word. The insert now also rebuilds the source of the entry's old dictionary.
- Approval dropped the draft's familiarity: Japanese words never had evidence of use, and English words had it only after a reseed. Approval now writes the evidence, the Japanese approved file carries the familiarity, and the reseed replays it.
- The asks list ran a query per draft, plus the whole tag table each time. It now reads every draft, and every word they name, in a few queries.
- A cross-reference with a reading ("上手・うわて") matched any word spelled that way. The reading now picks among them; it feeds similar words.
- Draft labels the word's language can't carry (keigo or a dialect on an English word, a region on a Japanese one) are dropped, and a draft with an empty headword is refused.
- `patterns.about_entry_id` and `pitfalls.about_entry_id` have partial indexes, so deleting an entry doesn't scan both tables.
- A phase 2 test that could not fail now re-inserts the stored entry, and a moved Kotori label is tested.

Left as they are:

- Decided after Phase 5 (Ash): one sense of several no longer speaks for the word. The word's labels are those every sense carries, from the same source; a single-sense word's are its own, and each sense shows what it has beyond them.
- Two JMDict homographs that name the same English word share one link row, held by the lower id; the other entry shows no loan line.
- Gloss candidates are capped at four per sense before duplicates are removed, so a sense can show fewer similar words than exist.
- Kotori's pitfalls take the free ranks, so they can sit between pitfalls from other sources. A pitfall's `about` can name its own entry.
- Older `data/approved/ja.jsonl` lines without `dictionary` would be skipped. No such file exists yet.

### ☑ Phase 5 — Entry page

- `app/entry/[id].tsx` is rebuilt on the model. The hero has the headword, reading, "usually written in kana", the loan origin line on a katakana word, other spellings, and one chip row: the usage chip, the same-meaning loan chip on an English word, and the word's labels. Under it come the word's pitfalls as "Watch out", then the senses: glosses, the part of speech and labels that differ from the word's, subject fields, the dictionary's patterns with Kotori's beside them on a tint, examples with non-Kotori sources named, sense pitfalls, and antonyms. Then the similar words with their derived difference, and a sources line that opens the sources screen, with the ✦ legend when anything is Kotori's.
- Shared parts: `ChipRow` (`LabelChips.tsx`; chips coloured by severity that explain themselves, one at a time, on tap or hover), `Patterns.tsx`, `Pitfalls.tsx`, and the pure display logic in `lib/entry.ts`. The Ask Kotori `DraftCard` uses the same parts.
- Copy is in `strings.ts`, in both languages: a name and a one-sentence explanation for every label code, pitfall kinds, similar-word differences and source names. The `caution` severity has its own amber tokens.
- The sources screen credits the new model: the entry's dictionary (an approved Ask Kotori word says so), Kotori's notes, Kotori's, Tatoeba's and Wiktionary's sentences, similar words, audio, and a loan link that isn't the entry's own dictionary's.
- A saved word's hint is its labels that aren't grammar facts, and its note is its pitfall, else its first pattern.
- Removed: `lib/nuance.ts`, the nuance card, sliders and caution chips, the old `LoanNote`, Kotori's sense notes on the page, and the prototype (`app/proto`, `src/proto`, `test/proto.test.ts`, the unguarded routes).
- Checked in Expo web on a mock API, in both interface languages: 食う, ご苦労様, マンション, 抱く, 鑑みる (dictionary only), 候 (archaic, examples queued), advice, mansion, yep, and the rizz draft.

Changes from the plan and the prototype:

- `NuanceScales.tsx` stays: the Check tab draws a sentence's formality with it.
- "Rarely heard today" comes from familiarity ≤ 2 or an `arch`/`obs` label. `dated` words are still heard, and their label says so.
- A word with only seeded sentences still counts as dictionary-only and offers "Ask for this word": the examples job writes Kotori's sentences for it. The waiting card shows only for queued examples, not for the nuance job.
- Pitfalls and a Kotori loan verdict carry ✦ too, so the legend covers everything Kotori added.

Findings for later phases:

- An English word whose loan drifted shows nothing until Phase 8 writes its `false_friend` pitfall. The old Jev `loan` warning is no longer on the page.
- Kotori's old sense notes (`sense_notes`) are no longer shown. Words that had one show no Kotori note until Phase 8's pitfalls.
- Search results still read `EntrySummary.formality` and `currency` (`ResultRow`). Phase 7 removes them, so the result row needs labels first.

### ☑ Phase 6 — Voice casting on the new model

- Casting reads the sentence's own sense's labels, all of them and from any source (Kotori's fill included), not the word's shared ones and not `sense_nuance`: dialects and regions give the variety, `male`/`fem` the gender, `chn` a child, `sl`/`net-sl`/`m-sl`/`vulg` slang, `arch`/`obs`/`dated` an older voice, and `form` (or a subject field) makes a formal line an announcement. Nothing in casting reads `sense_nuance` now.
- `examples.speaker_gender`, `speaker_age`, `medium`, `variety` and `tone` are folded into one nullable `casting` JSONB (`Casting` in `examples.ts`), and their four enums dropped. `formality` stays a column: it is the register on the wire and casting's hard filter, and null is how a seeded sentence says it is unjudged. Two migrations: the first adds `casting` and carries every value over (a missing gender or age as `unspecified`; a sentence with no signals keeps a null `casting`), the second drops the columns. Tested by running the shipped SQL on old-shape rows.
- Seeded sentences are judged on the audio job, not a job of their own: before voicing, `AudioEnricher` sends every sentence with no formality to Jev (`judgeCasting` in `speech/judge.ts`), five questions each (formality as a score with the Coach's rubric; gender, age, medium and tone as choices), up to ten sentences per request, so one request for a typical entry. The judgment is saved and the sentences voiced in the same run. A separate job kind would have needed a new enum value, a new status on the wire and a hand-off to audio, for a call that costs a fraction of a cent.
- Never a default register: without Jev, or when Jev fails, a seeded sentence keeps a null formality and is not voiced. On a failure the rest of the entry is still voiced, then the job fails so it is retried.
- The audio status counts a sentence with no formality as still to voice when Jev is configured, so a viewed word waits for its seeded sentences; without Jev they are left out, as before.

Changes from the plan:

- Formality is the score's most probable level, not its expected score, which would turn casual-or-polite into neutral. A gender, age, medium or tone below 0.6 is dropped (`unspecified` or null): a wrong gender or a child's voice is the most audible miscast, and an unsure "humorous" would send a plain line to a comic voice.
- Jev doesn't judge a seeded sentence's variety (always null): its sense's dialect labels already give it.

Findings for later phases:

- Words already voiced are queued once more on their next look (at most hourly), to judge and voice their seeded sentences. Jev's cost is negligible; ElevenLabs characters grow by the seeded sentences of every viewed word, within `KOTORI_AUDIO_MONTHLY_CHARS`. Narrowed right after (see "After Phase 6").
- `kotori enrich audio` picks words with no headword audio, so it doesn't backfill seeded sentences on words already voiced. Viewing does.
- The examples job still passes `sense_nuance`'s register to Claude as a hint; Phase 7 removes it with the table.
- Deploy: the release command drops the old columns before the machines roll, so API and worker machines still on the old code fail to read example sentences until they are replaced.

### ☑ After Phase 6 — Voice only the sentences learners need

Decided with Ash after Phase 6:

- A seeded sentence is voiced only on a sense Kotori wrote no sentence for, where it is the example the learner hears (`sentencesToVoice` in `enrichment/voicing.ts`, used by the audio job and the audio status). Beside Kotori's it is shown but not read aloud. While the entry's examples job is still to run, its seeded sentences wait, since Kotori's may cover their senses; the job runner queues audio again once they are written.
- A finished audio job is queued again on a look only for a sentence it hasn't tried: one written since it ran, or one no run has judged (at most hourly). A sentence a run tried and couldn't voice, and a missing headword clip, are no longer retried every hour. A failed job is still retried as before.
- So the backfill on existing words covers only senses with seeded sentences and none of Kotori's.

### ☑ Phase 7 — Remove the old model

- The worker runs examples and audio only. Gone: `NuanceEnricher`, `NuanceJudge` and Jev's per-sense question sets with their `questionsVersion`s (`questions.ts`, `english.ts`, `interpret.ts`, `request.ts`, `state.ts`), `TAG_JUDGMENTS`, Claude's loan warning (`LoanWriter`), `kotori enrich nuance` (`--outdated`, `--reinterpret`), `kotori eval nuance|english`, `kotori golden` and its fixture (`packages/ai/golden`). `saidByNuance` went in Phase 5. `kotori eval asks` stays; the Choice helpers it and the triage use (`REVERSED`, `averagedChoice`) moved to `providers/choices.ts`.
- One migration (`drop_nuance_model`) drops `sense_nuance`, `similar_words`, `loan_words`, `sense_notes` and the `difference` enum, deletes the `nuance` jobs, and remakes `job_kind` without the value. Tested by running the shipped SQL on old-shape rows.
- Wire: `Sense` loses `nuance`, `note`, `noteJa`, `similar`, `misc` and `dialects` (the app read none of them; labels carry them). `Entry` loses `loan`, `Enrichment` loses `nuance`, and `Nuance`, `JudgedSimilarWord`, `Loanword` and `loanShown` leave the contracts.
- Search results carry `EntrySummary.labels`, the word's labels as on `Entry`, in place of `formality` and `currency`. A result row shows at most two, loudest first and never a quiet one, coloured by severity like the entry page's (`resultLabels`, `LabelTag`).
- `/health`'s `features.nuance` is `features.formality`: Jev still reads the Check tab's formality, routes Ask Kotori, and judges seeded sentences. The Settings line and the credits say formality.
- The examples job sends Claude the dictionary's labels and notes, without `sense_nuance`'s register, and no longer asks for a usage note per sense (it went to `sense_notes`).

Changes from the plan:

- Kept on purpose: `NuanceScales.tsx` and `t.nuance.scale`/`poles`/`formality` (the Check tab's meter), and the Coach's formality rubric (casting's judge uses it).
- The candidate searches went too, as nothing reads them now: `loanCandidates`, `loanCandidatesIn`, `KATAKANA_WORD`, `sharedGlossCandidates` (similar words use `sharedGlossesBySense`).

Findings for Phase 8:

- Lost with the tables, by decision (never evaluated): Jev's loan verdicts and Claude's loan warnings on English words, and Claude's sense notes. An English word shows no "same as" chip or false-friend warning, and no word shows a Kotori note, until Phase 8's loan and pitfall passes. No data moved into labels, pitfalls or loan links.
- The loan pass needs candidates for English words without `lsource`: `loanCandidates` (common katakana words by gloss or `lsource`) is in `d0cb63a`, with its tests.
- The removed sense-note prompt (in `d0cb63a`'s `examples/prompts.ts`) is a starting point for the pitfall pass's wording.
- `kotori eval` has one kind, `asks`; the Phase 8 golden sets add theirs beside it, and `orderChecks` reads option-order bias.

Deploy: the release command runs the migration before the machines roll. Until they are replaced, old API machines fail on search and entry pages (they read `sense_nuance`), and an old worker fails to claim jobs (it asks for `nuance`). Open web tabs fail to decode entries, search results and `/health` (fields removed or renamed) until they reload.

### ◐ Phase 8 — Offline inference passes

Built and evaluated; no pass has been run over the dictionary, so no artifact is committed.

- `kotori judge <pass>` (`ja-form`, `pitfalls-ja`, `pitfalls-en`, `loans`) picks candidates from the database (common words by default, `--uncommon` for all; approved Ask Kotori words never), asks the model, and rewrites the artifact after every batch. `--limit`, `--dry-run`, `--concurrency`; `--restart` to replace a file another model or prompt version wrote, which it otherwise refuses to extend. Jev judges `form` and loans; Claude writes pitfalls (`PitfallWriter`).
- Artifacts: `data/labels/ja-form.jsonl`, `data/pitfalls/{ja,en}.jsonl`, `data/loans/verdicts.jsonl`, each with a header (pass, model, prompt version) and a CC BY-SA `NOTICE.md` beside it. Every judged word has a line, so a re-run asks only new words. Senses are named by their first gloss, never their position.
- `kotori seed` applies whichever artifacts exist after its imports (`passes/apply.ts`). It fills empty cells only and is idempotent: `form` only on senses with no label but quiet ones, Kotori's pitfalls replaced and placed in the ranks other sources leave free, loan verdicts set with source `kotori` only where the meaning is null or already Kotori's. A word whose headword changed, a sense that is gone and an approved word are skipped.
- Candidates: `ja-form` asks senses with no register label among a word's first six; pitfalls see the page (glosses, labels, the dictionary's notes, the loan and its verdict); loans restore `loanCandidates` from `d0cb63a` (lsource pairs first, then gloss matches) and the old loan questions, for English words with no verdict.
- `kotori eval ja-form|loans|pitfalls|drafts` runs each golden set with the production builders and prints PASS or FAIL against its bar (`eval/passes.ts`). `drafts` scores the Lexicographer's pitfalls on Ask Kotori queries.
- Golden sets (`packages/ai/src/eval/`, JMdict and Wiktionary excerpts under a NOTICE): 34 `form` senses, 31 pitfall words (both directions) plus 5 draft-only queries, 31 loan words. Each item names its evidence, and `judgement` marks those resting on judgement alone, for Ash to review.

Scores (live, 2026-11-07):

| Pass | Bar | Score |
|---|---|---|
| `ja-form` (jev-1.14.0) | precision ≥ 90%, recall ≥ 70% | 100% / 94%, then 100% / 89% (本日 at 0.68 and なお "furthermore" fall short) |
| `loans` (jev-1.14.0) | each verdict precision ≥ 90%, recall ≥ 60% | divergent 100% / 92%, same 100% / 69%, twice; misses are unsure, never wrong (ナイーブ, テスト, ゲーム, カード, チャンス) |
| `pitfalls` (claude-opus-5-5, prompt v3) | silent ≥ 90% where none is needed, caught ≥ 80% | v1 67% / 93%, v2 81% / 100%; v3 94% / 100%, then 81% / 100% on a rerun. Not yet passing reliably |
| `drafts` (Lexicographer) | as pitfalls | 0/8 silent before the shared rules, 4–5/8 after; caught 3/3 |

Decisions:

- A `tone` kind, in both directions: how heavy or light a word lands (ぴえん is playful, never real grief), not politeness or a vulgar word's strength. Drafts filed it under `set_phrase`. Migration `pitfall_tone`; copy "How it lands" / 「言葉の重さ」. Its definition had to rule out roughness (食う is `rude_upward`) and slang's "sounds try-hard".
- The bars weigh a wrong fill above a missing one: what a pass leaves out, the page shows as the dictionary has it.
- An English false friend the curated file already notes (mansion, naive, cunning, claim, smart, tension, talent) needs no pitfall: the note is the warning, as with ご苦労様.
- The pitfall rules are shared with the Lexicographer (`pitfallGuide.ts`), including a list of what is never a pitfall, so live Ask Kotori drafts now write fewer.

Findings and what remains:

- Golden set changes after the first pitfalls run: 水 now needs a pitfall (お湯), and table, 食べる and お前 were dropped as debatable. リフト is in neither set: no clear answer.
- Pitfalls' remaining misses are plausible teachings on words the set says need none: "hot water" on *water*, "Happy wedding" on *happy*, 学校 not meaning university. Ash should decide whether those belong in the set as `none` before the prompt is tuned further.
- The default `ja-form` candidates miss 鑑みる and 当該: JMdict doesn't mark them common. `--uncommon` covers them, at about ten times the requests.
- To do, Ash's call: run each passing pass, review and commit its artifact, then reseed. Run loans before `pitfalls-en`, so false friends see their verdict.

Deploy: the migration only adds an enum value. Once a `tone` pitfall exists (a new Ask Kotori draft can now write one), web tabs open from before the deploy fail to decode that entry or draft until they reload.

## Out of scope

- A Japanese spoken-frequency source (NINJAL licence unverified).
- Tooltip vs under-row explanation on native; the chip colour legend.

## Log

- 2026-11-06: Plan agreed. Phase 1 done.
- 2026-11-06: Phase 2 done. Added Phase 6 (voice casting) after seeded sentences came in without formality.
- 2026-11-06: Phase 3 done. Similar-word rules tightened against the full data (see Phase 3).
- 2026-11-06: Phase 4 done. Drafts migrated, not regenerated; prompt tightened against live drafts (see Phase 4).
- 2026-11-06: Phases 1–4 reviewed; fixes committed before Phase 5 (see "Review of phases 1–4"). Phase 5 done.
- 2026-11-06: Phase 6 done. Seeded sentences judged by Jev on the audio job, not a new job kind; `formality` stays a column (see Phase 6).
- 2026-11-07: Seeded sentences voiced only where Kotori wrote none; finished audio jobs requeued only for untried sentences (see "After Phase 6").
- 2026-11-07: Phase 7 done. The old tables are dropped with nothing carried over; search results show the word's labels (see Phase 7).
- 2026-11-07: Phase 8 built: `kotori judge` and the artifact import, golden sets and evals for every pass, and a `tone` pitfall kind. `ja-form` and loans pass; pitfalls pass only on some runs. No artifact committed (see Phase 8).
