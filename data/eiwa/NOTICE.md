# Curated English Wiktionary data and licence

`enwiktionary-ja.jsonl` and `enwiktionary-phrases.json` hold curated English dictionary entries and
attested phrase/redirect indices derived from **English Wiktionary**
(<https://en.wiktionary.org>), by its contributors, as extracted by Wiktextract
(<https://github.com/tatuylonen/wiktextract>) for kaikki.org
(<https://kaikki.org/dictionary/English/>), and cross-referenced with **Japanese Wiktionary**
(<https://ja.wiktionary.org>) and **JMdict** (<https://www.edrdg.org/jmdict/j_jmdict.html>, © EDRDG).

Unlike the code in this repository, which is under the MIT licence in `/LICENSE`,
`enwiktionary-ja.jsonl` and `enwiktionary-phrases.json` are adaptations of works licensed under the
Creative Commons Attribution-ShareAlike 4.0 International licence, and are shared under that licence:
<https://creativecommons.org/licenses/by-sa/4.0/>.

Changes made in this adaptation:
- Raw English Wiktionary senses for each headword are consolidated into 1–6 learner senses,
  reordered by modern everyday utility, and translated into concise Japanese glosses and usage notes.
- Attested multi-word phrases and canonical idiom redirects are normalized for dictionary lookup and
  reverse-JMdict canonicalization.
- Part-of-speech, register, field, and regional labels are mapped to JMdict-compatible tag codes.
