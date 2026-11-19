import type { FormalityReading } from "@kotori/contracts"
import type { ScoreQuestion } from "@typesafe-ai/sdk"
import { Effect } from "effect"
import { type Jev, JevDeadline, type JevError } from "../providers/Jev.ts"

/** Ordered 1-to-1 with `Formality.literals`, which `score` indexes into. */
export const SENTENCE_FORMALITY = [
  { what: "Vulgar or crude: rude or coarse; it would offend strangers or superiors" },
  { what: "Casual: relaxed wording for friends and family; too familiar for a boss or a stranger" },
  { what: "Neutral: plain everyday wording that fits most situations" },
  { what: "Polite: courteous wording suited to strangers, customers or superiors" },
  { what: "Formal: business, ceremonial or official wording, as in speeches, letters or announcements" }
] as const satisfies ScoreQuestion["criteria"]

export const FORMALITY_QUESTION = "How formal does `sentence` sound to a native speaker of its language?"

const formality: ScoreQuestion = { type: "score", instructions: FORMALITY_QUESTION, criteria: SENTENCE_FORMALITY }

export const readFormality = (jev: Jev["Service"], sentence: string): Effect.Effect<FormalityReading, JevError> =>
  jev.ask({ sentence }, { formality }, { timeout: JevDeadline.interactive }).pipe(
    Effect.map(({ answers }) => ({
      position: Math.min(Math.max(answers.formality.score / 4, 0), 1),
      confidence: answers.formality.confidence
    }))
  )
