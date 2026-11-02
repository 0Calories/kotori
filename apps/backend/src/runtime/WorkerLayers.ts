import { NodeHttpClient, NodeServices } from "@effect/platform-node"
import { Claude, ExampleWriter, LoanWriter } from "@kotori/ai"
import { DatabaseLive, Repositories } from "@kotori/db"
import { Jev, NuanceEnricher } from "@kotori/nuance"
import { AudioStore, ElevenLabs, Pronouncer } from "@kotori/tts"
import { Layer } from "effect"
import { Enrichers } from "../features/enrichment/Enrichers.ts"

/** The paid providers enrichment calls: Jev for nuance, Claude for examples and loan warnings, ElevenLabs for audio. */
const ProvidersLive = Layer.mergeAll(
  NuanceEnricher.layer.pipe(Layer.provideMerge(Jev.layer)),
  Layer.mergeAll(ExampleWriter.layer, LoanWriter.layer).pipe(Layer.provideMerge(Claude.layer)),
  Pronouncer.layer.pipe(Layer.provideMerge(Layer.mergeAll(ElevenLabs.layer, AudioStore.layer, Jev.layer)))
)

/**
 * The enrichment worker's services: the enrichers, their providers and the repositories over
 * `DATABASE_URL`. No HTTP server, auth or mail; `kotori enrich` and `kotori status` share it.
 */
export const WorkerLive = Enrichers.layer.pipe(
  Layer.provideMerge(ProvidersLive),
  Layer.provideMerge(Repositories),
  Layer.provideMerge(DatabaseLive),
  Layer.provideMerge(Layer.mergeAll(NodeHttpClient.layerUndici, NodeServices.layer))
)
