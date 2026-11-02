import { Claude, Coach, ElevenLabs, Jev, Pronouncer } from "@kotori/ai"
import { type Database, DatabaseLive, Repositories } from "@kotori/db"
import { Layer } from "effect"
import type { SqlClient } from "effect/sql"
import { Accounts } from "../features/accounts/Accounts.ts"
import { AuthWebhooks } from "../features/accounts/Webhooks.ts"
import { AudioStore } from "../features/audio/AudioStore.ts"
import { Speech } from "../features/audio/Speech.ts"
import { Coaching } from "../features/coaching/Coaching.ts"
import { Dictionary } from "../features/dictionary/Dictionary.ts"
import { Study } from "../features/study/Study.ts"
import { Auth } from "../integrations/auth/Auth.ts"
import { MailerLive } from "../integrations/email/live.ts"

/** Providers that talk to external services: the AI providers and email. */
const ProvidersLive = Layer.mergeAll(Claude.layer, Jev.layer, ElevenLabs.layer, MailerLive)

/** Application services on top of the repositories, the AI capabilities and the providers. */
const ServicesLive = Layer.mergeAll(Accounts.layer, Study.layer, Coaching.layer, AuthWebhooks.layer).pipe(
  Layer.provideMerge(Dictionary.layer),
  Layer.provideMerge(Speech.layer),
  Layer.provideMerge(Layer.mergeAll(AudioStore.layer, Coach.layer, Pronouncer.layer))
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
