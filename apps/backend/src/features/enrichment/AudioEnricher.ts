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
  /** Seeded sentences whose casting signals Jev judged on the way. */
  readonly judged: number
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
     *
     * Seeded sentences are voiced only on a sense with none of Kotori's (`sentencesToVoice`), and
     * not while Kotori's may still come (`examplesToCome`).
     * They come with no formality, so it and their speaker are judged first, in one Jev request
     * for the entry. If Jev fails, every other sentence is still voiced and the job then fails, so
     * it is retried; a sentence never judged is never voiced. One Jev answers for but gives no
     * formality is recorded as declined (`declineCasting`) and not asked about again.
     */
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

        // Learners hear the language they're learning: Japanese words and their sentences in
        // Japanese, English words and theirs in English. A Japanese headword is read from its
        // kana, which pins down the pronunciation where kanji alone is ambiguous (生, 今日…).
        // Every dictionary voice reads it, so learners hear the word from more than one speaker.
        // Clips made before casting (no voice) count as done, so old entries aren't voiced again.
        const language = entry.language
        const spoken = language === "ja" ? entry.reading : entry.headword
        const voiced = (yield* entryClips(db, [entryId])).get(entryId) ?? []
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

        // A seeded sentence has no formality, and a guessed one would cast the wrong voice: Jev
        // judges it, with its speaker, before the sentence is voiced. Only sentences still to be
        // voiced and never judged are asked about, so a judgment is paid for once.
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
                  // A sentence Jev gave no usable formality is recorded as declined: it is never
                  // voiced, and no later run asks about it again.
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

        // Everything that could be voiced is; the job fails now so the unjudged sentences get another try.
        if (Result.isFailure(judging)) return yield* Effect.fail(judging.failure)
        return { clips, characters, judged: judged.size }
      })

      return AudioEnricher.of({ enrich })
    })
  )
}
