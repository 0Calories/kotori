import { CASTS } from "@kotori/ai"
import {
  type Enrichment,
  type Entry,
  EntryId,
  type EntryRecord,
  type Example,
  type Label,
  type Sense,
  type SimilarWord,
  type Tag
} from "@kotori/contracts"
import { normalizeGloss, normalizeJapaneseGloss, romanize } from "@kotori/language"
import { Effect } from "effect"
import type { DatabaseShape } from "../../db/Database.ts"
import { entryClips, exampleClips } from "../audio/index.ts"
import type { ExampleRow } from "../enrichment/index.ts"
import { examplesFor, sentencesHeard } from "../enrichment/index.ts"
import { findForms, getEntries, tagNames } from "./queries.ts"
import { audioUrl, firstGlosses, unique } from "./shared.ts"
import { type Candidate, differenceOf, pickCandidates, senseLabels } from "./similar.ts"
import {
  cautionsFor,
  frequencyFor,
  labelsBySense,
  loanLinkFor,
  sharedGlossesBySense,
  usagePatternsBySense
} from "./usage.ts"

// Building an entry as the app shows it: its forms and senses, cross-references resolved, the
// labels, usage patterns, cautions and similar words the enrichment model derives, and its
// example sentences and audio.

const toExample = (example: ExampleRow, clips: ReadonlyMap<string, string>): Example => {
  const ja = clips.get(`${example.id}:ja`)
  const en = clips.get(`${example.id}:en`)
  return {
    id: example.id,
    ja: example.ja,
    furigana: example.furigana,
    en: example.en,
    formality: example.formality,
    note: example.note,
    noteJa: example.noteJa,
    source: example.source,
    audioUrl: ja === undefined ? null : audioUrl(ja),
    translationAudioUrl: en === undefined ? null : audioUrl(en)
  }
}

/** Glosses run together as each language lists them: "to eat; to dine", "食べる、食事をする". */
const joinGlosses = (entry: EntryRecord, glosses: ReadonlyArray<string>) =>
  glosses.join(entry.language === "ja" ? "; " : "、")

/** The earliest sense of `similar` sharing a gloss with `sense`, or null when none does. */
const sharedSense = (sense: EntryRecord["senses"][number], similar: EntryRecord): number | null => {
  // Glosses are in the other language from the headword, normalised as the import stores them.
  const norm = similar.language === "ja" ? normalizeGloss : normalizeJapaneseGloss
  const own = new Set(sense.glosses.map((gloss) => norm(gloss.text)).filter((text) => text.length > 1))
  const index = similar.senses.findIndex((candidate) => candidate.glosses.some((gloss) => own.has(norm(gloss.text))))
  return index === -1 ? null : index
}

/** At most this many similar words under one sense: the closest, cross-references first. */
const SIMILAR_PER_SENSE = 4

/** The sense a JMDict cross-reference names ("食べる・たべる・2"), counted from 0; null when it names none. */
const xrefSense = (xref: string) => {
  const last = xref.split("・").at(-1) ?? ""
  return xref.includes("・") && /^\d+$/.test(last) ? Number(last) - 1 : null
}

