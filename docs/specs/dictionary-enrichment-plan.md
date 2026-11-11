# Dictionary enrichment: implementation plan

Tracks the build-out of [the enrichment model](dictionary-enrichment-model.md). One commit per phase, on one branch, deployed together at the end. The private beta can take brief disruption, so phases need not keep the old page working beyond their own commit.

Status key: ☐ not started · ◐ in progress · ☑ done

## Decisions

- The import downloads JMdict_e_examp (Tatoeba) like the other seeds; nothing is committed to `data/`.
- An Ask Kotori proposal has the dictionary entry's data model (labels, usage patterns, examples, cautions, sources). It differs only in that it waits for approval before it becomes a real entry.
- Loan links store both `true_loanword` and `wasei_eigo` verdicts. `true_loanword` drives the English "same as 「アドバイス」" chip.
- Phases 1–7 come before the inference passes (Phase 8). The product is correct on dictionary data alone.
- Seeded example sentences have no formality (null), never a guessed one: voice selection needs the real formality to sound natural. Phase 6 teaches it to handle them.

## Phases

### ☑ Phase 1 — New tables, additive

- `source` enum shared by every new table.
- Label vocabulary (`LabelCode`, severity) in `@kotori/db`, the single place severity is defined.
- Tables: `labels`, `usage_patterns`, `cautions` (rank 1–3, so the cap is a constraint), `entry_frequency`, `loan_links` (one row per katakana ↔ English pair, both entry ids nullable).
- `examples.source` (existing rows are `kotori`); `examples.model` nullable for seeded sentences.
- Relations for the new tables. No reader or writer yet; nothing dropped.

### ☑ Phase 2 — Deterministic import

- `entries.source` names the source of an entry's senses (`jmdict`, `enwiktionary` for curated words, `jawiktionary`, or `kotori` for approved Ask Kotori words). Labels and usage patterns carry it as their source.
- `senses.origins` stores JMDict `<lsource>` origin language + word pairs across all languages (`eng`, `fre`, `por`, `ger`, …).
- `insertEntries` rebuilds the labels and usage patterns read from the senses (`misc`, dialects, `wasei`, `info`) on every insert. Rows from other sources (Kotori, learners) are layered on top and follow their sense when a re-import moves senses; a dictionary label replaces Kotori's on the same code.
- With `{ seeded: true }` (the importers), seeded example sentences and entry frequency signals are synced too: sentences keep their ids across re-imports. Re-inserting a stored entry (aliases) leaves them alone.
- The import downloads `JMdict_e_examp.gz` in place of `JMdict_e.gz`: the same entries plus 32k Tatoeba pairs. Japanese Wiktionary gives 5k English pairs.
- `linkLoans` runs after each dictionary import: adds the English origin pairs JMDict names, drops those it no longer names, and resolves the English entry.
- Claude's examples job replaces only Kotori's sentences, and still runs for words that have only seeded ones. Seeded sentences are not voiced yet.
- The label vocabulary gained the codes the data uses: JMDict's other dialects, English regions, `m-sl`, `sens`, `nonstd`, `proverb`, `yoji`.
- Verified on the full data: 219k JMDict entries and 52k English words in 93 s; a second seed leaves the same content. It is not a no-op: dictionary usage patterns are deleted and reinserted with new ids, and frequency and loan links are rewritten in place.

Findings for later phases:

- JMDict's English `lsource` is mostly on wasei-eigo and coinages (2,442 pairs; 141 have an English entry). True loanwords such as アドバイス have none, so the English "same as" chip depends on Phase 8's loan verdicts.
- Wiktionary examples attach only to words whose senses come from Wiktionary. Curated words would need sense matching by gloss.
- Seeded sentences carry no furigana (no reading source); `furigana` equals the sentence.
- Tatoeba is credited in the app's credits; the per-entry sources line is Phase 5's.

### ☑ Phase 3 — Contracts and API

