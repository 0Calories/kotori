import type { Note, SearchMatch } from "@kotori/contracts"
import {
  deinflect,
  englishPhraseVariants,
  englishSearchTerms,
  furiganaToKana,
  furiganaToText,
  hasJapanese,
  katakanaToHiragana,
  keepBest,
  nearBest,
  normalizeEnglishPhrase,
  normalizeGloss,
  normalizeJapaneseGloss,
  relaxedEnglishSearchTerms,
  romajiToKana,
  toFullwidth,
  trigramFloor,
  trigramSimilarity,
  trigramTargets,
  TRIGRAM_THRESHOLD,
  uninflect
} from "@kotori/language"

// The dictionary search's ranking, run over the notes the app has loaded: a word as written or
// inflected answers best, then a meaning with every word of the query, then prefixes and text that
// merely contains the query, then (only when little else is found) a phrase with a word left out,
// and typos when nothing else is. Japanese is matched in kana as well as kanji, and rōmaji is read as kana.
// The scores keep the dictionary's tiers (`Dictionary.ts`) so the two order results alike.

interface Hit {
  readonly note: Note
  readonly score: number
  /** Whether the note answers the query rather than resembling it; see `SearchMatch`. */
  readonly strong: boolean
}

/** What a note is searched by. */
interface Fields {
  /** The word or phrase being learned, as written and in kana; the first is the headword. */
  readonly forms: ReadonlyArray<string>
  /** Its meanings, one gloss each, in the learner's language. */
  readonly glosses: ReadonlyArray<string>
  /** A usage note, matched only by its words. */
  readonly note: string | null
}

const unique = <A>(items: Iterable<A>) => [...new Set(items)]

/** Glosses as `wordNote` joins them: "to eat; to dine", "食べる、食事をする". */
const GLOSS_SEPARATOR = /\s*[;；、]\s*/

const fieldsOf = (note: Note): Fields => {
  const content = note.content
  if (content.kind === "word") {
    return {
      forms: unique([content.headword, content.reading].filter((form) => form.length > 0)),
      glosses: content.meaning.split(GLOSS_SEPARATOR).filter((gloss) => gloss.length > 0),
      note: content.note ?? null
    }
  }
  const { furigana } = content
  const written =
    furigana === null ? [content.text] : [furiganaToText(furigana), content.text, furiganaToKana(furigana)]
  return {
    forms: unique(written.filter((form) => form.length > 0)),
    glosses: [content.meaning],
    note: content.note
  }
}

// ---------------------------------------------------------------------------
// Japanese text: forms as written or inflected, by prefix or inside a phrase
// ---------------------------------------------------------------------------

/** A Japanese query's spellings, and what each could be the dictionary form of (食べた → 食べる). */
const japaneseCandidates = (query: string) => {
  const full = toFullwidth(query)
  const variants = unique([query, full, katakanaToHiragana(query), katakanaToHiragana(full)])
  return { variants, candidates: variants.flatMap(deinflect) }
}

const japaneseFormHits = (
  note: Note,
  fields: Fields,
  { variants, candidates }: ReturnType<typeof japaneseCandidates>
): Array<Hit> =>
  fields.forms.flatMap((form, index) => {
    const spellings = unique([form, katakanaToHiragana(form)])
    const headword = index === 0 ? 20 : 0
    const exact = candidates
      .filter((candidate) => spellings.includes(candidate.term))
      .map((candidate) => ({
        note,
        score: (candidate.reasons.length === 0 ? 1000 : 800 - 10 * candidate.reasons.length) + headword,
        strong: true
      }))
    const prefix = variants.some((variant) => spellings.some((spelling) => spelling.startsWith(variant)))
    const inside = variants.some((variant) => spellings.some((spelling) => spelling.includes(variant)))
    // Phrases are long; a word inside one is what a learner looks for it by.
    const partial = prefix ? 400 + headword : inside ? 300 : null
    return partial === null ? exact : [...exact, { note, score: partial, strong: false }]
  })

