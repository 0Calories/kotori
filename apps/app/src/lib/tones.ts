import type { Formality, Register } from "@kotori/domain"
import type { Tone } from "../components/Chip.tsx"

/** Tags are neutral outlines; only the registers a learner should be careful with stand out. */
export const formalityTone: Record<Formality, Tone> = {
  vulgar: "accent",
  casual: "neutral",
  neutral: "neutral",
  polite: "neutral",
  formal: "neutral"
}

export const registerTone: Record<Register | "mixed", Tone> = {
  casual: "neutral",
  neutral: "neutral",
  polite: "neutral",
  formal: "neutral",
  mixed: "accent"
}
