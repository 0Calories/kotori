import { CAUTION_KINDS, type CautionKind, type Language, MAX_CAUTIONS } from "@kotori/contracts"
import { Context, Effect, Layer, Schema } from "effect"
import { CAUTION_GUIDE, LABELS_SAY, NOT_CAUTIONS } from "../lexicon/cautionGuide.ts"
import { Claude, ClaudeDeadline, type ClaudeError } from "../providers/Claude.ts"
import { meaningOf, type WordToJudge } from "./word.ts"

export const CAUTIONS_VERSION = 4

export const CAUTION_BATCH = 10

const CautionOutput = Schema.Struct({
  kind: Schema.String,
  text: Schema.String,
  sense: Schema.NullOr(Schema.Int),
  about: Schema.NullOr(Schema.String)
})

export const CautionsOutput = Schema.Struct({
  words: Schema.Array(
    Schema.Struct({
      word: Schema.Int,
      cautions: Schema.Array(CautionOutput)
    })
  )
})
export type CautionsOutput = typeof CautionsOutput.Type

export interface WrittenCaution {
  readonly kind: CautionKind
  readonly text: string
  readonly sense: number | null
  readonly about: string | null
}

export interface DroppedCaution {
  readonly reason: "kind" | "sense" | "empty" | "numbered" | "cap"
  readonly caution: typeof CautionOutput.Type
}

const NUMBERED =
  /\bsense\s*\d|\bmeaning\s*#?\d|#\d\b|（\d）|\(\d\)|[0-9０-９]+\s*番目?の(?:意味|語義)|語義\s*[0-9０-９]|意味\s*[0-9０-９]/i

/** Sense order can change across re-imports, so caution prose must refer to senses by meaning rather than number. */
export const namesSenseByNumber = (text: string) => NUMBERED.test(text)

export const checkCautions = (
  written: ReadonlyArray<typeof CautionOutput.Type>,
  word: WordToJudge,
  language: Language
): {
  readonly cautions: ReadonlyArray<WrittenCaution>
  readonly dropped: ReadonlyArray<DroppedCaution>
} => {
  const allowed = new Set<string>(CAUTION_KINDS[language])
  const cautions: Array<WrittenCaution> = []
  const dropped: Array<DroppedCaution> = []
  for (const caution of written) {
    const text = caution.text.trim()
    const reason =
      text.length === 0
        ? "empty"
        : !allowed.has(caution.kind)
          ? "kind"
          : caution.sense !== null && (caution.sense < 1 || caution.sense > word.senses.length)
            ? "sense"
            : namesSenseByNumber(text)
              ? "numbered"
              : cautions.length >= MAX_CAUTIONS
                ? "cap"
                : null
    if (reason !== null) {
      dropped.push({ reason, caution })
      continue
    }
    const about = caution.about?.trim() ?? ""
    cautions.push({
      kind: caution.kind as CautionKind,
      text,
      sense: caution.sense === null ? null : caution.sense - 1,
      about: about.length > 0 && about !== word.headword ? about : null
    })
  }
  return { cautions, dropped }
}