- `Entry` gains `source`, `usuallyKana`, `labels` (the first sense's), `frequency`, `loanLink` and `cautions` (first first, `about` resolved to the word). `Sense` gains `origins`, `labels` (only what it adds to the word's), `usagePatterns` and `similarWords`; `Example` gains `source`. Labels carry their severity, so the app needs no copy of the table.
- The old fields stay until Phase 7. The old similar-word type is renamed `JudgedSimilarWord`; the dictionary's caution type is `EntryCaution`.
- Similar words are derived on view (`similar.ts`, `usage.ts`): cross-references first, then common words close by gloss, at most four per sense, each word once under its first sense. The difference is a code the app words: `respectful`, `humble`, `more_casual`, `more_formal`, `plain`, `masculine`, `feminine`, `american`, `british`, `older`, `similar`.
- A loan link shown from either end; with several, the one with a verdict, then the most used.
- Checked on the full data: 9–30 ms per entry after the first.

Changes from the prototype, after checking on the full data:

- A gloss-close word must share two glosses with the sense, or lead with the same one. One shared gloss tied 結構 to 罰金 ("fine") and マンション to 変 ("flat").
- Only a label the other word has says how it differs. The prototype read a label only the current word has as the opposite formality (ご苦労様 → お疲れ様 "more casual"; slang *eat* → devour "more formal"). Now an unmarked word beside a marked one is `plain`.
- `masculine` and `feminine` differences were added: JMDict marks 食う `male`, not casual, so 食べる → 食う said only "similar".

Findings for later phases:

- The curated English synonyms are noisy on some senses (slang *eat* lists bang, rock, slap). Cross-references are shown as the dictionary gives them.

### ☑ Phase 4 — Proposals on the entry model

- A stored draft (`DraftEntry` in `@kotori/db`) is the dictionary's model: senses with `pos`, label codes and usage patterns, word-level `frequency`, and up to three cautions (by sense index, `about` as written). The wire `Proposal.draft` reads like an entry: `Label`, `UsagePattern`, `EntryCaution` and `Tag`, all source `kotori`, labels stated once as on an entry.
- Claude's output is checked before it is stored (`asks/draft.ts`): label codes outside the vocabulary dropped, cautions kept only of a kind valid for the direction (`CAUTION_KINDS`), about a sense that exists, non-empty, at most three; frequency clamped to 1–5.
- A caution's `about` links to an entry only when exactly one word is written that way (上手 links to neither).
- Approval writes labels as `misc` and usage patterns as `info`, so the import reads them back as Kotori's; cautions are saved directly and carried in both approved files, so a reseed restores them.
- Existing drafts are migrated in SQL, nothing inferred: `currency` → `arch`/`dated` labels and frequency 1/2/4 (as approval derived them), `partOfSpeech` → `pos`, `note` → one usage pattern, no cautions. Tested on old-shape rows.
- The golden asks test only Jev's routing, not draft content; they needed no change.
- The `DraftCard` reads the new shape; Phase 5 restyles it.

Checked with live Claude drafts (bussin, rizz, ghosting, ぴえん, 蛙化現象, 了解です), which changed the prompt twice:

- Usage patterns carried unverifiable origin and date claims ("アフリカ系アメリカ人の英語に由来", "around 2019–2020"). Usage patterns and cautions are now usage only.
- Cautions restated the slang label ("avoid it in formal settings"). The prompt now says what each usage label already tells the learner.

Findings for later phases:

