import { NodeHttpClient, NodeServices } from "@effect/platform-node"
import { AiProviders, ExampleWriter, Pronouncer } from "@kotori/ai"
import { Layer } from "effect"
import { DatabaseLive } from "../db/Database.ts"
import { AudioStore } from "../features/audio/AudioStore.ts"
import { Speech } from "../features/audio/Speech.ts"
import { AudioEnricher } from "../features/enrichment/AudioEnricher.ts"
import { Enrichers } from "../features/enrichment/Enrichers.ts"

const CapabilitiesLive = Layer.mergeAll(ExampleWriter.layer, Pronouncer.layer)

export const WorkerLive = Enrichers.layer.pipe(
  Layer.provideMerge(AudioEnricher.layer),
  Layer.provideMerge(Speech.layer),
  Layer.provideMerge(Layer.mergeAll(AudioStore.layer, CapabilitiesLive)),
  Layer.provideMerge(AiProviders),
  Layer.provideMerge(DatabaseLive),
  Layer.provideMerge(Layer.mergeAll(NodeHttpClient.layerUndici, NodeServices.layer))
)
