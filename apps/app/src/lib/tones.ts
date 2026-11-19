import type { Register } from "@kotori/contracts"
import type { Tone } from "../components/Chip.tsx"

export const registerTone: Record<Register | "mixed", Tone> = {
  casual: "neutral",
  neutral: "neutral",
  polite: "neutral",
  formal: "neutral",
  mixed: "accent"
}
