import { NodeHttpClient, NodeServices } from "@effect/platform-node"
import { Claude, ExampleWriter } from "@kotori/ai"
import { DatabaseLive, Repositories } from "@kotori/db"
import { Jev, NuanceEnricher } from "@kotori/nuance"
import { AudioStore, ElevenLabs, Pronouncer } from "@kotori/tts"
import { Layer } from "effect"
import { Enrichers } from "./Enrichers.ts"

const Providers = Layer.mergeAll(
  NuanceEnricher.layer.pipe(Layer.provideMerge(Jev.layer)),
  ExampleWriter.layer.pipe(Layer.provideMerge(Claude.layer)),
  Pronouncer.layer.pipe(Layer.provideMerge(Layer.mergeAll(ElevenLabs.layer, AudioStore.layer)))
)

export const WorkerLive = Enrichers.layer.pipe(
  Layer.provideMerge(Providers),
  Layer.provideMerge(Repositories),
  Layer.provideMerge(DatabaseLive),
  Layer.provideMerge(Layer.mergeAll(NodeHttpClient.layerUndici, NodeServices.layer))
)
