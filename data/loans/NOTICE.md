# Kotori's loan verdicts and licence

`verdicts.jsonl`, once committed, is written by `kotori judge loans`: for English words, the
katakana loan Jev judged them to have and whether it kept the English meaning, which the import
writes to `loan_links.meaning` (source `kotori`). Its first line names the model and prompt version.
The katakana words and their pairing with English words come from **JMdict**, © the Electronic
Dictionary Research and Development Group (<https://www.edrdg.org/jmdict/j_jmdict.html>), and the
English words from Kotori's English dictionary (English and Japanese Wiktionary; see
`data/english/NOTICE.md`).

Unlike the code in this repository, which is under the MIT licence in `/LICENSE`, the file is an
adaptation of those works and is shared under the Creative Commons Attribution-ShareAlike 4.0
International licence: <https://creativecommons.org/licenses/by-sa/4.0/>.
