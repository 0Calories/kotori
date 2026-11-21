import type { Note, SearchMatch } from "@kotori/contracts"
import {
  deinflect,
  englishPhraseVariants,
  englishSearchTerms,
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

interface Hit {
  readonly note: Note
  readonly score: number
  readonly strong: boolean
}

interface Fields {
  readonly language: "ja" | "en"
  readonly forms: ReadonlyArray<string>
  readonly glosses: ReadonlyArray<string>
}

const unique = <A>(items: Iterable<A>) => [...new Set(items)]

const fieldsOf = (note: Note): Fields => {
  const { entry, senses } = note
  // An English word's `reading` is IPA ("/rɛd/"), not a spelling to search by.
  const rawForms = entry.language === "en" ? [entry.headword] : [entry.headword, entry.reading]
  return {
    language: entry.language,
    forms: unique(rawForms.filter((form) => form.length > 0)),
    glosses: unique(senses.flatMap((sense) => sense.glosses).filter((gloss) => gloss.length > 0))
  }
}

const japaneseCandidates = (query: string) => {
  const full = toFullwidth(query)
  const variants = unique([query, full, katakanaToHiragana(query), katakanaToHiragana(full)])
  return { variants, candidates: variants.flatMap(deinflect) }
}

const japaneseGlossQuery = (query: string) => {
  const terms = unique([query, katakanaToHiragana(query)].flatMap((v) => deinflect(v).map((c) => c.term)))
  // Adjectival nouns are glossed as they modify a noun: きれい → きれいな.
  const norms = new Set(terms.flatMap((term) => [normalizeJapaneseGloss(term), `${term}な`, `${term}の`]))
  const norm = katakanaToHiragana(normalizeJapaneseGloss(query))
  return { norms, norm }
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
    const partial = prefix ? 400 + headword : inside ? 300 : null
    return partial === null ? exact : [...exact, { note, score: partial, strong: false }]
  })

const japaneseGlossHits = (
  note: Note,
  fields: Fields,
  { norms, norm }: ReturnType<typeof japaneseGlossQuery>
): Array<Hit> =>
  fields.glosses.flatMap((gloss, position): Array<Hit> => {
    const glossNorm = normalizeJapaneseGloss(gloss)
    const hiraganaNorm = katakanaToHiragana(glossNorm)
    if (norms.has(glossNorm) || norms.has(hiraganaNorm)) return [{ note, score: 700 - 3 * position, strong: true }]
    if (norm.length > 0 && hiraganaNorm.includes(norm)) return [{ note, score: 300 - 3 * position, strong: false }]
    return []
  })

const stems = (word: string) => [word, ...uninflect(word).map((guess) => guess.base)]

const stemGroups = (terms: string): ReadonlyArray<ReadonlyArray<string>> => terms.split(" ").map(stems)

const wordsOf = (text: string) =>
  normalizeGloss(text)
    .split(" ")
    .filter((word) => word.length > 0)

const hasEveryWord = (text: string, termStems: ReadonlyArray<ReadonlyArray<string>>) => {
  const words = new Set(wordsOf(text).flatMap(stems))
  return termStems.every((group) => group.some((stem) => words.has(stem)))
}

const JAPANESE_TEXT = /[　-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ々〆ヵヶ]+/g

const stripJapanese = (text: string) => text.replace(JAPANESE_TEXT, " ").trim()

const englishTexts = (fields: Fields) => ({
  forms: fields.forms.filter((form) => !hasJapanese(form)),
  glosses:
    fields.language === "ja"
      ? fields.glosses.map(stripJapanese).filter((gloss) => gloss.length > 0)
      : fields.glosses.filter((gloss) => !hasJapanese(gloss))
})

const englishQuery = (query: string) => {
  const lower = query.toLowerCase()
  const variants = new Set(englishPhraseVariants(query))
  const bases = new Set(uninflect(query).map((guess) => guess.base))
  const phraseNorm = normalizeEnglishPhrase(query)
  const terms = englishSearchTerms(query)
  const termStems = terms === null ? null : stemGroups(terms)
  const norm = normalizeGloss(query)
  return { query, lower, variants, bases, phraseNorm, termStems, norm }
}

