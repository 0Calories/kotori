import { Layer } from "effect"
import { Claude } from "./Claude.ts"
import { ElevenLabs } from "./ElevenLabs.ts"
import { Jev } from "./Jev.ts"

export const AiProviders = Layer.mergeAll(Claude.layer, Jev.layer, ElevenLabs.layer)
