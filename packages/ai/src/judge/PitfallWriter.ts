import { type Language, MAX_PITFALLS, PITFALL_KINDS, type PitfallKind } from "@kotori/contracts"
import { Context, Effect, Layer, Schema } from "effect"
import { LABELS_SAY, NOT_PITFALLS, PITFALL_GUIDE } from "../lexicon/pitfallGuide.ts"
import { Claude, type ClaudeError } from "../providers/Claude.ts"
import { meaningOf, type WordToJudge } from "./word.ts"

/**
 * The pitfall pass: Claude reads dictionary words as the entry page shows them (glosses, labels,
 * the dictionary's notes, a loan's verdict) and writes a pitfall only where a learner would still
 * be surprised. Most words get none. Ask Kotori drafts follow the same rules (`pitfallGuide.ts`).
 */

/** Bumped when the prompt changes; written in the artifact's header. */
export const PITFALLS_VERSION = 3

/** Words per Claude request: enough to share the long system prompt, few enough to read each well. */
export const PITFALL_BATCH = 10

const PitfallOutput = Schema.Struct({
  kind: Schema.String,
  text: Schema.String,
  /** The sense it is about, numbered from 1 as listed; null for the whole word. */
  sense: Schema.NullOr(Schema.Int),
  about: Schema.NullOr(Schema.String)
})

export const PitfallsOutput = Schema.Struct({
  words: Schema.Array(
    Schema.Struct({
      /** The word's number, as listed. */
      word: Schema.Int,
      pitfalls: Schema.Array(PitfallOutput)
    })
  )
})
export type PitfallsOutput = typeof PitfallsOutput.Type

/** A pitfall as checked: a valid kind, a sense that exists (by position), non-empty text. */
export interface WrittenPitfall {
  readonly kind: PitfallKind
  readonly text: string
  /** The sense's position in the word's senses; null for the whole word. */
  readonly sense: number | null
  readonly about: string | null
}

/** Why a pitfall Claude wrote was dropped, for the eval to report. */
export interface DroppedPitfall {
  readonly reason: "kind" | "sense" | "empty" | "numbered" | "cap"
  readonly pitfall: typeof PitfallOutput.Type
}

const NUMBERED =
  /\bsense\s*\d|\bmeaning\s*#?\d|#\d\b|（\d）|\(\d\)|[0-9０-９]+\s*番目?の(?:意味|語義)|語義\s*[0-9０-９]|意味\s*[0-9０-９]/i

/** A sense named by its number in the text ("sense 2", "(2)", "2番目の意味"), which breaks if senses move. */
export const namesSenseByNumber = (text: string) => NUMBERED.test(text)

/** Claude's pitfalls for one word, checked; see `WrittenPitfall`. */
export const checkPitfalls = (
  written: ReadonlyArray<typeof PitfallOutput.Type>,
  word: WordToJudge,
  language: Language
): { readonly pitfalls: ReadonlyArray<WrittenPitfall>; readonly dropped: ReadonlyArray<DroppedPitfall> } => {
  const allowed = new Set<string>(PITFALL_KINDS[language])
  const pitfalls: Array<WrittenPitfall> = []
  const dropped: Array<DroppedPitfall> = []
  for (const pitfall of written) {
    const text = pitfall.text.trim()
    const reason =
      text.length === 0
        ? "empty"
        : !allowed.has(pitfall.kind)
          ? "kind"
          : pitfall.sense !== null && (pitfall.sense < 1 || pitfall.sense > word.senses.length)
            ? "sense"
            : namesSenseByNumber(text)
              ? "numbered"
              : pitfalls.length >= MAX_PITFALLS
                ? "cap"
                : null
    if (reason !== null) {
      dropped.push({ reason, pitfall })
      continue
    }
    const about = pitfall.about?.trim() ?? ""
    pitfalls.push({
      kind: pitfall.kind as PitfallKind,
      text,
      sense: pitfall.sense === null ? null : pitfall.sense - 1,
      about: about.length > 0 && about !== word.headword ? about : null
    })
  }
  return { pitfalls, dropped }
}

