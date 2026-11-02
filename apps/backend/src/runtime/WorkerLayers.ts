import { NodeHttpClient, NodeServices } from "@effect/platform-node"
import { Claude, ElevenLabs, ExampleWriter, Jev, LoanWriter, NuanceJudge, Pronouncer } from "@kotori/ai"
import { Layer } from "effect"
import { DatabaseLive } from "../db/Database.ts"
import { AudioStore } from "../features/audio/AudioStore.ts"
import { Speech } from "../features/audio/Speech.ts"
import { AudioEnricher } from "../features/enrichment/AudioEnricher.ts"
import { Enrichers } from "../features/enrichment/Enrichers.ts"
import { NuanceEnricher } from "../features/enrichment/NuanceEnricher.ts"

/** The paid providers enrichment calls: Jev for nuance, Claude for examples and loan warnings, ElevenLabs for audio. */
const ProvidersLive = Layer.mergeAll(Claude.layer, Jev.layer, ElevenLabs.layer)

/** What the AI providers are used for. */
const CapabilitiesLive = Layer.mergeAll(NuanceJudge.layer, ExampleWriter.layer, LoanWriter.layer, Pronouncer.layer)

/**
 * The enrichment worker's services: the enrichers over the AI capabilities, the clip library and
 * the repositories over `DATABASE_URL`. No HTTP server, auth or mail; `kotori enrich` and
 * `kotori status` share it.
 */
export const WorkerLive = Enrichers.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(NuanceEnricher.layer, AudioEnricher.layer)),
  Layer.provideMerge(Speech.layer),
  Layer.provideMerge(Layer.mergeAll(AudioStore.layer, CapabilitiesLive)),
  Layer.provideMerge(ProvidersLive),
  Layer.provideMerge(DatabaseLive),
  Layer.provideMerge(Layer.mergeAll(NodeHttpClient.layerUndici, NodeServices.layer))
)
