# Kotori's label fill and licence

`ja-form.jsonl`, once committed, is written by `kotori judge ja-form`: Japanese words whose senses
Jev judged to be formal or literary wording, which the import labels `form` (source `kotori`). Its
first line names the model and prompt version. Senses are named by their first gloss, quoted from
**JMdict**, © the Electronic Dictionary Research and Development Group
(<https://www.edrdg.org/jmdict/j_jmdict.html>), used under its licence, CC BY-SA 4.0
(<https://www.edrdg.org/edrdg/licence.html>).

Unlike the code in this repository, which is under the MIT licence in `/LICENSE`, the file is an
adaptation of JMdict and is shared under the Creative Commons Attribution-ShareAlike 4.0
International licence: <https://creativecommons.org/licenses/by-sa/4.0/>. Changes: each line keeps a
word's entry id, headword and the first gloss of each sense judged formal, with the judgment's
probability.
