import { Coach, type ClaudeError, type HowToSayOutput, type NaturalnessOutput } from "@kotori/ai"
import { CoachRepo } from "@kotori/db"
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
import { Pronouncer } from "@kotori/tts"
import { Clock, Config, Context, Effect, Layer, Option, Schema } from "effect"
import { createHash } from "node:crypto"
import { audioUrl, Dictionary } from "./Dictionary.ts"

const HOUR = 60 * 60 * 1000
const CACHE_TTL = 30 * 24 * HOUR

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

export class Coaching extends Context.Service<
  Coaching,
  {
    naturalness(
      user: Profile,
      request: NaturalnessRequest
    ): Effect.Effect<NaturalnessResult, AiUnavailable | RateLimited>
    howToSay(user: Profile, request: HowToSayRequest): Effect.Effect<HowToSayResult, AiUnavailable | RateLimited>
    speak(user: Profile, request: SpeakRequest): Effect.Effect<SpeakResult, AiUnavailable | RateLimited>
  }
>()("@kotori/api/Coaching") {
  static readonly layer = Layer.effect(
    Coaching,
    Effect.gen(function* () {
      const coach = yield* Coach
      const jev = yield* Jev
      const pronouncer = yield* Pronouncer
      const dictionary = yield* Dictionary
      const repo = yield* CoachRepo
      const hourlyLimit = yield* Config.Int("KOTORI_COACH_HOURLY_LIMIT").pipe(Config.withDefault(60))

      const limit = Effect.fnUntraced(function* (user: Profile, kind: string, perHour: number) {
        const now = yield* Clock.currentTimeMillis
        if ((yield* repo.usageSince(user.id, now - HOUR)) >= perHour) {
          return yield* new RateLimited({
            message: "You've hit this hour's limit. Take a breather!",
            retryAfterSeconds: 600
          })
        }
        yield* repo.recordUsage(user.id, kind, now)
      })

      /** Serves identical requests from the cache; only fresh answers count toward rate limits. */
      const cached = <A, I>(
        schema: Schema.Codec<A, I>,
        kind: string,
        user: Profile,
        request: unknown,
        compute: Effect.Effect<A, AiUnavailable | RateLimited>
      ) =>
        Effect.gen(function* () {
          const key = createHash("sha256")
            .update(JSON.stringify([kind, user.nativeLanguage, user.targetLanguage, request]))
            .digest("hex")
          const now = yield* Clock.currentTimeMillis
          const hit = yield* repo.cached(key, now - CACHE_TTL)
          if (Option.isSome(hit)) {
            const decoded = Schema.decodeUnknownOption(schema)(hit.value)
            if (Option.isSome(decoded)) return decoded.value
          }
          yield* limit(user, kind, hourlyLimit)
          const result = yield* compute
          const encoded = Schema.encodeUnknownOption(schema)(result)
          if (Option.isSome(encoded)) yield* repo.store(key, encoded.value, now)
          return result
        })

      const learner = (user: Profile) => ({ native: user.nativeLanguage, target: user.targetLanguage })

      const naturalness = Effect.fn("Coaching.naturalness")(function* (user: Profile, request: NaturalnessRequest) {
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

      const howToSay = Effect.fn("Coaching.howToSay")(function* (user: Profile, request: HowToSayRequest) {
        return yield* cached(
          HowToSayResult,
          "how-to-say",
          user,
          request,
          Effect.gen(function* () {
            const output: HowToSayOutput = yield* coach
              .howToSay(request, learner(user))
              .pipe(Effect.mapError(fromClaude))
            // Link Japanese vocabulary to dictionary entries so learners can open and save them.
            const entryIds =
              user.targetLanguage === "ja"
                ? yield* dictionary.lookupWords(output.keyWords)
                : output.keyWords.map(() => null)
            return {
              ...output,
              keyWords: output.keyWords.map((word, index) => ({ ...word, entryId: entryIds[index] ?? null }))
            }
          })
        )
      })

      const speak = Effect.fn("Coaching.speak")(function* (user: Profile, request: SpeakRequest) {
        if (!pronouncer.configured) {
          return yield* new AiUnavailable({ message: "Audio isn't set up on this server (missing ElevenLabs key)." })
        }
        const now = yield* Clock.currentTimeMillis
        if ((yield* repo.usageSince(user.id, now - HOUR)) >= hourlyLimit * 3) {
          return yield* new RateLimited({ message: "Too many audio requests this hour.", retryAfterSeconds: 600 })
        }
        const key = yield* pronouncer
          .speak(request.text, request.language)
          .pipe(
            Effect.mapError((error) =>
              error.reason === "quota"
                ? new RateLimited({ message: "The monthly audio budget has been used up.", retryAfterSeconds: 86_400 })
                : new AiUnavailable({ message: "Couldn't generate audio right now." })
            )
          )
        yield* repo.recordUsage(user.id, "speak", now)
        return { url: audioUrl(key) }
      })

      return Coaching.of({ naturalness, howToSay, speak })
    })
  )
}
