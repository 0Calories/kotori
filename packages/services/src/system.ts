import { Mailer } from "@kotori/email"
import { Effect } from "effect"
import { count } from "./dictionary/entries.ts"
import { available } from "./enrichment/run.ts"

/** Which optional providers this server has, and how big its dictionary is. */
export const status = Effect.gen(function* () {
  const kinds = yield* available
  return {
    features: {
      coach: kinds.includes("examples"),
      nuance: kinds.includes("nuance"),
      audio: kinds.includes("audio"),
      email: (yield* Mailer).configured
    },
    dictionary: { entries: yield* count }
  }
}).pipe(Effect.withSpan("system.status"))