export const cautionSystem = (language: Language) => {
  const [target, native] = language === "ja" ? ["Japanese", "English"] : ["English", "Japanese"]
  const style =
    language === "ja"
      ? "in plain English"
      : "in Japanese, in the polite です・ます style the rest of the app speaks to learners in"
  return `You write the "Cautions" notes of a ${target}–${native} learners' dictionary. Its readers are native ${native} speakers learning ${target}. For each ${target} word you are given what its entry page already shows: its senses with their glosses (in ${native}), part of speech, usage labels and the dictionary's own usage notes, and for a loanword the word it pairs with.

A caution is one short teaching about a ${target} word, written only where a ${native} speaker who reads the page would still be surprised or misled: they would use the word wrongly, misread it, or offend without meaning to. Most words need none: a word that means what its glosses say and is used as its labels say gets no caution. Return every word, with an empty list when it needs none.

Never repeat the page:
- The labels are shown with their meanings: ${LABELS_SAY}. Don't say any of that again in other words. A word labelled vulgar, derogatory, slang or casual needs no caution telling the learner to avoid it with superiors; write one only for a surprise beyond its label.
- The dictionary's notes are shown under their sense. When a note already says it, write nothing about it, even an alternative.
- The glosses are shown. A sense whose gloss already says the surprising use (a gloss "no, thank you" on a word that also means "fine") needs no caution just for having it; write one only if learners still trip over it, such as mistaking one use for the other.
- A grammar fact the labels carry, such as being uncountable, is not a caution.

These are never cautions:
${NOT_CAUTIONS}

Each caution has:
- "kind", one of: ${CAUTION_GUIDE[language]}.
- "text": one or two short sentences ${style}. Say what natives do and what to say instead when there is a better word. Name a sense by what it means ("in the sense 'to hug'"), never by its number. Usage only: no etymology, origins, dates or history.
- "sense": the number of the sense it is about, as listed, when only that sense has the pitfall; null when it is about the whole word.
- "about": another ${target} word it compares with or is confused with, written as a dictionary would list it, or null.

At most three per word, the most surprising first; one is usual. Write only what you are sure native speakers would agree with. A caution that is wrong, obvious or merely interesting costs the learner's trust in the ones that matter.`
}

const describeWord = (word: WordToJudge, index: number, language: Language) => {
  const lines = [`${index + 1}. ${word.headword}${word.reading.length > 0 ? `（${word.reading}）` : ""}`]
  word.senses.forEach((sense, position) => {
    const details = [
      sense.pos.length > 0 ? sense.pos.join(", ") : null,
      sense.labels.length > 0 ? `labels: ${sense.labels.join(", ")}` : null
    ].filter((detail) => detail !== null)
    lines.push(`   ${position + 1}) ${meaningOf(sense, 8)}${details.length > 0 ? ` [${details.join("; ")}]` : ""}`)
    // Shown to the model as "note:", the wording the prompt was evaluated with.
    for (const pattern of sense.usagePatterns) lines.push(`      note: ${pattern}`)
  })
  const loan = word.loan
  if (loan != null) {
    const meaning =
      loan.meaning === "true_loanword"
        ? "means the same"
        : loan.meaning === "wasei_eigo"
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

export const cautionPrompt = (words: ReadonlyArray<WordToJudge>, language: Language) =>
  `${words.length} ${language === "ja" ? "Japanese" : "English"} words:\n\n${words
    .map((word, index) => describeWord(word, index, language))
    .join("\n\n")}`

export interface EntryCautions {
  readonly missing: boolean
  readonly cautions: ReadonlyArray<WrittenCaution>
  readonly dropped: ReadonlyArray<DroppedCaution>
}

export class CautionWriter extends Context.Service<
  CautionWriter,
  {
    readonly model: string
    write(
      words: ReadonlyArray<WordToJudge>,
      language: Language
    ): Effect.Effect<ReadonlyArray<EntryCautions>, ClaudeError>
  }
>()("@kotori/ai/CautionWriter") {
  static readonly layer = Layer.effect(
    CautionWriter,
    Effect.gen(function* () {
      const claude = yield* Claude
      const write = Effect.fn("CautionWriter.write")(function* (words: ReadonlyArray<WordToJudge>, language: Language) {
        if (words.length === 0) return []
        const output = yield* claude.generate({
          schema: CautionsOutput,
          system: cautionSystem(language),
          prompt: cautionPrompt(words, language),
          effort: "medium",
          timeout: ClaudeDeadline.bulk
        })
        const byNumber = new Map(output.words.map((word) => [word.word, word.cautions]))
        return words.map((word, index): EntryCautions => {
          const written = byNumber.get(index + 1)
          if (written === undefined) return { missing: true, cautions: [], dropped: [] }
          return { missing: false, ...checkCautions(written, word, language) }
        })
      })
      return CautionWriter.of({ model: claude.model, write })
    })
  )
}
