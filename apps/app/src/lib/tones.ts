import type { Register } from "@kotori/contracts"
import type { Tone } from "../components/Chip.tsx"

/** Tags are neutral outlines; only the registers a learner should be careful with stand out. */
export const registerTone: Record<Register | "mixed", Tone> = {
  casual: "neutral",
  neutral: "neutral",
  polite: "neutral",
  formal: "neutral",
  mixed: "accent"
}
