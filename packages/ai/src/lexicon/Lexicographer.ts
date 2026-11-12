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
  pos: Schema.Array(Schema.String),
  labels: Schema.Array(Schema.String),
  usagePatterns: Schema.Array(Schema.String)
})

const DraftCautionOutput = Schema.Struct({
  kind: Schema.String,
  text: Schema.String,
  /** The sense it is about, numbered from 1 as listed; null for the whole word. */
  sense: Schema.NullOr(Schema.Int),
  about: Schema.NullOr(Schema.String)
})

export const DraftOutput = Schema.Struct({
  /** What the query is: a real expression to draft, one of the candidates, or not real. */
  verdict: Schema.Literals(["entry", "link", "reject"]),
  /**
   * For `link`: the candidate's number, as listed. A number rather than the headword, so two
   * entries written alike (上手 read じょうず or うわて, "Polish" and "polish") can't be confused.
   */
  link: Schema.NullOr(Schema.Int),
  /** For `reject`: why, in the asker's native language, in one or two sentences. */
  reason: Schema.NullOr(Schema.String),
  /** For `entry`: the draft, checked and trimmed by the caller before it is stored. */
  entry: Schema.NullOr(
    Schema.Struct({
      headword: Schema.String,
      reading: Schema.String,
      spellings: Schema.Array(Schema.String),
      frequency: Schema.Int,
      senses: Schema.Array(DraftSenseOutput),
      cautions: Schema.Array(DraftCautionOutput)
    })
  )
})
export type DraftOutput = typeof DraftOutput.Type

/**
 * The label codes a draft may use: the dictionary's label vocabulary, so an approved draft wears
 * the same labels as the dictionary's words. Only what differs from a neutral, current word anyone
 * says; the caller drops any other code.
 */
const LABELS =
  "col (casual, conversational), sl (slang), net-sl (internet slang), vulg (vulgar), X (offensive), derog (derogatory), joc (humorous), euph (euphemistic), chn (children's), form (formal, written), hon (respectful), hum (humble), pol (polite), male (mostly said by men), fem (mostly said by women), dated, arch (archaic), rare, id (idiom), proverb, abbr (abbreviation), on-mim (onomatopoeia)"

const CAUTIONS = {
  ja: "rude_upward (sounds rude to a superior), keigo_direction (respectful vs humble, said of whom), set_phrase (a fixed phrase with a fixed use), particle_pattern (the particle it takes), gendered_speech, confusable (a word it is easily mixed up with), collocation (what it goes with)",
  en: "wasei_eigo (a katakana loan that means something else in English), textbook_english (correct but stiff or dated as taught), directness (how blunt or soft it lands), variety (differs between US, UK and other English), confusable, collocation"
} as const

const system = (language: Language) => {
  const [target, native, readingNote, posNote] =
    language === "en"
      ? [
          "English",
          "Japanese",
          'IPA between slashes, e.g. "/ˈbʌsɪn/"; "" when unsure',
          "n, v, vt, vi, adj, adv, exp (expression/idiom), int (interjection), pn (pronoun), prep, conj"
        ]
      : [
          "Japanese",
          "English",
          'the reading in hiragana, e.g. "それな"; katakana words keep katakana',
          "n, v5r/v1/vs (verbs), adj-i, adj-na, adv, exp (expression/idiom), int (interjection)"
        ]
  return `You are the lexicographer behind "Ask Kotori" in a ${target}–${native} learners' dictionary. A learner (a native ${native} speaker learning ${target}) searched for something the dictionary has no entry for. You are given their query and the lookalike entries the search did find.

Decide what the query is, and answer with one verdict:

- "link": the query is a variant, misspelling, inflection or rephrasing of one of the listed candidates — the learner was looking for that entry. Put the candidate's number in "link", as listed. Choose this whenever a candidate truly answers the query ("it be like it be" → "it is what it is"); never draft a near-duplicate of a listed entry. Only a listed candidate can be linked: when none answers the query, or none is listed, choose "entry" or "reject" instead.
- "entry": the query is a real ${target} expression natives use (or a well-attested variant with its own identity) that the dictionary should gain. Draft the entry.
- "reject": the query is not a real ${target} expression — random letters, a sentence fragment, a name, another language, or something no native would recognise. Say why in "reason", in ${native}, kindly, in one or two sentences; if it only looks misspelled, suggest the likely spelling there.

When drafting an entry:
- "headword": the expression in its canonical dictionary form (lowercase for English unless a proper part is capitalised; placeholders like "one's"/"someone" where idioms take them).
- "reading": ${readingNote}.
- "spellings": other ways it is commonly written, including the query itself when it differs from the headword; [] when there are none.
- "frequency": how commonly natives use it today, 1–5: 5 everyone says or hears it daily, 4 widely known and used, 3 known to most but not everyday, 2 understood but rarely said (or old-fashioned), 1 barely known or only in old texts.
- "senses": 1–3 senses, commonest first. Each sense has:
  - "glosses": 1–4 in ${native}, concise, as a dictionary would put them.
  - "pos": part-of-speech codes from: ${posNote}; [] when unclear.
  - "labels": codes from: ${LABELS}; [] when it is neutral, current and anyone says it. Label only what a native dictionary would mark.
  - "usagePatterns": 0–2 short notes in ${native} on how natives use it — the construction it appears in, who says it to whom, in what setting. [] when the glosses and labels say it all. Don't restate a label. Usage only: no etymology, origins, dates or history, which a learner can't check and a wrong one misleads.
- "cautions": 0–3 for the whole entry, only where a ${native} speaker would be surprised or misled — most entries need none. Each has a "kind" from: ${CAUTIONS[language]}; a "text" of one or two sentences in ${native}; "sense", the number of the sense it is about (1 for the first), or null for the whole word; and "about", another ${target} word it compares with, as written, or null. Never write a caution a label already says: the page shows each label with its meaning, so col, sl and net-sl already tell the learner the word is casual or slang and out of place with elders, superiors or in formal settings, vulg that it offends, dated that it sounds old. A slang word needs no "it's slang, avoid it in formal settings" caution; write one only for a surprise beyond that. Name a sense by what it means, never by its number, in the text. No etymology, origins or dates here either.

Accuracy over coverage: draft only what you know natives really say, with meanings you are sure of. If you half-recognise the query but can't pin its meaning down, reject and say so. The draft is marked unverified and reviewed by a person before it becomes a real entry.`
}

const prompt = (request: DraftRequest) => {
  const candidates =
    request.candidates.length === 0
      ? "The search found nothing at all."
      : `The search found only these lookalikes, numbered for "link":\n${request.candidates
          .map(
            (candidate, index) =>
              `${index + 1}. ${candidate.headword}${candidate.reading.length > 0 ? `（${candidate.reading}）` : ""}: ${candidate.meanings.join("; ")}`
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
