import type { Formality, Register, Verdict } from "@kotori/domain"
import type { Tone } from "../components/Chip.tsx"

export const formalityTone: Record<Formality, Tone> = {
  vulgar: "plum",
  casual: "sky",
  neutral: "neutral",
  polite: "matcha",
  formal: "lavender"
}

export const registerTone: Record<Register | "mixed", Tone> = {
  casual: "sky",
  neutral: "neutral",
  polite: "matcha",
  formal: "lavender",
  mixed: "yuzu"
}

export const verdictTone: Record<Verdict, Tone> = {
  natural: "matcha",
  understandable: "sky",
  unnatural: "yuzu",
  incorrect: "plum"
}
