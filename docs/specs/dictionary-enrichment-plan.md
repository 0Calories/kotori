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
- Verified on the full data: 219k JMDict entries and 52k English words in 93 s; a second seed changes nothing.

Findings for later phases:

- JMDict's `lsource` is mostly on wasei-eigo and coinages (2,442 pairs; 141 have an English entry). Plain loans such as アドバイス have none, so the English "same as" chip depends on Phase 8's loan verdicts.
- Wiktionary examples attach only to words whose senses come from Wiktionary. Curated words would need sense matching by gloss.
- Seeded sentences carry no furigana (no reading source); `furigana` equals the sentence.
- Tatoeba is credited in the app's credits; the per-entry sources line is Phase 5's.

### ☐ Phase 3 — Contracts and API

- New `Entry` wire shape in `@kotori/contracts`, from the prototype's `model.ts`.
- Senses carry only the labels that differ from the word's.
- Similar words derived server-side from cross-references and shared glosses, difference text from labels.

### ☐ Phase 4 — Proposals on the entry model

- `DraftEntry` becomes the entry shape: labels with `source: kotori`, patterns, examples, pitfalls.
- Claude's Ask Kotori prompt and the golden asks move to that shape.
- Approval copies the draft into the real tables unchanged.
- Existing drafts are migrated or regenerated (beta data; decide in the phase).

### ☐ Phase 5 — Entry page

- Rebuild `app/entry/[id].tsx` from the prototype; the Ask Kotori draft view renders through the same components.
- Remove `NuanceScales.tsx`, `lib/nuance.ts`, the caution chips, and the prototype (`app/proto`, `src/proto`, `test/proto.test.ts`).

### ☐ Phase 6 — Voice casting on the new model

- Casting reads labels instead of `sense_nuance`, which Phase 7 drops.
- Seeded sentences get their casting signals (formality, speaker, medium, tone) judged on the worker path when their entry is viewed, then are voiced. No default register is ever assumed.
- Fold the example casting columns into one nullable JSONB.
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
  2. Pitfalls, `ja` and `en`, at most three per word; sense-scoped ones name the gloss, not the number.
  3. Loan verdicts for English candidates with no `lsource`.

## Out of scope

- A Japanese spoken-frequency source (NINJAL licence unverified).
- Tooltip vs under-row explanation on native; the chip colour legend.

## Log

- 2026-11-06: Plan agreed. Phase 1 done.
- 2026-11-06: Phase 2 done. Added Phase 6 (voice casting) after seeded sentences came in without formality.
