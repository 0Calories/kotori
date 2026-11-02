import { Claude, Coach } from "@kotori/ai"
import { AuthWebhooks } from "../features/accounts/Webhooks.ts"
import { Auth } from "../integrations/auth/Auth.ts"
import { type Database, DatabaseLive, Repositories } from "@kotori/db"
import { MailerLive } from "../integrations/email/live.ts"
import { Jev } from "@kotori/nuance"
import { AudioStore, ElevenLabs, Pronouncer } from "@kotori/tts"
import { Layer } from "effect"
import type { SqlClient } from "effect/sql"
import { Accounts } from "../features/accounts/Accounts.ts"
import { Coaching } from "../features/coaching/Coaching.ts"
import { Dictionary } from "../features/dictionary/Dictionary.ts"
import { Study } from "../features/study/Study.ts"

/** Providers that talk to external services: AI and email. */
const ProvidersLive = Layer.mergeAll(
  Claude.layer,
  Jev.layer,
  MailerLive,
  Pronouncer.layer.pipe(Layer.provideMerge(Layer.mergeAll(ElevenLabs.layer, AudioStore.layer, Jev.layer)))
)

/** Application services on top of the repositories and providers. */
const ServicesLive = Layer.mergeAll(Accounts.layer, Study.layer, Coaching.layer, AuthWebhooks.layer).pipe(
  Layer.provideMerge(Dictionary.layer),
  Layer.provideMerge(Coach.layer)
)

/** The services wired to repositories over the given database, with the given providers and auth. */
export const makeApp = <P, EP, RP, ED, RD, EA, RA>(
  providers: Layer.Layer<P, EP, RP>,
  database: Layer.Layer<Database | SqlClient.SqlClient, ED, RD>,
  auth: Layer.Layer<Auth, EA, RA>
) =>
  ServicesLive.pipe(
    Layer.provideMerge(providers),
    Layer.provideMerge(auth),
    Layer.provideMerge(Repositories),
    Layer.provideMerge(database)
  )

export const AppLive = makeApp(ProvidersLive, DatabaseLive, Auth.layer)
