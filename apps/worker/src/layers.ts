import { NodeHttpClient, NodeServices } from "@effect/platform-node"
import { ServicesLive } from "@kotori/services"
import { Layer } from "effect"

export const WorkerLive = ServicesLive.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeHttpClient.layerUndici, NodeServices.layer))
)
