# The golden fixture's data and licences

`entries.json` holds excerpts of four dictionaries, cut by `tools/golden-fixture.mts` for
Kotori's evals and tests (`pnpm golden`). Unlike the rest of this repository, which is under the
MIT licence in `/LICENSE`, it is an adaptation of works under the Creative Commons
Attribution-ShareAlike 4.0 International licence, and is shared under that licence:
<https://creativecommons.org/licenses/by-sa/4.0/>.

- **JMdict**, © the Electronic Dictionary Research and Development Group, used in conformance
  with the Group's licence (CC BY-SA 4.0): <https://www.edrdg.org/edrdg/licence.html>,
  <https://www.edrdg.org/jmdict/j_jmdict.html>. The Japanese entries, their tags' labels and
  their loanword sources, and the English words read backwards from their glosses.
- **Japanese Wiktionary** (<https://ja.wiktionary.org>), by its contributors, CC BY-SA 4.0, as
  extracted by Wiktextract (<https://github.com/tatuylonen/wiktextract>) for kaikki.org
  (<https://kaikki.org/jawiktionary/>). Most English words' senses, readings and usage labels.
- **FrequencyWords** (<https://github.com/hermitdave/FrequencyWords>), by Hermit Dave, from
  OpenSubtitles 2018, CC BY-SA 4.0. The word counts behind English words' `common` mark.
- **EJDict-hand** (<https://github.com/kujirahand/EJDict>), by kujirahand, public domain (CC0).
  The senses of English words Wiktionary has no page for.

Changes: entries are cut to the senses Kotori judges and reduced to their glosses, parts of
speech, tags and sources; English words are built from the sources above as `packages/eiwa`
imports them (senses merged, ranked and relabelled in JMdict's codes), and each golden English
word's katakana loan candidates are listed under `loans`.
