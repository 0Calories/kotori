import { Claude, Coach, ExampleWriter } from "@kotori/ai"
import { DatabaseMemory } from "@kotori/db/testing"
import { MailerMemory } from "@kotori/email"
import type { EntryRecord, SenseRecord } from "@kotori/jmdict"
import { Jev, JevError } from "@kotori/nuance"
import { ElevenLabs, TtsError } from "@kotori/tts"
import { Effect, Layer } from "effect"
import { makeServices } from "../src/index.ts"
import { AuthMemory, TestAuth } from "../src/testing.ts"

// Fakes for the paid providers, and the real services over PGlite with them.

export const sense = (glosses: ReadonlyArray<string>, extra: Partial<SenseRecord> = {}): SenseRecord => ({
  glosses: glosses.map((text) => ({ text, type: null })),
  pos: ["v1"],
  misc: [],
  fields: [],
  dialects: [],
  info: [],
  stagk: [],
  stagr: [],
  xrefs: [],
  antonyms: [],
  ...extra
})

export const entry = (
  id: number,
  headword: string,
  reading: string,
  senses: ReadonlyArray<SenseRecord>,
  extra: Partial<EntryRecord> = {}
): EntryRecord => ({
  id,
  headword,
  reading,
  common: true,
  priority: 50,
  forms: [
    { kind: "kanji", text: headword, common: true, tags: [], priorities: ["ichi1"], restrictions: [], noKanji: false },
    { kind: "kana", text: reading, common: true, tags: [], priorities: ["ichi1"], restrictions: [], noKanji: false }
  ],
  senses,
  ...extra
})

/** Jev as the tests steer it: answering, failing, or never answering. */
export const jev = { mode: "up" as "up" | "down" | "hang", states: [] as Array<unknown> }

export const FakeJev = Layer.succeed(
  Jev,
  Jev.of({
    configured: true,
    model: "jev-test",
    ask: (state, questions) => {
      if (jev.mode === "down") return Effect.fail(new JevError({ message: "Jev is down" }))
      if (jev.mode === "hang") return Effect.never
      jev.states.push(state)
      // Whatever Jev's answer types require: the first option of every choice, a likely first candidate.
      const answer = (name: string, type: string, criteria: object) => {
        switch (type) {
          case "score":
            return { type, score: name === "formality" ? 2 : 1, confidence: 0.9, legend: {}, probabilities: {} }
          case "choice": {
            const choice = name.startsWith("difference_") ? "more_casual" : Object.keys(criteria)[0]!
            return { type, choice, confidence: 0.8, probabilities: {} }
          }
          default:
            return { type, noul: name === "similar_0" ? 0.9 : 0.1 }
        }
      }
      return Effect.succeed({
        model: "jev-test",
        answers: Object.fromEntries(
          Object.entries(questions).map(([name, q]) => [
            name,
            answer(name, q.type, ("criteria" in q ? q.criteria : null) ?? {})
          ])
        ),
        usage: { input_tokens: 100, output_tokens: 0 }
      } as never)
    }
  })
)

/** Claude writing one example sentence, for the first sense. */
export const FakeClaude = Layer.succeed(
  Claude,
  Claude.of({
    model: "claude-test",
    available: Effect.succeed(true),
    generate: () =>
      Effect.succeed({
        senses: [
          {
            sense: 0,
            examples: [
              {
                ja: "パンを食べる。",
                furigana: "パンを{食|た}べる。",
                en: "I eat bread.",
                formality: "neutral",
                note: null
              }
            ]
          }
        ]
      } as never)
  })
)

/** Everything ElevenLabs was asked to say. */
export const spoken: Array<string> = []

export const FakeElevenLabs = Layer.succeed(
  ElevenLabs,
  ElevenLabs.of({
    configured: true,
    model: "tts-test",
    voiceFor: (language) => `voice-${language}`,
    synthesize: (text) => Effect.sync(() => (spoken.push(text), new TextEncoder().encode(`mp3:${text}`)))
  })
)

export const OfflineElevenLabs = Layer.succeed(
  ElevenLabs,
  ElevenLabs.of({
    configured: false,
    model: "test",
    voiceFor: () => "test",
    synthesize: () => Effect.fail(new TtsError({ reason: "unconfigured", message: "not configured" }))
  })
)

/**
 * The services over a fresh PGlite with every provider configured (fakes), captured mail,
 * and the fake Managed Auth. `claude` swaps in another Claude, e.g. one the coach test counts.
 */
export const servicesWith = (claude: Layer.Layer<Claude> = FakeClaude, tts: Layer.Layer<ElevenLabs> = FakeElevenLabs) =>
  makeServices(
    Layer.mergeAll(
      Layer.mergeAll(Coach.layer, ExampleWriter.layer).pipe(Layer.provideMerge(claude)),
      FakeJev,
      tts,
      MailerMemory,
      AuthMemory
    ).pipe(Layer.provideMerge(TestAuth.layer)),
    DatabaseMemory
  )
