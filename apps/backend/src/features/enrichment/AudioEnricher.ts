import { Pronouncer, type TtsError } from "@kotori/ai"
import { DictionaryRepo, EnrichmentRepo } from "@kotori/db"
import { Config, Context, Effect, Layer, Option } from "effect"
import { Speech } from "../audio/Speech.ts"

export interface AudioSummary {
  readonly clips: number
  readonly characters: number
}

/** Voices dictionary entries: their headword, and their example sentences with a reader cast for each. */
export class AudioEnricher extends Context.Service<
  AudioEnricher,
  {
    /**
     * Audio for an entry's headword and example sentences in the entry's language (the one
     * its learners are learning), voices chosen per sentence. Only what is missing is voiced:
     * existing clips are left as they are, so re-running fills gaps (a run cut short) without
     * re-casting or paying twice.
     */
    enrich(entryId: number): Effect.Effect<AudioSummary, TtsError>
  }
>()("@kotori/backend/AudioEnricher") {
  static readonly layer = Layer.effect(
    AudioEnricher,
    Effect.gen(function* () {
      const pronouncer = yield* Pronouncer
      const speech = yield* Speech
      const repo = yield* EnrichmentRepo
      const dictionary = yield* DictionaryRepo
      const headwordCap = yield* Config.Int("KOTORI_HEADWORD_VOICES").pipe(Config.withDefault(3))

      const enrich = Effect.fn("AudioEnricher.enrich")(function* (entryId: number) {
        const [entry] = yield* dictionary.getEntries([entryId])
        if (entry === undefined) return { clips: 0, characters: 0 }
        let clips = 0
        let characters = 0
        const track = (text: string) => {
          clips++
          characters += text.length
        }

        // Learners hear the language they're learning: Japanese words and their sentences in
        // Japanese, English words and theirs in English. A Japanese headword is read from its
        // kana, which pins down the pronunciation where kanji alone is ambiguous (生, 今日…).
        // Every dictionary voice reads it, so learners hear the word from more than one speaker.
        // Clips made before casting (no voice) count as done, so old entries aren't voiced again.
        const language = entry.language
        const spoken = language === "ja" ? entry.reading : entry.headword
        const voiced = (yield* repo.entryAudio([entryId])).get(entryId) ?? []
        const uncast = voiced.some((clip) => clip.voice === null)
        for (const voice of pronouncer.headwordVoices(language).slice(0, Math.max(headwordCap, 1))) {
          if (uncast || voiced.some((clip) => clip.voice === voice.id)) continue
          yield* repo.linkEntryAudio(entryId, yield* speech.speak(spoken, language, voice))
          track(spoken)
        }

        const nuance = new Map((yield* repo.nuanceFor([entryId])).map((row) => [row.sense, row.nuance]))
        const examples = yield* repo.examplesFor([entryId])
        const linked = yield* repo.exampleAudio(examples.map((example) => example.id))
        yield* Effect.forEach(
          examples,
          (example) =>
            Effect.gen(function* () {
              if (linked.has(`${example.id}:${language}`)) return
              const sense = entry.senses[example.sense]
              const decision = yield* pronouncer.cast(
                example,
                { misc: sense?.misc ?? [], dialects: sense?.dialects ?? [], fields: sense?.fields ?? [] },
                nuance.get(example.sense) ?? null,
                language
              )
              if (Option.isNone(decision)) return
              const { voice, castBy, score } = decision.value
              const text = language === "ja" ? example.ja : example.en
              const key = yield* speech.speak(text, language, voice)
              yield* repo.linkExampleAudio(example.id, language, key, { castBy, score })
              track(text)
            }),
          { concurrency: 2, discard: true }
        )

        return { clips, characters }
      })

      return AudioEnricher.of({ enrich })
    })
  )
}