/** Japanese meanings (for English words) as written, in dictionary form, or containing the query. */
const japaneseGlossHits = (note: Note, fields: Fields, query: string): Array<Hit> => {
  const terms = unique([query, katakanaToHiragana(query)].flatMap((v) => deinflect(v).map((c) => c.term)))
  // Adjectival nouns are glossed as they modify a noun: きれい → きれいな.
  const norms = new Set(terms.flatMap((term) => [normalizeJapaneseGloss(term), `${term}な`, `${term}の`]))
  const norm = normalizeJapaneseGloss(query)
  return fields.glosses.flatMap((gloss, position): Array<Hit> => {
    const glossNorm = normalizeJapaneseGloss(gloss)
    if (norms.has(glossNorm)) return [{ note, score: 700 - 3 * position, strong: true }]
    if (norm.length > 0 && glossNorm.includes(norm)) return [{ note, score: 300 - 3 * position, strong: false }]
    return []
  })
}

// ---------------------------------------------------------------------------
// English text: forms and meanings by every word, a word left out, or a typo
// ---------------------------------------------------------------------------

/** A word and the words it could be an inflection of, as stemming would meet them: "eating" → eat. */
const stems = (word: string) => [word, ...uninflect(word).map((guess) => guess.base)]

const wordsOf = (text: string) =>
  normalizeGloss(text)
    .split(" ")
    .filter((word) => word.length > 0)

/** Whether every word of `terms` (`englishSearchTerms`) is in `text`, in any inflection. */
const hasEveryWord = (text: string, terms: string) => {
  const words = new Set(wordsOf(text).flatMap(stems))
  return terms.split(" ").every((term) => stems(term).some((stem) => words.has(stem)))
}

const englishTexts = (fields: Fields) => ({
  forms: fields.forms.filter((form) => !hasJapanese(form)),
  glosses: fields.glosses.filter((gloss) => !hasJapanese(gloss))
})

const englishHits = (note: Note, fields: Fields, query: string): Array<Hit> => {
  const { forms, glosses } = englishTexts(fields)
  const lower = query.toLowerCase()
  const variants = new Set(englishPhraseVariants(query))
  const bases = new Set(uninflect(query).map((guess) => guess.base))
  const phraseNorm = normalizeEnglishPhrase(query)
  const terms = englishSearchTerms(query)
  const norm = normalizeGloss(query)

  const byForm = forms.flatMap((form): Array<Hit> => {
    const formLower = form.toLowerCase()
    const exactCase = form === query ? 20 : 0
    if (formLower === lower) return [{ note, score: 1000 + exactCase, strong: true }]
    if (variants.has(normalizeGloss(form))) return [{ note, score: 900, strong: true }]
    if (bases.has(formLower)) return [{ note, score: 750, strong: true }]
    if (formLower.startsWith(lower)) return [{ note, score: 400, strong: false }]
    if (terms !== null && hasEveryWord(form, terms)) {
      const phraseExact = phraseNorm.length > 0 && normalizeEnglishPhrase(form) === phraseNorm
      return [{ note, score: phraseExact ? 720 : 500, strong: phraseExact }]
    }
    return formLower.includes(lower) ? [{ note, score: 300, strong: false }] : []
  })

  const byGloss = glosses.flatMap((gloss, position): Array<Hit> => {
    const order = -3 * position
    const glossNorm = normalizeGloss(gloss)
    const phraseExact =
      variants.has(glossNorm) || (phraseNorm.length > 0 && normalizeEnglishPhrase(gloss) === phraseNorm)
    if (phraseExact) return [{ note, score: 700 + (glossNorm === norm ? 5 : 0) + order, strong: true }]
    if (terms !== null && hasEveryWord(gloss, terms)) {
      return [{ note, score: 500 + (glossNorm.startsWith(norm) ? 15 : 0) + order, strong: true }]
    }
    return glossNorm.includes(norm) && norm.length > 0 ? [{ note, score: 300 + order, strong: false }] : []
  })

  const byNote =
    terms !== null && fields.note !== null && !hasJapanese(fields.note) && hasEveryWord(fields.note, terms)
      ? [{ note, score: 260, strong: false }]
      : []

  return [...byForm, ...byGloss, ...byNote]
}

