# Dictionary enrichment: implementation plan

Tracks the build-out of [the enrichment model](dictionary-enrichment-model.md). One commit per phase, on one branch, deployed together at the end. The private beta can take brief disruption, so phases need not keep the old page working beyond their own commit.

Status key: ☐ not started · ◐ in progress · ☑ done

## Decisions

- The import downloads JMdict_e_examp (Tatoeba) like the other seeds; nothing is committed to `data/`.
- An Ask Kotori proposal has exactly the dictionary entry's data model (labels, patterns, examples, pitfalls, sources). It differs only in that it waits for approval before it becomes a real entry.
- Loan links store both `same` and `divergent` verdicts. `same` drives the English "same as 「アドバイス」" chip.
- Phases 1–6 come before the inference passes (Phase 7). The product is correct on dictionary data alone.

## Phases

### ☑ Phase 1 — New tables, additive

- `source` enum shared by every new table.
- Label vocabulary (`LabelCode`, severity) in `@kotori/db`, the single place severity is defined.
- Tables: `labels`, `patterns`, `pitfalls` (rank 1–3, so the cap is a constraint), `usage_evidence`, `loan_links` (one row per katakana ↔ English pair, both entry ids nullable).
- `examples.source` (existing rows are `kotori`); `examples.model` nullable for seeded sentences.
- Relations for the new tables. No reader or writer yet; nothing dropped.

### ☐ Phase 2 — Deterministic import

- JMDict: `misc` → labels, `s_inf` → patterns, `ichi1` → evidence, `lsource` → loan links.
- English dictionary: register and region codes → labels, `info` → patterns, subtitle count and familiarity → evidence.
- Loan links resolve both entry ids after both dictionaries are in.
- Download JMdict_e_examp; seed Tatoeba and Wiktionary examples with their `source`.
- Decide what `formality` a seeded sentence carries (nullable, or `neutral`).
- No model calls; a re-run gives the same rows. Fixture tests: 食う, ご苦労様, マンション, yep.

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

### ☐ Phase 6 — Remove the old model

- Stop the `NuanceEnricher` job; the worker keeps examples and audio.
- Remove `NuanceJudge`, `interpret.ts`, `questions.ts`, `TAG_JUDGMENTS`, `saidByNuance`.
- Drop `sense_nuance`, `similar_words`, `loan_words`, `sense_notes`; fold the example casting columns into one nullable JSONB.
- Remove the old contract fields.

### ☐ Phase 7 — Offline inference passes

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
