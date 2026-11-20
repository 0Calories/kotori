import type { ChoiceResponse, Question } from "@typesafe-ai/sdk"
import { REVERSED } from "../providers/choices.ts"

export interface OrderCheck {
  readonly name: string
  readonly flipped: boolean
  readonly towardFirst: boolean
}

export const orderChecks = (
  questions: Readonly<Record<string, Question>>,
  answers: Readonly<Record<string, unknown>>
): ReadonlyArray<OrderCheck> =>
  Object.entries(questions).flatMap(([name, question]): Array<OrderCheck> => {
    const forward = answers[name] as ChoiceResponse | undefined
    const backward = answers[`${name}${REVERSED}`] as ChoiceResponse | undefined
    if (question.type !== "choice" || forward === undefined || backward === undefined) return []
    const options = Object.keys(question.criteria)
    return [
      {
        name,
        flipped: forward.choice !== backward.choice,
        towardFirst: forward.choice === options[0] && backward.choice === options.at(-1)
      }
    ]
  })
