import type { ChoiceResponse, Question } from "@typesafe-ai/sdk"
import { REVERSED } from "../providers/choices.ts"

/**
 * How `kotori eval` checks Jev's option-order bias: every Kotori Choice is asked a second time
 * with its options in reverse order, under `${name}~reversed` in the same request, since Jev
 * leans toward the option listed first (model-jaggedness docs) and every Kotori Choice lists its
 * uninformative default first.
 */

/** How a Choice's answer held up with its options reversed. */
export interface OrderCheck {
  readonly name: string
  /** The two orders picked different options. */
  readonly flipped: boolean
  /** Each order picked the option it listed first: the bias the check looks for. */
  readonly towardFirst: boolean
}

/** Compares every Choice in `questions` answered both ways with its reversed twin. */
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
