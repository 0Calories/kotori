import type { Language } from "@kotori/contracts"
import { Context, Effect, Layer, Schema } from "effect"
import { Claude, type ClaudeError } from "../providers/Claude.ts"

/** An existing entry shown to Claude so it links rather than drafts a duplicate. */
export interface DraftCandidate {
  readonly headword: string
  readonly reading: string
  /** Its first meanings, in the asker's native language. */
  readonly meanings: ReadonlyArray<string>
}

export interface DraftRequest {
  /** The search that found nothing, as typed. */
  readonly query: string
  /** The language of the word asked about; the asker's native language is the other one. */
  readonly language: Language
  /** The near misses the search did find, for linking. */
  readonly candidates: ReadonlyArray<DraftCandidate>
}

const DraftSenseOutput = Schema.Struct({
  glosses: Schema.Array(Schema.String),
  partOfSpeech: Schema.NullOr(Schema.String),
  labels: Schema.Array(Schema.String),
  note: Schema.NullOr(Schema.String)
})

export const DraftOutput = Schema.Struct({
  /** What the query is: a real expression to draft, one of the candidates, or not real. */
  verdict: Schema.Literals(["entry", "link", "reject"]),
  /** For `link`: the candidate's headword, copied exactly. */
  link: Schema.NullOr(Schema.String),
  /** For `reject`: why, in the asker's native language, in one or two sentences. */
  reason: Schema.NullOr(Schema.String),
  /** For `entry`: the draft. */
  entry: Schema.NullOr(
    Schema.Struct({
      headword: Schema.String,
      reading: Schema.String,
      spellings: Schema.Array(Schema.String),
      currency: Schema.Literals(["archaic", "dated", "current", "trendy"]),
      senses: Schema.Array(DraftSenseOutput)
    })
  )
})
export type DraftOutput = typeof DraftOutput.Type

/**
 * The tag codes a draft may use, shared with the dictionary so approved drafts wear the same
 * labels (`packages/contracts` TAG_JUDGMENTS reads them, search penalties apply to them).
 */
const LABELS =
  "sl (slang), net-sl (internet slang), col (colloquial), vulg (vulgar), X (offensive), derog (derogatory), id (idiom), proverb, abbr (abbreviation), dated, arch (archaic), rare, joc (humorous), euph (euphemistic), chn (children's), on-mim (onomatopoeia), form (formal)"

const system = (language: Language) => {
  const [target, native, readingNote, posNote] =
    language === "en"
      ? [
          "English",
          "Japanese",
          'IPA between slashes, e.g. "/ˈbʌsɪn/"; "" when unsure',
          "n, v, adj, adv, exp (expression/idiom), int (interjection), pn (pronoun), prep, conj"
        ]
      : [
          "Japanese",
          "English",
          'the reading in hiragana, e.g. "それな"; katakana words keep katakana',
          "n, v5r/v1/vs (verbs), adj-i, adj-na, adv, exp (expression/idiom), int (interjection)"
        ]
  return `You are the lexicographer behind "Ask Kotori" in a ${target}–${native} learners' dictionary. A learner (a native ${native} speaker learning ${target}) searched for something the dictionary has no entry for. You are given their query and the lookalike entries the search did find.

Decide what the query is, and answer with one verdict:

- "link": the query is a variant, misspelling, inflection or rephrasing of one of the listed candidates — the learner was looking for that entry. Put the candidate's headword in "link", copied exactly as listed. Choose this whenever a candidate truly answers the query ("it be like it be" → "it is what it is"); never draft a near-duplicate of a listed entry.
- "entry": the query is a real ${target} expression natives use (or a well-attested variant with its own identity) that the dictionary should gain. Draft the entry.
- "reject": the query is not a real ${target} expression — random letters, a sentence fragment, a name, another language, or something no native would recognise. Say why in "reason", in ${native}, kindly, in one or two sentences; if it only looks misspelled, suggest the likely spelling there.

When drafting an entry:
- "headword": the expression in its canonical dictionary form (lowercase for English unless a proper part is capitalised; placeholders like "one's"/"someone" where idioms take them).
- "reading": ${readingNote}.
- "spellings": other ways it is commonly written, including the query itself when it differs from the headword; [] when there are none.
- "currency": how it feels in present-day ${target} — "trendy" (recent coinage or buzzword), "current" (ordinary use), "dated" (understood, but old-fashioned), "archaic" (old texts only).
- "senses": 1–3 senses, commonest first. Each sense has 1–4 "glosses" in ${native}, concise, as a dictionary would put them; "partOfSpeech" from: ${posNote}, or null; "labels" from: ${LABELS}, or []; and a "note" in ${native} — one or two sentences on how natives use it (register, who says it, where it came from, pitfalls), or null when the glosses say it all.

Accuracy over coverage: draft only what you know natives really say, with meanings you are sure of. If you half-recognise the query but can't pin its meaning down, reject and say so. The draft is marked unverified and reviewed by a person before it becomes a real entry.`
}

const prompt = (request: DraftRequest) => {
  const candidates =
    request.candidates.length === 0
      ? "The search found nothing at all."
      : `The search found only these lookalikes:\n${request.candidates
          .map(
            (candidate) =>
              `- ${candidate.headword}${candidate.reading.length > 0 ? `（${candidate.reading}）` : ""}: ${candidate.meanings.join("; ")}`
          )
          .join("\n")}`
  return `Query: ${JSON.stringify(request.query)}\n\n${candidates}`
}

/** Judges a query the dictionary couldn't answer and drafts, links or rejects it; see `DraftOutput`. */
export class Lexicographer extends Context.Service<
  Lexicographer,
  {
    draft(request: DraftRequest): Effect.Effect<DraftOutput & { readonly model: string }, ClaudeError>
  }
>()("@kotori/ai/Lexicographer") {
  static readonly layer = Layer.effect(
    Lexicographer,
    Effect.gen(function* () {
      const claude = yield* Claude
      const draft = Effect.fn("Lexicographer.draft")(function* (request: DraftRequest) {
        const output = yield* claude.generate({
          schema: DraftOutput,
          system: system(request.language),
          prompt: prompt(request),
          effort: "medium"
        })
        return { ...output, model: claude.model }
      })
      return Lexicographer.of({ draft })
    })
  )
}
