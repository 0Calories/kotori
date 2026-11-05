import { Layer } from "effect"
import { Claude } from "./Claude.ts"
import { ElevenLabs } from "./ElevenLabs.ts"
import { Jev } from "./Jev.ts"

/** The paid AI providers, each configured from the environment: Claude, Jev and ElevenLabs. */
export const AiProviders = Layer.mergeAll(Claude.layer, Jev.layer, ElevenLabs.layer)
