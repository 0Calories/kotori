import { AiProviders, Coach, Lexicographer, Pronouncer } from "@kotori/ai"
import { Layer } from "effect"
import type { SqlClient } from "effect/sql"
import { type Database, DatabaseLive } from "../db/Database.ts"
import { Accounts } from "../features/accounts/Accounts.ts"
import { AuthWebhooks } from "../features/accounts/Webhooks.ts"
import { Asks } from "../features/asks/Asks.ts"
import { AudioStore } from "../features/audio/AudioStore.ts"
import { Speech } from "../features/audio/Speech.ts"
import { Coaching } from "../features/coaching/Coaching.ts"
import { Dictionary } from "../features/dictionary/Dictionary.ts"
import { Notebook } from "../features/notebook/Notebook.ts"
import { Auth } from "../integrations/auth/Auth.ts"
import { MailerLive } from "../integrations/email/live.ts"

const ProvidersLive = Layer.merge(AiProviders, MailerLive)

const ServicesLive = Layer.mergeAll(
  Accounts.layer,
  Notebook.layer,
  Coaching.layer,
  Asks.layer,
  AuthWebhooks.layer
).pipe(
  Layer.provideMerge(Dictionary.layer),
  Layer.provideMerge(Speech.layer),
  Layer.provideMerge(Layer.mergeAll(Coach.layer, Pronouncer.layer, Lexicographer.layer))
)

export const makeApp = <P, EP, RP, ED, RD, EA, RA, ES, RS>(
  providers: Layer.Layer<P, EP, RP>,
  database: Layer.Layer<Database | SqlClient.SqlClient, ED, RD>,
  auth: Layer.Layer<Auth, EA, RA>,
  audio: Layer.Layer<AudioStore, ES, RS>
) =>
  ServicesLive.pipe(
    Layer.provideMerge(audio),
    Layer.provideMerge(providers),
    Layer.provideMerge(auth),
    Layer.provideMerge(database)
  )

export const AppLive = makeApp(ProvidersLive, DatabaseLive, Auth.layer, AudioStore.layer)
