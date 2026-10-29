# Nuance enrichment rework

> Agreed direction, 2026-10-29. Phases A, B and C are all built on this branch. What remains
> operational: run `kotori migrate`, run `kotori eval nuance|english --record …` to baseline
> the golden set and iterate question wording if accuracy disappoints, then the combined
> backfill (`kotori enrich nuance --outdated` and `kotori enrich nuance --reinterpret` for
> interpretation-only changes). The open questions in the first draft were resolved by Ash
> on 2026-10-29; the resolutions are folded into the text below.

## Goal

Make the nuance metadata trustworthy and legible: show register judgments only when they
are confident and in a form that can't mislead (no false precision, no redundant or
wrongly-worded cautions), capture nuance that varies per sense and per learner direction,
and restructure what we ask Jev so the data matches how words actually behave — including
words where a formality scale is the wrong model entirely.

Guiding principles, agreed during prototyping:

1. **A hint is only shown when we're confident it's right.** Low-confidence judgments are
   hidden entirely — never faded, hedged or banded.
2. **Labels drive the UI, scores drive analytics.** Jev's raw score positions stay in the
   stored data but never position anything a learner sees.
3. **Cautions earn their place by being non-obvious.** A warning a learner could infer
   from the definition is noise; the caution budget is spent on words that look safe but
   misfire ("sneaky" words: 了解, ご苦労様, うまい).
4. **Display policy lives in the app; judgment data stays rich.** Thresholds, suppression
   rules and chip-vs-slider choices are app code so they can be iterated without
   re-enrichment. The stored `answers` jsonb and `position` fields are the analytic record.

## Shipped (prototype, this branch)

- Sliders snap the dot to the judged label's stop, with tick marks and the label printed
  under the dot; judgments below confidence 0.55 are not rendered.
- A scale whose confident label sits at a far end (vulgar/formal, spoken/written) collapses
  into a chip ("Crude language", 話し言葉, …) instead of a slider.
- When confidently-judged senses disagree on formality or medium, the single top register
  card is replaced by compact per-sense scales; it remains the one-card summary when they
  agree.
- "Too casual for your boss or customers" → **"Can sound rude to your boss or customers"**,
  and it is suppressed on words that announce themselves (confident `vulgar` formality, or
  a JMDict `derog`/`vulg` tag). Slang does *not* suppress it — harmless slang exists.
- **Per-sense usage notes** from Claude (`sense_notes` table, written by the examples job):
  `note` in English for Japanese learners, `noteJa` in Japanese about the sense's English
  side. Example-sentence notes are demoted to sentence-specific points only.

## Remaining work

### Phase A — no new inference (reinterpretation + display)

Everything here works from data we already store.

**A1. Derive "Sounds stiff between friends" from the scales.**
`stiffWithFriends` is Jev's least reliable question even after one rewording, and as a
separate judgment it can contradict the sliders next to it. Replace the stored probability
with a derivation in `interpret.ts`: the caution holds when the formality label is
`formal`, or sonkeigo/kenjougo, or a written-leaning medium (thresholds tuned against the
golden set, B1). The Jev question is removed in Phase B; until then the answer is still
recorded but no longer displayed. *Resolved: derive — this is the pattern for any tag that
is a function of judgments we already have, rather than a new question for Jev.*

**A2. Reinterpretation tooling.** `kotori enrich nuance --reinterpret`: recompute the
`nuance` jsonb for every stored row from its saved `answers` + JMDict tags, without calling
Jev. This makes interpretation changes (A1, and any threshold change) deployable to the
whole corpus for free, and is the mechanism we'll reuse after every future interpret
change.

**A3. Collapse the scales by default.** *Resolved: keep the sliders, but collapsed.* The
register card (and the per-sense scales when senses disagree) opens as a one-line summary —
the judged labels as text ("Casual · Speech"), plus the edge chips, tags and cautions — with
an expand control that reveals the labelled sliders. The scales stay for learners who want
the spatial picture; the default view carries no false precision and less visual weight.

**A4. Sense notes on the English lookup page.** `english/[term].tsx` shows meanings without
the new sense notes. Add `noteJa` (and `note`, for symmetry) to `EnglishMeaning`, populate
in `Dictionary.english()` from `sense_notes`, render under each meaning. This is the main
surface for Japanese natives and currently the weakest.

**A5. Review-deck cards.** `wordNote` saves formality only. Include the sense note and the
register chips so saved cards carry the nuance the entry showed. (Small; display-only.)

### Phase B — Jev question restructure (one deliberate model/question bump)

Jev's model is pinned so stored confidences stay comparable; all question changes below
ship together as **one** versioned change, followed by one corpus re-enrichment.

**B1. Golden set + eval harness (prerequisite).**
`packages/nuance/test/golden.ts`: ~80–120 words with expected labels and caution outcomes,
seeded from the failures we've already caught (妊娠, 勃起, 性交 vs セックス, 了解,
ご苦労様, めっちゃ, 鑑みる…) plus a spread of ordinary words. A `kotori eval nuance`
command runs the current questions against the set and reports per-question accuracy and
confidence calibration. Run deliberately (it costs inference), not in CI; the recorded
answers are committed so interpretation changes (Phase A) can be evaluated offline.
Every prompt iteration from now on is measured against this set instead of spot checks.

**B2. Register shape: when a scale is the wrong model.**
New choice question `registerShape`:
- `scaled` — the word genuinely moves along casual↔formal (default; slider).
- `fixed` — register is invariant and obvious from the meaning (insults, shimoneta,
  ceremonial words); UI shows the edge chip only and suppresses redundant cautions.