/** The entry `entry` as the app shows it, its enrichment status from `enrichment`, read last. */
export const assembleEntry = Effect.fnUntraced(function* (
  db: DatabaseShape,
  entry: EntryRecord,
  enrichment: Effect.Effect<Enrichment>
) {
  const tags = yield* tagNames(db)
  const tag = (code: string): Tag => ({ code, name: tags.get(code) ?? code })

  const examples = yield* examplesFor(db, [entry.id])
  // A seeded sentence beside Kotori's is shown without the clip it may have from before they came.
  const exampleAudio = yield* exampleClips(
    db,
    sentencesHeard(examples).map((example) => example.id)
  )
  const headwordClips = (yield* entryClips(db, [entry.id])).get(entry.id) ?? []
  const voiceName = (voice: string | null) =>
    voice === null ? null : (CASTS[entry.language].find((candidate) => candidate.id === voice)?.name ?? null)

  // Cross-references point within the entry's own dictionary: JMDict's are "text・reading・sense",
  // an English word's are its synonyms and antonyms, matched whatever their case.
  const xrefTexts = unique(entry.senses.flatMap((s) => [...s.xrefs, ...s.antonyms]).map((x) => x.split("・")[0]!))
  const xrefMatches = yield* findForms(db, xrefTexts, entry.language)
  // "上手・うわて" names the 上手 read うわて, not じょうず: a reading picks among words spelled alike.
  const readingOf = (xref: string) => {
    const reading = xref.split("・")[1]
    return reading !== undefined && !/^\d+$/.test(reading) ? reading : null
  }
  const xrefReadings = unique(
    entry.senses.flatMap((s) => [...s.xrefs, ...s.antonyms]).flatMap((x) => readingOf(x) ?? [])
  )
  const readAs = new Set((yield* findForms(db, xrefReadings, entry.language)).map((m) => `${m.entryId}\u0000${m.text}`))
  const fold = (text: string) => (entry.language === "en" ? text.toLowerCase() : text)
  const resolve = (xref: string) => {
    const [text = xref, reading] = xref.split("・")
    const read = readingOf(xref)
    const pick = (pool: ReadonlyArray<(typeof xrefMatches)[number]>) =>
      pool.find((m) => m.text === text && m.kind !== "inflection") ?? pool.find((m) => fold(m.text) === fold(text))
    const match =
      (read === null ? undefined : pick(xrefMatches.filter((m) => readAs.has(`${m.entryId}\u0000${read}`)))) ??
      pick(xrefMatches)
    return {
      text: reading !== undefined && !/^\d+$/.test(reading) ? `${text}（${reading}）` : text,
      entryId: match ? EntryId.make(match.entryId) : null
    }
  }

  // The enrichment model: labels (the word's, then what each sense adds), usage patterns, cautions,
  // frequency signals, the loan link, and similar words derived from cross-references and shared glosses.
  const ownLabels = (yield* labelsBySense(db, [entry.id])).get(entry.id) ?? new Map<number, Array<Label>>()
  const stated = senseLabels(entry.senses.map((_, index) => ownLabels.get(index) ?? []))
  const usagePatternRows = yield* usagePatternsBySense(db, entry.id)

  const candidates: Array<Candidate> = [
    ...entry.senses.flatMap((sense, index) =>
      sense.xrefs.flatMap((xref): Array<Candidate> => {
        const { entryId } = resolve(xref)
        return entryId === null ? [] : [{ sense: index, entryId, otherSense: xrefSense(xref), via: "xref" }]
      })
    ),
    ...(yield* sharedGlossesBySense(db, entry.id, SIMILAR_PER_SENSE)).map((row): Candidate => ({
      ...row,
      via: "gloss"
    }))
  ]
  const picked = pickCandidates(entry.id, candidates, SIMILAR_PER_SENSE)
  const pickedIds = unique(picked.map((candidate) => EntryId.make(candidate.entryId)))
  const pickedEntries = new Map((yield* getEntries(db, pickedIds)).map((e) => [e.id, e]))
  const pickedLabels = yield* labelsBySense(db, pickedIds)
  const codes = (labels: ReadonlyArray<Label> | undefined) => (labels ?? []).map((label) => label.code)
  const similarWords = (index: number) =>
    picked
      .filter((candidate) => candidate.sense === index)
      .flatMap((candidate): Array<SimilarWord> => {
        const other = pickedEntries.get(EntryId.make(candidate.entryId))
        if (other === undefined) return []
        // A cross-reference naming no sense is close where the two share a gloss, else at
        // the word's first meanings.
        const shared = candidate.otherSense ?? sharedSense(entry.senses[index]!, other)
        const otherSense = shared !== null && other.senses[shared] !== undefined ? shared : null
        return [
          {
            entryId: EntryId.make(other.id),
            headword: other.headword,
            reading: other.reading,
            meaning:
              otherSense === null
                ? joinGlosses(other, firstGlosses(other, 2))
                : joinGlosses(
                    other,
                    other.senses[otherSense]!.glosses.slice(0, 2).map((gloss) => gloss.text)
                  ),
            difference: differenceOf(
              codes(ownLabels.get(index)),
              codes(pickedLabels.get(other.id)?.get(otherSense ?? 0))
            ),
            via: candidate.via
          }
        ]
      })

  const senses = entry.senses.map((sense, index): Sense => ({
    index,
    glosses: sense.glosses.map((gloss) => gloss.text),
    partsOfSpeech: sense.pos.map(tag),
    fields: sense.fields.map(tag),
    info: sense.info,
    appliesTo: [...sense.stagk, ...sense.stagr],
    related: sense.xrefs.map(resolve),
    antonyms: sense.antonyms.map(resolve),
    origins: [...sense.origins],
    examples: examples.filter((example) => example.sense === index).map((example) => toExample(example, exampleAudio)),
    labels: stated.senses[index] ?? [],
    usagePatterns: usagePatternRows.get(index) ?? [],
    similarWords: similarWords(index)
  }))

  return {
    id: EntryId.make(entry.id),
    language: entry.language,
    source: entry.source,
    headword: entry.headword,
    reading: entry.reading,
    romaji: entry.language === "ja" ? romanize(entry.reading) : "",
    common: entry.common,
    usuallyKana: entry.senses[0]?.misc.includes("uk") ?? false,
    labels: stated.word,
    frequency: yield* frequencyFor(db, entry.id),
    loanLink: yield* loanLinkFor(db, entry.id),
    cautions: yield* cautionsFor(db, entry.id),
    forms: entry.forms
      .filter((form) => !form.tags.includes("sK") && !form.tags.includes("sk"))
      .map((form) => ({ text: form.text, kind: form.kind, common: form.common, tags: form.tags.map(tag) })),
    senses,
    audioUrl: headwordClips[0] === undefined ? null : audioUrl(headwordClips[0].key),
    audio: headwordClips.map((clip) => ({
      url: audioUrl(clip.key),
      voice: clip.voice,
      voiceName: voiceName(clip.voice)
    })),
    enrichment: yield* enrichment
  } satisfies Entry
})
