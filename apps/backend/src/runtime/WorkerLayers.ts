import { NodeHttpClient, NodeServices } from "@effect/platform-node"
import { AiProviders, ExampleWriter, Pronouncer } from "@kotori/ai"
import { Layer } from "effect"
import { DatabaseLive } from "../db/Database.ts"
import { AudioStore } from "../features/audio/AudioStore.ts"
import { Speech } from "../features/audio/Speech.ts"
import { AudioEnricher } from "../features/enrichment/AudioEnricher.ts"
import { Enrichers } from "../features/enrichment/Enrichers.ts"

/** What the AI providers are used for. */
const CapabilitiesLive = Layer.mergeAll(ExampleWriter.layer, Pronouncer.layer)

/**
 * The enrichment worker's services: the enrichers over the AI capabilities, the clip library and
 * the database at `DATABASE_URL`. No HTTP server, auth or mail; `kotori enrich` and
 * `kotori status` share it.
 */
export const WorkerLive = Enrichers.layer.pipe(
  Layer.provideMerge(AudioEnricher.layer),
  Layer.provideMerge(Speech.layer),
  Layer.provideMerge(Layer.mergeAll(AudioStore.layer, CapabilitiesLive)),
  // Claude for examples; ElevenLabs for audio, with Jev judging seeded sentences before they are voiced.
  Layer.provideMerge(AiProviders),
  Layer.provideMerge(DatabaseLive),
  Layer.provideMerge(Layer.mergeAll(NodeHttpClient.layerUndici, NodeServices.layer))
)