- Draft cautions are inference with no golden eval. Phase 8's caution golden set should cover the Lexicographer too.
- No caution kind fits tone strength (ぴえん's "light, never real grief" came as `set_phrase`). Decide in Phase 8 whether a `tone` kind is needed.
- A reseed replaces Kotori's cautions on approved words with the approved file's. Phase 8 passes must skip approved words or write to that file.
- `trendy` and `current` both migrated to frequency 4; the distinction had no place in the new model.
- Migrated notes may hold origin claims or things to watch for, now shown as Kotori usage patterns. Review pending drafts before approving.
- Drafts can still be careless with facts (bussin's caution says "bussing" is spelled the same). Approval remains the gate.

### ☑ Review of phases 1–4

Two reviews read phases 1–4 before Phase 5 and found these, now fixed:

- `linkLoans` kept a stale pair when JMDict respelled the katakana word, so the entry had two links. The wanted pairs are now computed once, and the delete and the upsert both use them. It also reads only Japanese entries.
- A word the curated file takes over from Ask Kotori kept the draft's labels and notes, which then looked like Kotori's fill on a dictionary word. The insert now also rebuilds the source of the entry's old source.
- Approval dropped the draft's frequency: Japanese words never had frequency signals, and English words had them only after a reseed. Approval now writes the frequency row, the Japanese approved file carries the frequency, and the reseed replays it.
- The asks list ran a query per draft, plus the whole tag table each time. It now reads every draft, and every word they name, in a few queries.
- A cross-reference with a reading ("上手・うわて") matched any word spelled that way. The reading now picks among them; it feeds similar words.
- Draft labels the word's language can't carry (keigo or a dialect on an English word, a region on a Japanese one) are dropped, and a draft with an empty headword is refused.
- `usagePatterns.about_entry_id` and `cautions.about_entry_id` have partial indexes, so deleting an entry doesn't scan both tables.
- A phase 2 test that could not fail now re-inserts the stored entry, and a moved Kotori label is tested.
- A `data/approved/ja.jsonl` line written before entries named their source would have been skipped silently on reseed. It now reads as Kotori's, and a line in either approved file that doesn't decode is reported with its line number.

Left as they are:

- A sense shows only the labels it adds to the word's; it can't say it lacks one of the word's. Where the first sense is `arch` and a later one is current, the page calls the whole word archaic. This is a choice to confirm.
- Two JMDict homographs that name the same English word share one link row, held by the lower id; the other entry shows no loan line.
- Gloss candidates are capped at four per sense before duplicates are removed, so a sense can show fewer similar words than exist.
- Kotori's cautions take the free ranks, so they can sit between cautions from other sources. A caution's `about` can name its own entry.

### ☐ Phase 5 — Entry page

- Rebuild `app/entry/[id].tsx` from the prototype; the Ask Kotori draft view renders through the same components.
- Remove `NuanceScales.tsx`, `lib/nuance.ts`, the old chips, and the prototype (`app/proto`, `src/proto`, `test/proto.test.ts`).

### ☐ Phase 6 — Voice selection on the new model

- Voice selection reads labels instead of `sense_nuance`, which Phase 7 drops.
- Seeded sentences get their voice-selection signals judged on the worker path when their entry is viewed, then are voiced. No default formality is ever assumed.
- Fold the example voice-selection columns into one nullable JSONB.
- The audio status counts seeded sentences again once they can be voiced.

### ☐ Phase 7 — Remove the old model

- Stop the `NuanceEnricher` job; the worker keeps examples and audio.
- Remove `NuanceJudge`, `interpret.ts`, `questions.ts`, `TAG_JUDGMENTS`, `saidByNuance`.
- Drop `sense_nuance`, `similar_words`, `loan_words`, `sense_notes`.
- Remove the old contract fields.

### ☐ Phase 8 — Offline inference passes

- `kotori judge <pass>` writes reviewed `data/*.jsonl` with a model and prompt-version header; the import fills empty cells only.
- Golden sets first, both directions. Then one commit per pass, each only once it passes its eval:
  1. `ja-form` fill for common untagged formal written words.
  2. Cautions, `ja` and `en`, at most three per word; sense-scoped ones name the gloss, not the number.
  3. Loan verdicts for English candidates with no `lsource`.

## Out of scope

- A Japanese spoken-frequency source (NINJAL licence unverified).
- Tooltip vs under-row explanation on native; the chip colour legend.

## Log

- 2026-11-06: Plan agreed. Phase 1 done.
- 2026-11-06: Phase 2 done. Added Phase 6 after seeded sentences came in without formality.
- 2026-11-06: Phase 3 done. Similar-word rules tightened against the full data (see Phase 3).
- 2026-11-06: Phase 4 done. Drafts migrated, not regenerated; prompt tightened against live drafts (see Phase 4).
- 2026-11-06: Phases 1–4 reviewed; fixes committed before Phase 5 (see "Review of phases 1–4").
- 2026-11-11: Aligned with `GLOSSARY.md` (#112): `entries.source`, `senses.origins`, `cautions` (`wasei_eigo`), `entry_frequency`, `loan_links.meaning` (`true_loanword | wasei_eigo`), label severity `warning`. The migrations were re-cut to run after the glossary migration.
