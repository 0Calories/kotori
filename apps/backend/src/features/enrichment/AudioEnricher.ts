import { Pronouncer, type TtsError } from "@kotori/ai"
import type { EntryId } from "@kotori/db"
import { Config, Context, Effect, Layer } from "effect"
import { Database } from "../../db/Database.ts"
import { formClips, spokenForm } from "../audio/index.ts"
import { Speech } from "../audio/Speech.ts"
import { getEntries } from "../dictionary/index.ts"

export interface AudioSummary {
  readonly clips: number
  readonly characters: number
}

/** Voices dictionary entries' spoken forms across configured dictionary voices. */
export class AudioEnricher extends Context.Service<
  AudioEnricher,
  {
    /**
     * Synthesises spoken pronunciation clips for an entry's primary form in each configured
     * dictionary voice (up to `KOTORI_HEADWORD_VOICES`), skipping voices that already have a clip
     * in the content-addressed `audio` store.
     */
    enrich(entryId: EntryId): Effect.Effect<AudioSummary, TtsError>
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
        if (entry === undefined) return { clips: 0, characters: 0 }
        let clips = 0
        let characters = 0

        // Learners hear the language they're learning: Japanese words from their kana reading,
        // English words from their headword. Every dictionary voice reads it so learners hear
        // more than one speaker. Clips made before casting (no voice) count as done.
        const language = entry.language
        const spoken = spokenForm(entry)
        const voiced = (yield* formClips(db, [entry])).get(entryId) ?? []
        const uncast = voiced.some((clip) => clip.voice === null)
        for (const voice of pronouncer.headwordVoices(language).slice(0, Math.max(headwordCap, 1))) {
          if (uncast || voiced.some((clip) => clip.voice === voice.id)) continue
          yield* speech.speak(spoken, language, voice)
          clips++
          characters += spoken.length
        }

        return { clips, characters }
      })

      return AudioEnricher.of({ enrich })
    })
  )
}
