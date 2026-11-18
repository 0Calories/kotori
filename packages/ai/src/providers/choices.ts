import type { ChoiceQuestion, ChoiceResponse } from "@typesafe-ai/sdk"

/**
 * Names a Choice asked again with its options in reverse order: Jev leans toward the option
 * listed first (model-jaggedness docs), and every Kotori Choice lists its default first. Ask
 * Kotori's routing is always asked both ways and read from the two together; the eval checks
 * whether an answer held up.
 */
export const REVERSED = "~reversed"

/** A Choice with its options in reverse order. */
export const reversedChoice = (question: ChoiceQuestion): ChoiceQuestion => ({
  ...question,
  criteria: Object.fromEntries(Object.entries(question.criteria).toReversed())
})

/**
 * A Choice's probability for each option, averaged over the orders it was answered in: as asked
 * (`name`) and with its options reversed (`name~reversed`). `orders` says how many were answered;
 * with none, every option is 0.
 */
export const averagedChoice = <Key extends string>(
  answers: Readonly<Record<string, unknown>>,
  name: string,
  options: ReadonlyArray<Key>
): { readonly probabilities: Record<Key, number>; readonly orders: number } => {
  const answered = [answers[name], answers[`${name}${REVERSED}`]].filter(
    (answer): answer is ChoiceResponse => answer !== undefined
  )
  const mean = (option: Key) =>
    answered.length === 0
      ? 0
      : answered.reduce((sum, answer) => sum + (answer.probabilities[option] ?? 0), 0) / answered.length
  return {
    probabilities: Object.fromEntries(options.map((option) => [option, mean(option)])) as Record<Key, number>,
    orders: answered.length
  }
}