const englishHits = (
  note: Note,
  fields: Fields,
  { query, lower, variants, bases, phraseNorm, termStems, norm }: ReturnType<typeof englishQuery>
): Array<Hit> => {
  const { forms, glosses } = englishTexts(fields)

  const byForm = forms.flatMap((form): Array<Hit> => {
    const formLower = form.toLowerCase()
    const exactCase = form === query ? 20 : 0
    if (formLower === lower) return [{ note, score: 1000 + exactCase, strong: true }]
    if (variants.has(normalizeGloss(form))) return [{ note, score: 900, strong: true }]
    if (bases.has(formLower)) return [{ note, score: 750, strong: true }]
    if (termStems !== null && hasEveryWord(form, termStems)) {
      const phraseExact = phraseNorm.length > 0 && normalizeEnglishPhrase(form) === phraseNorm
      const startsBonus = formLower.startsWith(lower) ? 15 : 0
      return [{ note, score: phraseExact ? 720 : 500 + startsBonus, strong: phraseExact }]
    }
    if (formLower.startsWith(lower)) return [{ note, score: 400, strong: false }]
    return formLower.includes(lower) ? [{ note, score: 300, strong: false }] : []
  })

  const byGloss = glosses.flatMap((gloss, position): Array<Hit> => {
    const order = -3 * position
    const glossNorm = normalizeGloss(gloss)
    const phraseExact =
      variants.has(glossNorm) || (phraseNorm.length > 0 && normalizeEnglishPhrase(gloss) === phraseNorm)
    if (phraseExact) return [{ note, score: 700 + (glossNorm === norm ? 5 : 0) + order, strong: true }]
    if (termStems !== null && hasEveryWord(gloss, termStems)) {
      return [{ note, score: 500 + (glossNorm.startsWith(norm) ? 15 : 0) + order, strong: true }]
    }
    return glossNorm.includes(norm) && norm.length > 0 ? [{ note, score: 300 + order, strong: false }] : []
  })

  return [...byForm, ...byGloss]
}

const relaxedHits = (
  note: Note,
  fields: Fields,
  relaxed: ReadonlyArray<ReadonlyArray<ReadonlyArray<string>>>
): Array<Hit> => {
  const { forms, glosses } = englishTexts(fields)
  return [...forms, ...glosses].some((text) => relaxed.some((termStems) => hasEveryWord(text, termStems)))
    ? [{ note, score: 320, strong: false }]
    : []
}

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

export interface NoteSearchResult {
  readonly match: SearchMatch
  readonly notes: ReadonlyArray<Note>
}

export const searchNotes = (notes: ReadonlyArray<Note>, raw: string): NoteSearchResult => {
  const query = raw.normalize("NFKC").trim()
  if (query.length === 0) return { match: "none", notes }
  const fielded = notes.map((note) => [note, fieldsOf(note)] as const)

  let hits: Array<Hit>
  if (hasJapanese(query)) {
    const japanese = japaneseCandidates(query)
    const glossQuery = japaneseGlossQuery(query)
    hits = fielded.flatMap(([note, fields]) => [
      ...japaneseFormHits(note, fields, japanese),
      ...japaneseGlossHits(note, fields, glossQuery)
    ])
  } else {
    const prepared = englishQuery(query)
    const english = fielded.flatMap(([note, fields]) => englishHits(note, fields, prepared))
    const englishIsStrong = english.some((hit) => hit.score >= 680)
    // When English matches strongly (e.g. "mate", "take"), drop deinflected rōmaji guesses like まて → 待つ and rank exact kana hits below English.
    const kana = romajiToKana(query)
    const japanese = kana === null ? null : japaneseCandidates(kana)
    const romaji =
      japanese === null
        ? []
        : fielded.flatMap(([note, fields]) =>
            japaneseFormHits(note, fields, japanese)
              .filter((hit) => (englishIsStrong ? hit.score >= 1000 : hit.strong))
              .map((hit) => (englishIsStrong ? { ...hit, score: hit.score - 400 } : hit))
          )
    hits = [...english, ...romaji]
    const found = new Set(hits.map((hit) => hit.note.id)).size
    const relaxed = (found < 3 ? relaxedEnglishSearchTerms(query) : []).map(stemGroups)
    if (relaxed.length > 0) hits.push(...fielded.flatMap(([note, fields]) => relaxedHits(note, fields, relaxed)))
    if (new Set(hits.map((hit) => hit.note.id)).size === 0) hits.push(...fuzzyHits(fielded, query))
  }

  const best = keepBest(hits, (hit) => hit.note.id)
  return {
    match: best.length === 0 ? "none" : best.some((hit) => hit.strong) ? "exact" : "weak",
    notes: best.map((hit) => hit.note)
  }
}
