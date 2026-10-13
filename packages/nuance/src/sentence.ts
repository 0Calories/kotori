import type { FormalityReading } from "@kotori/domain"
import type { ScoreQuestion } from "@typesafe-ai/sdk"
import { Effect } from "effect"
import type { Jev, JevError } from "./Jev.ts"

const formality: ScoreQuestion = {
  type: "score",
  instructions: "How formal does `sentence` sound to a native speaker of its language?",
  criteria: [
    { what: "Vulgar or crude: rude or coarse; it would offend strangers or superiors" },
    { what: "Casual: relaxed wording for friends and family; too familiar for a boss or a stranger" },
    { what: "Neutral: plain everyday wording that fits most situations" },
    { what: "Polite: courteous wording suited to strangers, customers or superiors" },
    { what: "Formal: business, ceremonial or official wording, as in speeches, letters or announcements" }
  ]
}

/** Jev's independent read of how formal a sentence sounds, as a 0..1 meter position. */
export const readFormality = (jev: Jev["Service"], sentence: string): Effect.Effect<FormalityReading, JevError> =>
  jev.ask({ sentence }, { formality }).pipe(
    Effect.map(({ answers }) => ({
      position: Math.min(Math.max(answers.formality.score / 4, 0), 1),
      confidence: answers.formality.confidence
    }))
  )
