# Kotori's cautions and licence

`ja.jsonl` and `en.jsonl`, once committed, are written by `kotori judge cautions-ja` and
`kotori judge cautions-en`: Claude's short teachings on dictionary words, which the import adds as
cautions (source `kotori`). Each file's first line names the model and prompt version. A caution
about one sense names it by its first gloss, quoted from **JMdict**, © the Electronic Dictionary
Research and Development Group (<https://www.edrdg.org/jmdict/j_jmdict.html>, CC BY-SA 4.0,
<https://www.edrdg.org/edrdg/licence.html>), or, on English words, from **English and Japanese
Wiktionary** by their contributors (CC BY-SA 4.0, via Wiktextract and kaikki.org; see
`data/english/NOTICE.md`).

Unlike the code in this repository, which is under the MIT licence in `/LICENSE`, these files are
adaptations of those works and are shared under the Creative Commons Attribution-ShareAlike 4.0
International licence: <https://creativecommons.org/licenses/by-sa/4.0/>. Changes: each line keeps
a word's entry id and headword, the glosses that name senses, and Kotori's cautions about the word.
