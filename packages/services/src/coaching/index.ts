import { Coach, type ClaudeError, type HowToSayOutput, type NaturalnessOutput } from "@kotori/ai"
import { at, Database } from "@kotori/db"
import { coachCache, type coachKind, coachUsage } from "@kotori/db/schema"
import {
  AiUnavailable,
  type HowToSayRequest,
  HowToSayResult,
  type NaturalnessRequest,
  NaturalnessResult,
  type Profile,
  RateLimited,
  type SpeakRequest,
  type SpeakResult
} from "@kotori/domain"
import { Jev, readFormality } from "@kotori/nuance"
import { ElevenLabs } from "@kotori/tts"
import { and, count, eq, gte } from "drizzle-orm"
import { Clock, Config, Context, Effect, Layer, Option, Schema } from "effect"
import { createHash } from "node:crypto"
import { lookupWords } from "../dictionary/search.ts"
import { audioUrl, speak as speakText } from "../enrichment/audio.ts"

const HOUR = 60 * 60 * 1000
const CACHE_TTL = 30 * 24 * HOUR

type CoachKind = (typeof coachKind.enumValues)[number]

/** Fresh coach answers a learner may ask for per hour; audio gets three times as many. */
export class CoachingLimits extends Context.Service<CoachingLimits, { readonly hourly: number }>()(
  "@kotori/services/CoachingLimits"
) {
  static readonly layer = Layer.effect(
    CoachingLimits,
    Effect.map(Config.Int("KOTORI_COACH_HOURLY_LIMIT").pipe(Config.withDefault(60)), (hourly) =>
      CoachingLimits.of({ hourly })
    )
  )
}

const fromClaude = (error: ClaudeError): AiUnavailable | RateLimited => {
  switch (error.reason) {
    case "rate_limited":
      return new RateLimited({ message: "Kotori is a little busy. Try again in a moment.", retryAfterSeconds: 30 })
    case "unconfigured":
      return new AiUnavailable({ message: "Coaching isn't set up on this server yet (missing Anthropic credentials)." })
    case "refused":
      return new AiUnavailable({ message: "Kotori can't help with that request." })
    default:
      return new AiUnavailable({ message: "Kotori couldn't finish that answer. Please try again." })
  }
}

const usageSince = Effect.fn("coaching.usageSince")(function* (userId: string, since: number) {
  const db = yield* Database
  const rows = yield* db
    .select({ n: count() })
    .from(coachUsage)
    .where(and(eq(coachUsage.userId, userId), gte(coachUsage.createdAt, at(since))))
  return rows[0]?.n ?? 0
}, Effect.orDie)

const recordUsage = Effect.fn("coaching.recordUsage")(function* (userId: string, kind: CoachKind, now: number) {
  const db = yield* Database
  yield* db.insert(coachUsage).values({ userId, kind, createdAt: at(now) })
}, Effect.orDie)

const limit = Effect.fnUntraced(function* (user: Profile, kind: CoachKind) {
  const { hourly } = yield* CoachingLimits
  const now = yield* Clock.currentTimeMillis
  if ((yield* usageSince(user.id, now - HOUR)) >= hourly) {
    return yield* new RateLimited({ message: "You've hit this hour's limit. Take a breather!", retryAfterSeconds: 600 })
  }
  yield* recordUsage(user.id, kind, now)
})

/** The cached answer for `key`, if it was stored at or after `notBefore`. */
const cachedAnswer = Effect.fn("coaching.cachedAnswer")(function* (key: string, notBefore: number) {
  const db = yield* Database
  const rows = yield* db
    .select({ result: coachCache.result })
    .from(coachCache)
    .where(and(eq(coachCache.key, key), gte(coachCache.createdAt, at(notBefore))))
  return Option.fromNullishOr(rows[0]?.result)
}, Effect.orDie)

const storeAnswer = Effect.fn("coaching.storeAnswer")(function* (key: string, result: unknown, now: number) {
  const db = yield* Database
  yield* db
    .insert(coachCache)
    .values({ key, result, createdAt: at(now) })
    .onConflictDoUpdate({ target: coachCache.key, set: { result, createdAt: at(now) } })
}, Effect.orDie)