export const pitfallSystem = (language: Language) => {
  const [target, native] = language === "ja" ? ["Japanese", "English"] : ["English", "Japanese"]
  const style =
    language === "ja"
      ? "in plain English"
      : "in Japanese, in the polite です・ます style the rest of the app speaks to learners in"
  return `You write the "Watch out" notes of a ${target}–${native} learners' dictionary. Its readers are native ${native} speakers learning ${target}. For each ${target} word you are given what its entry page already shows: its senses with their glosses (in ${native}), part of speech, usage labels and the dictionary's own usage notes, and for a loanword the word it pairs with.

A pitfall is one short teaching about a ${target} word, written only where a ${native} speaker who reads the page would still be surprised or misled: they would use the word wrongly, misread it, or offend without meaning to. Most words need none: a word that means what its glosses say and is used as its labels say gets no pitfall. Return every word, with an empty list when it needs none.

Never repeat the page:
- The labels are shown with their meanings: ${LABELS_SAY}. Don't say any of that again in other words. A word labelled vulgar, derogatory, slang or casual needs no pitfall telling the learner to avoid it with superiors; write one only for a surprise beyond its label.
- The dictionary's notes are shown under their sense. When a note already gives the warning, write nothing about it, even an alternative.
- The glosses are shown. A sense whose gloss already says the surprising use (a gloss "no, thank you" on a word that also means "fine") needs no pitfall just for having it; write one only if learners still trip over it, such as mistaking one use for the other.
- A grammar fact the labels carry, such as being uncountable, is not a pitfall.

These are never pitfalls:
${NOT_PITFALLS}

Each pitfall has:
- "kind", one of: ${PITFALL_GUIDE[language]}.
- "text": one or two short sentences ${style}. Say what natives do and what to say instead when there is a better word. Name a sense by what it means ("in the sense 'to hug'"), never by its number. Usage only: no etymology, origins, dates or history.
- "sense": the number of the sense it is about, as listed, when only that sense has the trap; null when it is about the whole word.
- "about": another ${target} word it compares with or is confused with, written as a dictionary would list it, or null.

At most three per word, the most surprising first; one is usual. Write only what you are sure native speakers would agree with. A pitfall that is wrong, obvious or merely interesting costs the learner's trust in the ones that matter.`
}

const describeWord = (word: WordToJudge, index: number, language: Language) => {
  const lines = [`${index + 1}. ${word.headword}${word.reading.length > 0 ? `（${word.reading}）` : ""}`]
  word.senses.forEach((sense, position) => {
    const details = [
      sense.pos.length > 0 ? sense.pos.join(", ") : null,
      sense.labels.length > 0 ? `labels: ${sense.labels.join(", ")}` : null
    ].filter((detail) => detail !== null)
    lines.push(`   ${position + 1}) ${meaningOf(sense, 8)}${details.length > 0 ? ` [${details.join("; ")}]` : ""}`)
    for (const note of sense.notes) lines.push(`      note: ${note}`)
  })
  const loan = word.loan
  if (loan != null) {
    const meaning =
      loan.meaning === "same"
        ? "means the same"
        : loan.meaning === "divergent"
          ? "has drifted in meaning"
          : "meaning not judged"
    const glosses = loan.glosses.length > 0 ? `: ${loan.glosses.slice(0, 6).join("; ")}` : ""
    lines.push(
      language === "en"
        ? `   katakana loan: ${loan.word} (${meaning})${glosses}`
        : `   borrowed from English: ${loan.word} (${meaning})`
    )
  }
  return lines.join("\n")
}

export const pitfallPrompt = (words: ReadonlyArray<WordToJudge>, language: Language) =>
  `${words.length} ${language === "ja" ? "Japanese" : "English"} words:\n\n${words
    .map((word, index) => describeWord(word, index, language))
    .join("\n\n")}`

/** One word's result: its checked pitfalls, what was dropped, or `missing` when Claude skipped it. */
export interface WordPitfalls {
  readonly missing: boolean
  readonly pitfalls: ReadonlyArray<WrittenPitfall>
  readonly dropped: ReadonlyArray<DroppedPitfall>
}

/** Writes pitfalls for dictionary words, a batch per request; see `pitfallSystem`. */
export class PitfallWriter extends Context.Service<
  PitfallWriter,
  {
    readonly model: string
    /** Each word's pitfalls, in order. */
    write(
      words: ReadonlyArray<WordToJudge>,
      language: Language
    ): Effect.Effect<ReadonlyArray<WordPitfalls>, ClaudeError>
  }
>()("@kotori/ai/PitfallWriter") {
  static readonly layer = Layer.effect(
    PitfallWriter,
    Effect.gen(function* () {
      const claude = yield* Claude
      const write = Effect.fn("PitfallWriter.write")(function* (words: ReadonlyArray<WordToJudge>, language: Language) {
        if (words.length === 0) return []
        const output = yield* claude.generate({
          schema: PitfallsOutput,
          system: pitfallSystem(language),
          prompt: pitfallPrompt(words, language),
          effort: "medium"
        })
        const byNumber = new Map(output.words.map((word) => [word.word, word.pitfalls]))
        return words.map((word, index): WordPitfalls => {
          const written = byNumber.get(index + 1)
          if (written === undefined) return { missing: true, pitfalls: [], dropped: [] }
          return { missing: false, ...checkPitfalls(written, word, language) }
        })
      })
      return PitfallWriter.of({ model: claude.model, write })
    })
  )
}
