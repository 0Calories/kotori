import { type Language, otherLanguage, ProposalRoute } from "@kotori/contracts"
import type { ChoiceQuestion, EntryType } from "@typesafe-ai/sdk"
import { averagedChoice, REVERSED, reversedChoice } from "../providers/choices.ts"

export type AskRoute = ProposalRoute
export const ASK_ROUTES: ReadonlyArray<AskRoute> = ProposalRoute.literals

export const TRIAGE_VERSION = 1

export const LOOKUP_ROUTED = 0.5
export const ROUTE_SURE = 0.7
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
  readonly decided: boolean
  readonly probabilities: Readonly<Record<AskRoute, number>>
}

/** Uncertain classifications fall open to `lookup` so a hesitant classifier never drops a real lookup. */
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
