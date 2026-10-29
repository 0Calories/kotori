import { DictionaryRepo, EnrichmentRepo, type Casting, type ExampleRow } from "@kotori/db"
import type { Language } from "@kotori/domain"
import { CAST_CONFIDENCE_FLOOR, castVoice, Jev } from "@kotori/nuance"
import { Clock, Config, Context, Effect, Layer, Option } from "effect"
import { createHash } from "node:crypto"
import { AudioStore } from "./AudioStore.ts"
import { briefFor, rank, tied, type CastingBrief, type RankedVoice } from "./casting.ts"
import { ElevenLabs, TtsError } from "./ElevenLabs.ts"
import { CASTS, headwordVoices, type Casts, type Voice } from "./voices.ts"

const MONTH = 30 * 24 * 60 * 60 * 1000

export interface AudioSummary {
  readonly clips: number
  readonly characters: number
}

/** The curated voices in use; defaults to the checked-in casts, overridden in tests. */
export const VoiceCasts = Context.Reference<Casts>("@kotori/tts/VoiceCasts", {
  defaultValue: () => CASTS
})

/** The chosen reader of one clip, and how the choice was made. */
export interface CastingDecision {
  readonly voice: Voice
  readonly casting: Casting
}

/** Turns text into cached pronunciation clips, keeping TTS spend within a monthly character budget. */
export class Pronouncer extends Context.Service<
  Pronouncer,
  {
    readonly configured: boolean
    /**
     * Returns the audio key for `text`, synthesising it only if this voice hasn't
     * spoken it yet. Without a voice, the language's first dictionary voice reads it.
     */
    speak(text: string, language: Language, voice?: Voice): Effect.Effect<string, TtsError>
    /** Audio for an entry's headword and example sentences, voices chosen per sentence. */
    enrichEntry(entryId: number): Effect.Effect<AudioSummary, TtsError>
  }
