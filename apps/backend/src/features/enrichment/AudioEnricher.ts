import { type JevError, Pronouncer, type TtsError } from "@kotori/ai"
import type { EntryId } from "@kotori/db"
import { Config, Context, Effect, Layer, Option, Result } from "effect"
import { Database } from "../../db/Database.ts"
import { entryClips, exampleClips, linkEntryAudio, linkExampleAudio } from "../audio/index.ts"
import { Speech } from "../audio/Speech.ts"
import { getEntries, labelsBySense } from "../dictionary/index.ts"
import { jobStatusFor } from "./jobs.ts"
import { declineCasting, examplesFor, judgedCasting, saveCasting } from "./queries.ts"
import { examplesToCome, sentencesToVoice } from "./voicing.ts"

export interface AudioSummary {
  readonly clips: number
  readonly characters: number
  readonly judged: number
}

export class AudioEnricher extends Context.Service<
  AudioEnricher,
  {
    enrich(entryId: EntryId): Effect.Effect<AudioSummary, TtsError | JevError>
  }
>()("@kotori/backend/AudioEnricher") {
  static readonly layer = Layer.effect(
    AudioEnricher,
    Effect.gen(function* () {
      const pronouncer = yield* Pronouncer
      const speech = yield* Speech
      const db = yield* Database
      const headwordCap = yield* Config.Int("KOTORI_HEADWORD_VOICES").pipe(Config.withDefault(3))

      const enrich = Effect.fn("AudioEnricher.enrich")(function* (entryId: EntryId) {
        const [entry] = yield* getEntries(db, [entryId])
        if (entry === undefined) return { clips: 0, characters: 0, judged: 0 }
        let clips = 0
        let characters = 0
        const track = (text: string) => {
          clips++
          characters += text.length
        }

        const language = entry.language
        // Synthesize Japanese headwords from kana readings to disambiguate heterophonous kanji (e.g. 生, 今日).
        const spoken = language === "ja" ? entry.reading : entry.headword
        const voiced = (yield* entryClips(db, [entryId])).get(entryId) ?? []
        // Legacy clips stored before voice casting have voice = null; treat the entry as already voiced.
        const uncast = voiced.some((clip) => clip.voice === null)
        for (const voice of pronouncer.headwordVoices(language).slice(0, Math.max(headwordCap, 1))) {
          if (uncast || voiced.some((clip) => clip.voice === voice.id)) continue
          yield* linkEntryAudio(db, entryId, yield* speech.speak(spoken, language, voice))
          track(spoken)
        }

        const labels = (yield* labelsBySense(db, [entryId])).get(entryId)
        const all = yield* examplesFor(db, [entryId])
        const writing = examplesToCome((yield* jobStatusFor(db, entryId)).get("examples"), all)
        const stored = sentencesToVoice(all, { writing })
        const linked = yield* exampleClips(
          db,
          stored.map((example) => example.id)
        )

        const unjudged = stored.filter((example) => !judgedCasting(example) && !linked.has(`${example.id}:${language}`))
        const judging =
          unjudged.length > 0 && pronouncer.judges
            ? yield* pronouncer
                .judge(
                  language,
                  unjudged.map((example) => ({
                    sentence: language === "ja" ? example.ja : example.en,
                    translation: language === "ja" ? example.en : example.ja
                  }))
                )
                .pipe(
                  Effect.tap((judged) =>
                    declineCasting(
                      db,
                      judged.flatMap((one, index) => (one === null ? [unjudged[index]!.id] : []))
                    )
                  ),
                  Effect.map((judged) =>
                    judged.flatMap((one, index) => (one === null ? [] : [{ id: unjudged[index]!.id, ...one }]))
                  ),
                  Effect.tap((judged) => saveCasting(db, judged)),
                  Effect.result
                )
            : Result.succeed([])
        const judged = new Map(Result.getOrElse(judging, () => []).map((one) => [one.id, one]))
        const examples = stored.map((example) => ({ ...example, ...judged.get(example.id) }))

        yield* Effect.forEach(
          examples,
          (example) =>
            Effect.gen(function* () {
              if (linked.has(`${example.id}:${language}`)) return
              const { formality } = example
              if (formality === null) return
              const decision = yield* pronouncer.cast(
                { ...example.casting, id: example.id, ja: example.ja, en: example.en, formality },
                {
                  labels: (labels?.get(example.sense) ?? []).map((label) => label.code),
                  fields: entry.senses[example.sense]?.fields ?? []
                },
                language
              )
              if (Option.isNone(decision)) return
              const { voice, castBy, score } = decision.value
              const text = language === "ja" ? example.ja : example.en
              const key = yield* speech.speak(text, language, voice)
              yield* linkExampleAudio(db, example.id, language, key, { castBy, score })
              track(text)
            }),
          { concurrency: 2, discard: true }
        )

        // Fail after voicing everything possible so only unjudged sentences are retried on the next attempt.
        if (Result.isFailure(judging)) return yield* Effect.fail(judging.failure)
        return { clips, characters, judged: judged.size }
      })

      return AudioEnricher.of({ enrich })
    })
  )
}
