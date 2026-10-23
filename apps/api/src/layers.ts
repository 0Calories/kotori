import { Claude, Coach } from "@kotori/ai"
import { Auth } from "@kotori/auth"
import { DatabaseLive, Repositories } from "@kotori/db"
import { MailerLive } from "@kotori/email"
import { Jev } from "@kotori/nuance"
import { AudioStore, ElevenLabs, Pronouncer } from "@kotori/tts"
import { Layer } from "effect"
import type { SqlClient } from "effect/sql"
import { Accounts } from "./services/Accounts.ts"
import { Coaching } from "./services/Coaching.ts"
import { Dictionary } from "./services/Dictionary.ts"
import { Study } from "./services/Study.ts"

/** Providers that talk to external services: AI and email. */
export const ProvidersLive = Layer.mergeAll(
  Claude.layer,
  Jev.layer,
  MailerLive,
  Pronouncer.layer.pipe(Layer.provideMerge(Layer.mergeAll(ElevenLabs.layer, AudioStore.layer)))
)

/** Application services on top of the repositories and providers. */
export const ServicesLive = Layer.mergeAll(Accounts.layer, Study.layer, Coaching.layer).pipe(
  Layer.provideMerge(Dictionary.layer),
  Layer.provideMerge(Coach.layer)
)

/** The services wired to repositories over the given database, with the given providers and auth. */
export const makeApp = <P, EP, RP, ED, RD, EA, RA>(
  providers: Layer.Layer<P, EP, RP>,
  database: Layer.Layer<SqlClient.SqlClient, ED, RD>,
  auth: Layer.Layer<Auth, EA, RA>
) =>
  ServicesLive.pipe(
    Layer.provideMerge(providers),
    Layer.provideMerge(auth),
    Layer.provideMerge(Repositories),
    Layer.provideMerge(database)
  )

export const AppLive = makeApp(ProvidersLive, DatabaseLive, Auth.layer)
