import { Claude, Coach, ExampleWriter } from "@kotori/ai"
import { Auth } from "@kotori/auth"
import { type Database, DatabaseLive } from "@kotori/db"
import { type Mailer, MailerLive } from "@kotori/email"
import { Jev } from "@kotori/nuance"
import { ElevenLabs } from "@kotori/tts"
import { Layer } from "effect"
import { AuthEmailDeliveries } from "./accounts/authEmails.ts"
import { CoachingLimits } from "./coaching/index.ts"
import { AudioSettings } from "./enrichment/audio.ts"

export { AuthEmailDeliveries, AudioSettings, CoachingLimits }

/** What the use cases keep besides the database and the providers: settings read once at startup, and in-process state. */
export const Services = Layer.mergeAll(AudioSettings.layer, AuthEmailDeliveries.layer, CoachingLimits.layer)

/** Everything a use case may require: the database, the providers, and the services' own settings and state. */
export type ServicesContext =
  | Database
  | Claude
  | Coach
  | ExampleWriter
  | Jev
  | ElevenLabs
  | Mailer
  | Auth
  | Layer.Success<typeof Services>

/** The external services use cases call: AI, speech, email and Managed Auth. */
export const ProvidersLive = Layer.mergeAll(Coach.layer, ExampleWriter.layer).pipe(
  Layer.provideMerge(Claude.layer),
  Layer.merge(Layer.mergeAll(Jev.layer, ElevenLabs.layer, MailerLive, Auth.layer))
)

/** Everything the use cases run on, over the given providers and database: what an app provides once. */
export const makeServices = <P, EP, RP, D, ED, RD>(
  providers: Layer.Layer<P, EP, RP>,
  database: Layer.Layer<D, ED, RD>
) => Services.pipe(Layer.provideMerge(providers), Layer.provideMerge(database))

/** The services over Postgres at `DATABASE_URL` and the live providers. Needs an `HttpClient`. */
export const ServicesLive = makeServices(ProvidersLive, DatabaseLive)
