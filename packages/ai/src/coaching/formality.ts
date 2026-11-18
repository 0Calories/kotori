import type { FormalityReading } from "@kotori/contracts"
import type { ScoreQuestion } from "@typesafe-ai/sdk"
import { Effect } from "effect"
import { type Jev, JevDeadline, type JevError } from "../providers/Jev.ts"

/** How formal a sentence sounds, one level per `Formality` in order, from vulgar to formal. */
export const SENTENCE_FORMALITY = [
  { what: "Vulgar or crude: rude or coarse; it would offend strangers or superiors" },
  { what: "Casual: relaxed wording for friends and family; too familiar for a boss or a stranger" },
  { what: "Neutral: plain everyday wording that fits most situations" },
  { what: "Polite: courteous wording suited to strangers, customers or superiors" },
  { what: "Formal: business, ceremonial or official wording, as in speeches, letters or announcements" }
] as const satisfies ScoreQuestion["criteria"]

export const FORMALITY_QUESTION = "How formal does `sentence` sound to a native speaker of its language?"

const formality: ScoreQuestion = { type: "score", instructions: FORMALITY_QUESTION, criteria: SENTENCE_FORMALITY }

/** Jev's independent read of how formal a sentence sounds, as a 0..1 meter position. */
export const readFormality = (jev: Jev["Service"], sentence: string): Effect.Effect<FormalityReading, JevError> =>
  // Read alongside a coach answer the learner is waiting on.
  jev.ask({ sentence }, { formality }, { timeout: JevDeadline.interactive }).pipe(
    Effect.map(({ answers }) => ({
      position: Math.min(Math.max(answers.formality.score / 4, 0), 1),
      confidence: answers.formality.confidence
    }))
  )
