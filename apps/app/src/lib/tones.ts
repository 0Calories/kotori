import type { Register } from "@kotori/contracts"
import type { Tone } from "../components/Chip.tsx"

/** The Coach's phrases and sentences; mixed is a sentence that shifts register partway. */
export const registerTone: Record<Register | "mixed", Tone> = {
  casual: "neutral",
  neutral: "neutral",
  polite: "neutral",
  formal: "neutral",
  mixed: "accent"
}