/** A phrase of the query with one word left out, for "walk on thin ice" → "skate on thin ice". */
const relaxedHits = (note: Note, fields: Fields, relaxed: ReadonlyArray<string>): Array<Hit> => {
  const { forms, glosses } = englishTexts(fields)
  return [...forms, ...glosses].some((text) => relaxed.some((terms) => hasEveryWord(text, terms)))
    ? [{ note, score: 320, strong: false }]
    : []
}

/** Forms and meanings spelled like the query, for typos: "umbrela" finds umbrella. */
const fuzzyHits = (fielded: ReadonlyArray<readonly [Note, Fields]>, query: string): Array<Hit> => {
  const targets = trigramTargets(query)
  if (targets.length === 0) return []
  const matches = fielded
    .map(([note, fields]) => {
      const { forms, glosses } = englishTexts(fields)
      const similarity = Math.max(
        0,
        ...[...forms, ...glosses].flatMap((text) =>
          targets.map((target) => trigramSimilarity(normalizeGloss(text), target))
        )
      )
      return { note, similarity }
    })
    .filter((match) => match.similarity >= TRIGRAM_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity)
  return nearBest(matches, trigramFloor(query)).map(({ note, similarity }) => ({
    note,
    score: 250 + Math.round(similarity * 100),
    strong: false
  }))
}

// ---------------------------------------------------------------------------

export interface NoteSearchResult {
  /** How well the notes found answer the query, as the dictionary search says it. */
  readonly match: SearchMatch
  /** The notes found, best first; all of them, in their order, for an empty query. */
  readonly notes: ReadonlyArray<Note>
}

/**
 * The saved notes that match `raw`, best first, searched the way the dictionary is: Japanese,
 * English or rōmaji, by the word or phrase saved or by what it means.
 */
export const searchNotes = (notes: ReadonlyArray<Note>, raw: string): NoteSearchResult => {
  const query = raw.normalize("NFKC").trim()
  if (query.length === 0) return { match: "none", notes }
  const fielded = notes.map((note) => [note, fieldsOf(note)] as const)

  let hits: Array<Hit>
  if (hasJapanese(query)) {
    const japanese = japaneseCandidates(query)
    hits = fielded.flatMap(([note, fields]) => [
      ...japaneseFormHits(note, fields, japanese),
      ...japaneseGlossHits(note, fields, query)
    ])
  } else {
    const english = fielded.flatMap(([note, fields]) => englishHits(note, fields, query))
    // Rōmaji counts only as a word written out ("taberu", "tabeta"), never as a prefix of one,
    // so a query in English isn't crowded by the kana its letters happen to spell.
    const kana = romajiToKana(query)
    const japanese = kana === null ? null : japaneseCandidates(kana)
    const romaji =
      japanese === null
        ? []
        : fielded.flatMap(([note, fields]) => japaneseFormHits(note, fields, japanese).filter((hit) => hit.strong))
    hits = [...english, ...romaji]
    // As in the dictionary (`englishFallback`), a phrase with a word left out is tried only when
    // the query's own words found fewer than three notes, and typos only when still nothing is found.
    const found = new Set(hits.map((hit) => hit.note.id)).size
    const relaxed = found < 3 ? relaxedEnglishSearchTerms(query) : []
    if (relaxed.length > 0) hits.push(...fielded.flatMap(([note, fields]) => relaxedHits(note, fields, relaxed)))
    if (new Set(hits.map((hit) => hit.note.id)).size === 0) hits.push(...fuzzyHits(fielded, query))
  }

  const best = keepBest(hits, (hit) => hit.note.id)
  return {
    match: best.length === 0 ? "none" : best.some((hit) => hit.strong) ? "exact" : "weak",
    notes: best.map((hit) => hit.note)
  }
}