- `split` — bimodal: clinical/technical in one world, crude/joking in another (性交 vs
  the same organs' everyday words). UI shows a dedicated chip ("Clinical or crude —
  depends on context", 場面で印象が大きく変わる) and no slider; the sense note explains
  the split.
This replaces the implicit "vulgar formality ⇒ suppress" heuristics with an explicit
judgment, while keeping those heuristics as fallback for pre-bump rows.

**B3. Question rewordings and guards.** Fold the accumulated scar tissue into the reworked
question set: keep `SUBJECT_NOT_REGISTER` everywhere it applies, re-anchor the formality
score examples, and drop `stiffWithFriends` (A1). `rudeToSuperiors` keeps its です/ます
framing but adds the explicit instruction that obviously crude words should still answer
"yes" (suppression is display policy, not Jev's job — the data stays honest).

**B4. New context tags — deferred.** *Resolved: out of scope for this rework; needs further
refinement before any earn a slot.* The candidate list is parked here for that later
discussion: fiction flavor (拙者, 我輩), euphemism (お手洗い vs 便所), often-sarcastic
(ご立派), texting/net-only (り, 乙). Phase B ships without new tags so the question bump
isn't held up.

**B5. Versioning and backfill.** Add `questionsVersion` (int) to `sense_nuance`; bump the
pinned Jev model if a newer one is available at the same time. *Resolved: common-only
backfill via the batch CLI, then on-demand refresh for the tail* — when an entry is viewed
and its stored `questionsVersion` is old, the API re-queues its nuance job the same way it
queues missing enrichment today. Old-version rows stay valid in the meantime (they simply
lack the new fields), so there is no flag day. Rough budget check against TypeSafe pricing
before the run. *Also resolved: this backfill and Phase C's are the same run* — B does not
ship its corpus pass until C is implemented, so the corpus is paid for once.

### Phase C — English-direction nuance (Japanese natives learning English)

A formality slider measured the Japanese way doesn't transfer to English, and the useful
metadata differs. Proposal:

**C1. What we judge.** Per sense, the *English side* (the primary gloss as used in natural
English), with English-specific dimensions:
- `variety`: universal / american / british (chip: アメリカ英語, イギリス英語).
- `strength`: none / mild / strong / avoid — profanity and slur tiering, the single
  highest-value warning for Japanese learners (chip: 強い言葉, 使用注意).
- `currency`: current / dated / textbook-ism — flags "How do you do", whom (chip: 古風,
  教科書的).
- `tone register`: a coarse 3-level chip (casual / neutral / formal) — chips only, no
  slider, per the lesson of this whole exercise.
- Ordinary collocation notes stay prose in `noteJa` (A4 gives them their surface).

**C2. How it runs.** *Resolved: Jev* (typed, calibrated, consistent with the JA side;
Claude writes prose only). A second `systemOne` call inside the existing nuance job with an
English-focused state (gloss, sense context, the Japanese word for contrast), stored in a
new `english_nuance` table keyed `(entryId, sense)` mirroring `sense_nuance` (answers
jsonb, model, questionsVersion). Shown on `english/[term].tsx` and on entry senses when
the learner's target is English. Enrichment status stays a single `nuance` kind — the job
produces both directions.

**C3. Loanword false friends (和製英語 and drifted katakana loans) — first-class.**
Corrected scope from the first draft: these are not generic collocation traps but the
スタイル problem — a katakana loan a Japanese native already "knows" whose English source
word means something else (スタイル → figure/body, マンション → luxury flat not mansion,
テンション → mood not tension, ナイーブ → sensitive not naive). This is one of the highest
-value signals we can give Japanese natives, so it gets structured data and dedicated UI,
not a line of prose:
- **Data:** per sense, Jev judges `loanFriend`: does a common katakana loan correspond to
  this English word, and does its everyday Japanese meaning match the English one here —
  `no_loan` / `matches` / `diverges` — plus the loan itself. When it diverges, Claude
  (in the examples job, next to the sense notes) writes `loanTrap`: one Japanese sentence
  naming the loan and the difference (「スタイル」は英語では体型の意味にならない…).
  Stored on `english_nuance`.
- **UI:** a distinct warning treatment, not a normal chip — e.g. an accent callout
  「カタカナの「スタイル」とは意味が違う」 at the top of the English entry page and on the
  sense when the learner's target is English. A `matches` judgment can also surface
  positively ("same as the katakana word you know") since that's instant comprehension
  for free, shown quietly.
- The golden set for C includes a loanword section (divergent, matching, and no-loan
  cases) so precision here is measured before launch; a false "diverges" warning on a
  matching loan would damage trust in exactly the feature meant to build it.

## Execution order and effort

| Step | Depends on | Size |
|---|---|---|
| A2 reinterpret CLI | — | S |
| A1 stiff-with-friends derivation | A2 | S |
| A3 collapsed scales | — | S |
| A4 English page notes | — | S–M |
| A5 review cards | — | S |
| B1 golden set + eval | — | M |
| B2–B3 question rework | B1 | M |
| C1–C3 English nuance + loanword traps | B1 | L |
| B5 version + combined B/C backfill | B2–B3, C1–C3 | S + run time |

Phase A ships first. B and C land behind the same question-version bump and share **one**
corpus backfill (common-only, on-demand tail), so the corpus is paid for once.

## Non-goals (this rework)

- Coach prompts (naturalness / how-to-say) — already bidirectional; untouched.
- Voice casting's use of nuance — reads the same fields; unaffected by display changes,
  and B5's reinterpretation keeps `cautions.slang` semantics identical.
- Similar-words judgments — unchanged question set.
