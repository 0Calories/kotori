/** Deck options, mirroring Anki's names and defaults. */
export interface SchedulerConfig {
  /** Learning steps for new cards, in minutes. */
  readonly learningSteps: ReadonlyArray<number>
  /** Relearning steps for lapsed cards, in minutes. Empty sends lapses straight back to review. */
  readonly relearningSteps: ReadonlyArray<number>
  /** Days until the first review after the last learning step. */
  readonly graduatingInterval: number
  /** Days until the first review when a learning card is answered Easy. */
  readonly easyInterval: number
  /** Ease factor given to newly graduated cards. */
  readonly startingEase: number
  /** Extra multiplier applied to Easy answers on review cards. */
  readonly easyBonus: number
  /** Multiplier applied to Hard answers on review cards ("Hard interval"). */
  readonly hardMultiplier: number
  /** Multiplier applied to every review interval. */
  readonly intervalModifier: number
  /** Multiplier applied to the interval when a review card lapses ("New interval"). */
  readonly lapseMultiplier: number
  /** Minimum interval in days after a lapse. */
  readonly minimumInterval: number
  readonly maximumInterval: number
  /** Lapses after which a card is flagged as a leech. */
  readonly leechThreshold: number
  /** Randomise review intervals slightly so cards added together don't stay clumped. */
  readonly fuzz: boolean
}

export const defaultConfig: SchedulerConfig = {
  learningSteps: [1, 10],
  relearningSteps: [10],
  graduatingInterval: 1,
  easyInterval: 4,
  startingEase: 2.5,
  easyBonus: 1.3,
  hardMultiplier: 1.2,
  intervalModifier: 1,
  lapseMultiplier: 0,
  minimumInterval: 1,
  maximumInterval: 36_500,
  leechThreshold: 8,
  fuzz: true
}
