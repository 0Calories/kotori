# Nuance on English entries

How PR #36's nuance rework was consolidated onto the English dictionary for Japanese speakers
(PR #34), and why. Product direction: a Japanese speaker learning English gets an experience
that mirrors the English speaker's on a Japanese word as closely as possible.

## What changed in the premise

PR #36 gave Japanese natives English nuance by reading JMDict backwards: an `english` job judged
the English glosses of Japanese entries, shown on `/english/[term]`. PR #34 replaced that page
with an English dictionary of their own (`packages/eiwa`, ~65k words explained in Japanese,
`entries.language = 'en'`), on the same screens as JMDict's words. So the English side is now
judged on English entries, by the same job and in the same request as their senses, and everything
PR #36 built only for the English page is gone: the page, the `english` job and `job_kind` value,
`Enrichment.english`, and the per-gloss `english_nuance` table. No viewer gating is needed either:
an entry's language says who reads it.

## Mirror audit

What an English speaker gets on a Japanese word, against what a Japanese speaker gets on an
English word, after this branch.

| | Japanese word, for English speakers | English word, for Japanese speakers |
|---|---|---|
| Search | Japanese, romaji, English glosses | English with inflections and spellings, Japanese glosses (PR #34) |
| Hero | headword, kana, romaji, audio | headword, IPA when the sources have it, audio (PR #34) |
| Nuance card | snapped sliders, chips at the edges and for fixed or split registers, hidden when unsure | the same (this branch) |
| Cautions | rude to superiors, stiff with friends, slang | the same, plus textbook English and profanity |
| Language-specific | keigo | regional variety, profanity strength, and the katakana loan (warning or "same as" chip) |
| Register shape | judged (PR #36) | judged (this branch) |
| Usage notes | one per sense, in English | one per sense, in Japanese (this branch) |
| Similar words | JMDict's xrefs and shared glosses, with differences | Wiktionary's synonyms and shared glosses, differences without keigo |
| Examples | Japanese with English translation and notes | English with Japanese translation and notes (PR #34) |
| Save and review | with hint and usage note | the same (this branch) |

Remaining gaps:

- **Sense order.** JMDict lists senses commonest first; Japanese Wiktionary doesn't. "smart"
  leads with 痛む (to smart) and has 賢い at senses 6–7 of 12; "coffee" leads with the coffee
  plant; "fall" has autumn at 11 of 14; "kid" leads with a young goat, "guy" with a guy-rope,
  "phone" with a speech sound. Of 7,306 common English words that a common JMDict word
  back-translates, 50.8% lead with that sense, 13.3% have it at senses 1–5, and 35.9% have none
  of the first six matching, mostly function words whose glosses describe grammar. Only the first
  `MAX_SENSES` (6) are judged and the first four get examples, so these words' main senses get no
  nuance or examples, and the entry page opens on an odd sense. **Open:** rank English senses at
  import, for instance by JMDict back-translation. Decide before English enrichment piles up in
  production: stored enrichment is keyed by sense position, so a re-import that reorders senses
  misattributes it.
- **Gender and age** have no English goldens. Clean examples are rare, and the question criteria use the obvious ones.
- **Textbook English** has no clean goldens: the canonical case, "How do you do?", is the
  question's own example.

## Decisions

1. **One nuance pipeline for both dictionaries.** English words use `sense_nuance` and the
   `nuance` job like Japanese ones. Their extra judgments are optional fields of the shared
   `Nuance`: `variety`, `profanity` and `cautions.textbook`. English words carry `keigo: none` from
   the dictionary. *Why:* the app renders one nuance card for both. A second table and job would
   mean a second request per English word and two code paths that mirror each other by hand.
2. **The katakana loan is judged once per English word**, in the same request as its senses, and
   stored in `loan_words`: the verdict, the answers for reinterpretation, and Claude's warning.
   The warning survives a re-judge that names the same loan. *Why:* a drifted loan is a word's
   trap, not a sense's (スタイル is first someone's figure whichever sense of "style" you look at),
   and one warning per word is what the page should show. *Evidence:* see the loan table below.
3. **Candidates come from JMDict**, as in PR #36: common katakana-only words with the English
   word as a gloss, or as their `lsource` (`DictionaryRepo.loanCandidates`, now limited to
   `language = 'ja'`).
4. **The loan Noul names the English word in its own instructions** (`english_word`) and no longer
   says "or is only another translation". On an English entry the katakana word is usually one of
   the word's own Japanese translations ("table" is glossed テーブル、食卓). With the old wording
   Jev put テーブル at 0.04; with `word` only in the state it still put テーブル, ドア and スタイル
   below 0.2. Now every true loan in the golden set scores 0.80–0.98, and false candidates
   (タイプ, ホット, フォアボール) score 0.04–0.15.
5. **"Stiff between friends" is derived for English words too**, from the formality and medium
   probabilities, and PR #34's question is dropped. *Evidence:* on the 12 English stiffness
   goldens the derivation was right 11 times. PR #34's question, asked per sense, was also right
   11 times, but only 10 inside the per-entry request. The derivation is also one question fewer
   per sense and matches the Japanese side.
6. **The English dictionary's labels override Jev** where they speak, as JMDict's tags do. Eiwa
   already maps Wiktionary's and EJDict's labels to JMDict's codes (`col`, `sl`, `vulg`, `form`,
   `arch`…), and this branch adds its regions (`en-US`, `en-GB`) for variety. The 7 variety goldens
   the dictionary decides are all right.
7. **One usage note per sense, in the learner's language:** `note` (English) on Japanese words,
   `noteJa` (Japanese) on English ones. PR #36 wrote both directions on Japanese words, but
   Japanese speakers no longer read Japanese entries.
8. **A question version per language.** `QUESTIONS_VERSION` (Japanese) and
   `ENGLISH_QUESTIONS_VERSION` are both 3. Rows PR #34 judges before this ships are version 1, so
   they are requeued when viewed and picked up by `--outdated`, which compares each entry with its
   own language's set.
9. **No English evidence was added for the CJK concern.** English words' meanings reach Jev in
   Japanese, but their sense judgments were already right on almost every golden (below). The one
   cross-lingual weak spot is the loan verdict, where the English word's Japanese senses are
   compared with the katakana word's English glosses. Telling Jev to judge the English word as it
   knows it, rather than through its listed senses, did worse (loans 74%/83%), so it was reverted.

## Data model

One migration on PR #34's (`20261030183722_nuance_on_english_entries`), all additive:

- `sense_notes`: one usage note per sense, `note` and `note_ja`.
- `sense_nuance.questions_version`, default 1.
- `senses.sources` and `senses.wasei`, from JMDict's `lsource` and `ls_wasei`; empty until JMDict
  is re-imported.
- `loan_words`, one row per English word with candidates: `word`, `verdict`, `answers`, `trap`,
  `model`, `questions_version`.

`Entry` gains `loan` and `Sense` gains `note` and `noteJa`. CI now deploys the API before the web
app (#38), which this needs.

## Enrichment workflow

`NuanceEnricher.enrich` sends one request per entry, in either language. The state is the entry:
word, reading (kana and romaji, or IPA), other forms and the senses' leading glosses. Each judged
sense's questions carry that sense's scope in their instructions, and similar-word candidates are
compared per sense. An English word's katakana candidates add `loanword_{k}` and `loan_{k}`.
Right after Jev, the nuance job has `LoanWriter` write the warning for a confidently diverging
loan, once. `kotori enrich nuance --reinterpret` re-derives senses and loan verdicts without
inference, and `--outdated` re-judges entries behind their language's question set; both honour
`--dictionary`.

## Evals

`pnpm golden` cuts both dictionaries' golden entries into `packages/nuance/golden/entries.json`. It
builds the English dictionary in memory from `data/eiwa` with `Eiwa.buildEntries`. All runs are on
jev-1.14.0, in production's option order, and every Choice is asked again with its options
reversed. Recordings are in `data/eval/`, which is gitignored.

**Japanese words** (78 senses, 20 pairs). The consolidated requests use the same builders and
question text as PR #36's v3. Between the two runs 466 of 1,308 answers were identical and the
largest score change was 0.20, so the changed cells are run-to-run variation.

| dimension (Jev decides) | PR #36 v3 | this branch |
|---|---|---|
| formality | 38/42 | 37/42 |
| medium | 16/17 | 16/17 |
| currency | 6/6 | 5/6 |
| rude to superiors | 28/30 | 28/30 |
| stiff with friends | 17/20 | 17/20 |
| register shape | 6/7 | 6/7 |
| keigo, age, connotation, slang | all right | all right |
| similar at 0.7, difference | 20/20, 15/17 | 20/20, 15/17 |

**English words** (56 senses, 12 pairs, 23 loans). "Before" is PR #34's English questions, one
request per sense, on the same goldens. It had no register shape, variety, profanity, textbook or
loan questions.

| dimension | PR #34 | this branch (Jev decides; dictionary decides) |
|---|---|---|
| formality | 19/19 (+6/6) | 19/19 (+6/6) |
| medium | 11/11 (+2/2) | 11/11 (+2/2) |
| currency | 4/4 (+2/2) | 4/4 (+2/2) |
| connotation | 7/7 (+1/1) | 7/7 (+1/1) |
| rude to superiors | 11/12 | 11/12 |
| stiff with friends | 11/12 (asked) | 11/12 (derived) |
| slang | 6/6 | 4/4 (+2/2) |
| register shape | — | 3/3 (+2/2) |
| variety | — | 5/6 (+7/7) |
| profanity | — | 8/9 |
| similar at 0.7, difference | 12/12, 4/4 | 11/12, 4/4 |

The misses: "penis" is judged rude to a boss (0.74) and mildly profane; "cookie" is judged
universal; "happy"→"glad" scored 0.66 as similar, just under 0.7.

**Katakana loans.** Each English word is judged once. "Shown" counts verdicts confident enough for
the app to show (≥ 0.55).

| | PR #36, per gloss of a Japanese word | this branch, per English word |
|---|---|---|
| verdict right, gloss candidates | 20/23 | 18/23 |
| verdict right, with `lsource` | 23/23 | 20/23 |
| warnings shown, of 12 false friends | 10 | 6 |
| false warnings | 0 | 0 |
| "same as" chips shown, of 8 matching loans | 4 | 6 |

With `lsource`, the misses are ナイーブ and バイク (judged to match; English "bike" is listed as
both bicycle and motorbike) and テスト (diverges at 0.58, too unsure to show). The warnings missing
at the threshold are スタイル (0.62), タレント, ジュース and サイン: the verdict is right but not
confident. **Open:** the per-word framing loses confidence against PR #36's per-gloss one, which
compared English with English. Options: give the verdict the English word's leading sense
explicitly, once senses are ranked; or lower the display threshold for loans, which the eval
says would add no false warnings on this set.

Spend: 6 paid runs (one Japanese, four English while tuning the loan questions, and PR #34's
questions), 1.95M input tokens, about 8 cents.

## For Ash

- Re-import JMDict so `senses.sources` is filled. Until then the English job finds loans by gloss
  only, and misses マンション, ナイーブ and カンニング.
- After deploying: `kotori enrich nuance --reinterpret` (free), then
  `kotori enrich nuance --outdated --common-only`. Japanese rows are version 1, and English ones
  judged by PR #34's questions are version 1 too.
- Check the Fly secrets for a `KOTORI_JEV_MODEL` override of the jev-1.14.0 pin.
- Decide on English sense order before English enrichment accumulates (see the mirror audit).