/** Serves identical requests from the cache; only fresh answers count toward rate limits. */
const cached = <A, I, R>(
  schema: Schema.Codec<A, I>,
  kind: CoachKind,
  user: Profile,
  request: unknown,
  compute: Effect.Effect<A, AiUnavailable | RateLimited, R>
) =>
  Effect.gen(function* () {
    const key = createHash("sha256")
      .update(JSON.stringify([kind, user.nativeLanguage, user.targetLanguage, request]))
      .digest("hex")
    const now = yield* Clock.currentTimeMillis
    const hit = yield* cachedAnswer(key, now - CACHE_TTL)
    if (Option.isSome(hit)) {
      const decoded = Schema.decodeUnknownOption(schema)(hit.value)
      if (Option.isSome(decoded)) return decoded.value
    }
    yield* limit(user, kind)
    const result = yield* compute
    const encoded = Schema.encodeUnknownOption(schema)(result)
    if (Option.isSome(encoded)) yield* storeAnswer(key, encoded.value, now)
    return result
  })

const learner = (user: Profile) => ({ native: user.nativeLanguage, target: user.targetLanguage })

/** How a native speaker hears the learner's sentence, with Jev's reading of its formality when available. */
export const naturalness = Effect.fn("coaching.naturalness")(function* (user: Profile, request: NaturalnessRequest) {
  const coach = yield* Coach
  const jev = yield* Jev
  return yield* cached(
    NaturalnessResult,
    "naturalness",
    user,
    request,
    Effect.gen(function* () {
      const [output, formality] = yield* Effect.all(
        [
          coach.naturalness(request, learner(user)).pipe(Effect.mapError(fromClaude)),
          jev.configured
            ? readFormality(jev, request.text).pipe(Effect.option, Effect.map(Option.getOrNull))
            : Effect.succeed(null)
        ],
        { concurrency: 2 }
      )
      return { ...(output satisfies NaturalnessOutput), formality }
    })
  )
})

/** The ways natives say what the learner means, with key words linked to the dictionary. */
export const howToSay = Effect.fn("coaching.howToSay")(function* (user: Profile, request: HowToSayRequest) {
  const coach = yield* Coach
  return yield* cached(
    HowToSayResult,
    "how-to-say",
    user,
    request,
    Effect.gen(function* () {
      const output: HowToSayOutput = yield* coach.howToSay(request, learner(user)).pipe(Effect.mapError(fromClaude))
      // Link Japanese vocabulary to dictionary entries so learners can open and save them.
      const entryIds =
        user.targetLanguage === "ja" ? yield* lookupWords(output.keyWords) : output.keyWords.map(() => null)
      return {
        ...output,
        keyWords: output.keyWords.map((word, index) => ({ ...word, entryId: entryIds[index] ?? null }))
      }
    })
  )
})

/** Speaks a sentence the learner wants to hear, within the hourly limit and the monthly audio budget. */
export const speak = Effect.fn("coaching.speak")(function* (user: Profile, request: SpeakRequest) {
  if (!(yield* ElevenLabs).configured) {
    return yield* new AiUnavailable({ message: "Audio isn't set up on this server (missing ElevenLabs key)." })
  }
  const { hourly } = yield* CoachingLimits
  const now = yield* Clock.currentTimeMillis
  if ((yield* usageSince(user.id, now - HOUR)) >= hourly * 3) {
    return yield* new RateLimited({ message: "Too many audio requests this hour.", retryAfterSeconds: 600 })
  }
  const key = yield* speakText(request.text, request.language).pipe(
    Effect.mapError((error) =>
      error.reason === "quota"
        ? new RateLimited({ message: "The monthly audio budget has been used up.", retryAfterSeconds: 86_400 })
        : new AiUnavailable({ message: "Couldn't generate audio right now." })
    )
  )
  yield* recordUsage(user.id, "speak", now)
  return { url: audioUrl(key) } satisfies SpeakResult
})
