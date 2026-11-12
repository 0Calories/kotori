import { type Language, otherLanguage, ProposalRoute } from "@kotori/contracts"
import type { ChoiceQuestion, EntryType } from "@typesafe-ai/sdk"
import { averagedChoice, REVERSED, reversedChoice } from "../providers/choices.ts"

/**
 * Where an Ask Kotori query goes after the deterministic checks: Jev sorts it by what kind of
 * input it is — never by whether it knows the word, which is Claude's call — so the costly
 * lexicographer only sees things that are lookups, and sentences, names, other languages and
 * keyboard mash get a fitting answer at a fraction of the price. A proposal's `route`.
 */
export type AskRoute = ProposalRoute
export const ASK_ROUTES: ReadonlyArray<AskRoute> = ProposalRoute.literals

/** Bumped when the routing question is reworded or its options change; stored with every triage. */
export const TRIAGE_VERSION = 1

/** `lookup` at or above this goes to Claude; below it, another route needs `ROUTE_SURE` to win. */
export const LOOKUP_ROUTED = 0.5
/** How sure Jev must be of a non-lookup route to turn a query away without asking Claude. */
export const ROUTE_SURE = 0.7
/** A rejection by Claude of a query Jev was this sure was a lookup is flagged for the admin. */
export const CONTESTED_AT = 0.7

const NAMES: Record<Language, string> = { en: "English", ja: "Japanese" }

const route: ChoiceQuestion = {
  type: "choice",
  instructions:
    "A learner of `target_language` (a native `native_language` speaker) typed `query` into a dictionary search that found nothing, and is about to ask for help. What kind of input is `query`? Judge its form, not whether you know the word: new slang, rare idioms and misspellings are still lookups.",
  criteria: {
    lookup:
      "A word, phrase, idiom or expression in `target_language` to look up — including slang, abbreviations, dialect, misspellings and words you don't recognise, e.g. bussin, a stone's throw, それな, 蛙化現象",
    sentence:
      "A whole sentence, question or request rather than a dictionary headword, e.g. how do I say thank you politely, is this sentence natural, 明日は雨が降りますか",
    name: "A proper name: a person, place, brand, product, title or character, e.g. Taylor Swift, Nintendo, Shibuya",
    other_language:
      "Written in a language other than `target_language` (a `native_language` word typed into the wrong dictionary counts), e.g. ありがとう for a learner of English, umbrella for a learner of Japanese",
    garbage: "Not language: keyboard mash, random letters, a code, a number or emoji, e.g. asdkjhqwe, 12345, xqzvy"
  }
}

export interface TriageRequest {
  readonly state: EntryType
  readonly questions: Record<string, ChoiceQuestion>
}

/** The routing question, asked in both option orders as every Kotori Choice is. */
export const triageRequest = (query: string, language: Language): TriageRequest => ({
  state: {
    query,
    target_language: NAMES[language],
    native_language: NAMES[otherLanguage(language)]
  },
  questions: { route, [`route${REVERSED}`]: reversedChoice(route) }
})

export interface Triage {
  readonly route: AskRoute
  /** Whether Jev was sure enough to decide; false when the query fell through to Claude by default. */
  readonly decided: boolean
  /** The two orders' probabilities averaged, per route. */
  readonly probabilities: Readonly<Record<AskRoute, number>>
}

/**
 * The route Jev's answers point to. Lookups win at `LOOKUP_ROUTED`; otherwise the likeliest other
 * route needs `ROUTE_SURE`, and anything less sure is treated as a lookup: a real question must
 * never be lost to a hesitant classifier, and the rate limits bound what that costs.
 */
export const interpretTriage = (answers: Readonly<Record<string, unknown>>): Triage => {
  const { probabilities, orders } = averagedChoice(answers, "route", ASK_ROUTES)
  if (orders === 0 || probabilities.lookup >= LOOKUP_ROUTED) {
    return { route: "lookup", decided: orders > 0, probabilities }
  }
  const best = ASK_ROUTES.filter((name) => name !== "lookup").reduce((top, name) =>
    probabilities[name] > probabilities[top] ? name : top
  )
  return probabilities[best] >= ROUTE_SURE
    ? { route: best, decided: true, probabilities }
    : { route: "lookup", decided: false, probabilities }
}
