import type { ChoiceQuestion, ChoiceResponse } from "@typesafe-ai/sdk"

/** Jev exhibits first-option bias on Choice questions, so callers ask each Choice in both option orders and average the probabilities. */
export const REVERSED = "~reversed"

export const reversedChoice = (question: ChoiceQuestion): ChoiceQuestion => ({
  ...question,
  criteria: Object.fromEntries(Object.entries(question.criteria).toReversed())
})

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
