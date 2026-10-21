import { Claude, Coach } from "@kotori/ai"
import { DatabaseLive, Repositories } from "@kotori/db"
import { Jev } from "@kotori/nuance"
import { AudioStore, ElevenLabs, Pronouncer } from "@kotori/tts"
import { Layer } from "effect"
import { Accounts } from "./services/Accounts.ts"
import { Coaching } from "./services/Coaching.ts"
import { Dictionary } from "./services/Dictionary.ts"
import { Situations } from "./services/Situations.ts"
import { Study } from "./services/Study.ts"

/** Providers that talk to external AI services. */
export const ProvidersLive = Layer.mergeAll(
  Claude.layer,
  Jev.layer,
  Pronouncer.layer.pipe(Layer.provideMerge(Layer.mergeAll(ElevenLabs.layer, AudioStore.layer)))
)

/** Application services on top of the repositories and providers. */
export const ServicesLive = Layer.mergeAll(Accounts.layer, Study.layer, Coaching.layer, Situations.layer).pipe(
  Layer.provideMerge(Dictionary.layer),
  Layer.provideMerge(Coach.layer)
)

/** The services wired to repositories over the given database, with the given providers. */
export const makeApp = <P, EP, RP, ED, RD>(
  providers: Layer.Layer<P, EP, RP>,
  database: Layer.Layer<Layer.Success<typeof DatabaseLive>, ED, RD>
) =>
  ServicesLive.pipe(
    Layer.provideMerge(providers),
    Layer.provideMerge(Repositories),
    Layer.provideMerge(database)
  )

export const AppLive = makeApp(ProvidersLive, DatabaseLive)
