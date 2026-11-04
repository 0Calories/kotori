import type { Currency, Formality, Register } from "@kotori/contracts"
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

/** Words that have fallen out of use stand out in search results; a buzzword is only a note. */
export const currencyTone: Record<Currency, Tone> = {
  current: "neutral",
  trendy: "neutral",
  dated: "accent",
  archaic: "accent"
}