>()("@kotori/tts/Pronouncer") {
  static readonly layer = Layer.effect(
    Pronouncer,
    Effect.gen(function* () {
      const tts = yield* ElevenLabs
      const store = yield* AudioStore
      const repo = yield* EnrichmentRepo
      const dictionary = yield* DictionaryRepo
      const jev = yield* Jev
      const casts = yield* VoiceCasts
      const budget = yield* Config.Int("KOTORI_AUDIO_MONTHLY_CHARS").pipe(Config.withDefault(50_000))
      const headwordCap = yield* Config.Int("KOTORI_HEADWORD_VOICES").pipe(Config.withDefault(3))
      // Japanese is always voiced; KOTORI_AUDIO_LANGUAGES only opts English in.
      const voicedEnglish = (yield* Config.String("KOTORI_AUDIO_LANGUAGES").pipe(Config.withDefault("ja")))
        .split(",")
        .some((language) => language.trim() === "en")
      const exampleLanguages: ReadonlyArray<Language> = voicedEnglish ? ["ja", "en"] : ["ja"]

      const defaultVoice = (language: Language): Effect.Effect<Voice, TtsError> => {
        const voice = headwordVoices(language, casts)[0]
        return voice === undefined
          ? Effect.fail(
              new TtsError({ reason: "unconfigured", message: `No dictionary voice is cast for ${language}` })
            )
          : Effect.succeed(voice)
      }

      const keyFor = (text: string, language: Language, providerId: string) =>
        createHash("sha256").update([providerId, tts.model, language, text].join("\n")).digest("hex")

      const speak = Effect.fn("Pronouncer.speak")(function* (text: string, language: Language, voice?: Voice) {
        const reader = voice ?? (yield* defaultVoice(language))
        if (reader.providerId === null) {
          return yield* new TtsError({ reason: "unconfigured", message: `${reader.id} has no provider voice yet` })
        }
        const normalized = text.trim()
        const key = keyFor(normalized, language, reader.providerId)
        const cached = yield* repo.findAudio(key)
        if (Option.isSome(cached) && (yield* store.exists(key))) return key

        const now = yield* Clock.currentTimeMillis
        const used = yield* repo.audioCharactersSince(now - MONTH)
        if (used + normalized.length > budget) {
          return yield* new TtsError({
            reason: "quota",
            message: `Monthly audio budget of ${budget} characters reached (KOTORI_AUDIO_MONTHLY_CHARS)`
          })
        }

        const bytes = yield* tts.synthesize(normalized, language, reader.providerId)
        // The clip's row first: `audio_files` references it.
        yield* repo.saveAudio({
          key,
          text: normalized,
          language,
          voiceId: reader.providerId,
          voice: reader.id,
          modelId: tts.model,
          characters: normalized.length,
          bytes: bytes.byteLength,
          createdAt: now
        })
        yield* store.put(key, bytes)
        return key
      })

      /**
       * The voice that reads one side of an example. Scoring decides alone when
       * it can; Jev breaks ties when it is configured, and any Jev problem falls
       * back to the top score rather than failing the audio job.
       */
      const decide = Effect.fn("Pronouncer.decide")(function* (
        example: ExampleRow,
        brief: CastingBrief,
        language: Language
      ) {
        // A brief may ask for a variety nobody is cast in yet (see docs/voice-casting.md);
        // the standard voices then read the sentence rather than nobody.
        let ranked: ReadonlyArray<RankedVoice> = rank(brief, language, casts)
        if (ranked.length === 0) ranked = rank({ ...brief, variety: null }, language, casts)
        const top = ranked[0]
        if (top === undefined) {
          yield* Effect.logWarning(`No ${language} voice is cast for example ${example.id}; skipping its audio`)
          return Option.none<CastingDecision>()
        }

        const ties = tied(ranked)
        const byRules: CastingDecision = { voice: top.voice, casting: { castBy: "rules", score: top.score } }
        if (ties.length < 2 || !jev.configured) return Option.some(byRules)

        const vote = yield* castVoice(jev, {
          sentence: language === "ja" ? example.ja : example.en,
          meaning: language === "ja" ? example.en : example.ja,
          candidates: ties.map(({ voice }) => ({ id: voice.id, description: voice.description }))
        }).pipe(Effect.option)
        if (Option.isNone(vote)) {
          yield* Effect.logWarning(`castVoice failed for example ${example.id} (${language}); using the top score`)
          return Option.some(byRules)
        }
        if (vote.value.confidence < CAST_CONFIDENCE_FLOOR) {
          yield* Effect.logInfo(
            `castVoice picked ${vote.value.voiceId} for example ${example.id} (${language}) at low confidence ${vote.value.confidence}`
          )
        }
        const chosen = ties.find(({ voice }) => voice.id === vote.value.voiceId)
        if (chosen === undefined) {
          yield* Effect.logWarning(
            `castVoice picked ${vote.value.voiceId} outside the tie for example ${example.id} (${language}); using the top score`
          )
          return Option.some(byRules)
        }
        return Option.some<CastingDecision>({
          voice: chosen.voice,
          casting: { castBy: "jev", score: chosen.score }
        })
      })

      const enrichEntry = Effect.fn("Pronouncer.enrichEntry")(function* (entryId: number) {
        const [entry] = yield* dictionary.getEntries([entryId])
        if (entry === undefined) return { clips: 0, characters: 0 }
        let clips = 0
        let characters = 0
        const track = (text: string) => {
          clips++
          characters += text.length
        }

        // The kana reading pins down the pronunciation; kanji alone can be ambiguous (生, 今日…).
        // Every dictionary voice reads it, so learners hear the word from more than one speaker.
        for (const voice of headwordVoices("ja", casts).slice(0, Math.max(headwordCap, 1))) {
          yield* repo.linkEntryAudio(entryId, yield* speak(entry.reading, "ja", voice))
          track(entry.reading)
        }

        const nuance = new Map((yield* repo.nuanceFor([entryId])).map((row) => [row.sense, row.nuance]))
        const examples = yield* repo.examplesFor([entryId])
        yield* Effect.forEach(
          examples,
          (example) =>
            Effect.gen(function* () {
              const sense = entry.senses[example.sense]
              const brief = briefFor({
                sentence: example,
                sense: {
                  misc: sense?.misc ?? [],
                  dialects: sense?.dialects ?? [],
                  fields: sense?.fields ?? []
                },
                nuance: nuance.get(example.sense) ?? null
              })
              for (const language of exampleLanguages) {
                const decision = yield* decide(example, brief, language)
                if (Option.isNone(decision)) continue
                const text = language === "ja" ? example.ja : example.en
                const key = yield* speak(text, language, decision.value.voice)
                yield* repo.linkExampleAudio(example.id, language, key, decision.value.casting)
                track(text)
              }
            }),
          { concurrency: 2, discard: true }
        )

        return { clips, characters }
      })

      return Pronouncer.of({ configured: tts.configured, speak, enrichEntry })
    })
  )
}
