import { Claude, ExampleWriter, Pronouncer } from "@kotori/ai"
import type { EntryId } from "@kotori/db"
import { Clock, Context, Effect, Layer } from "effect"
import { Database } from "../../db/Database.ts"
import * as Sentry from "../../runtime/Sentry.ts"
import { getEntries, tagNames } from "../dictionary/index.ts"
import { AudioEnricher } from "./AudioEnricher.ts"
import type { JobKind } from "./jobs.ts"
import { saveExamples } from "./queries.ts"

/** Senses that get example sentences; later senses are rarely what learners look for. */
const EXAMPLE_SENSES = 4

export class Enrichers extends Context.Service<
  Enrichers,
  {
    /** Which kinds of enrichment have a configured provider. */
    readonly available: Effect.Effect<ReadonlyArray<JobKind>>
    /** Runs one kind of enrichment for an entry, returning a short description of what was done. */
    run(kind: JobKind, entryId: EntryId): Effect.Effect<string, unknown>
  }
>()("@kotori/backend/Enrichers") {
  static readonly layer = Layer.effect(
    Enrichers,
    Effect.gen(function* () {
      const writer = yield* ExampleWriter
      const pronouncer = yield* Pronouncer
      const audio = yield* AudioEnricher
      const db = yield* Database
      const claude = yield* Claude

      const available = Effect.gen(function* () {
        const kinds: Array<JobKind> = []
        if (yield* claude.available) kinds.push("examples")
        if (pronouncer.configured) kinds.push("audio")
        return kinds
      })

      const examples = Effect.fn("Enrichers.examples")(function* (entryId: EntryId) {
        const [entry] = yield* getEntries(db, [entryId])
        if (entry === undefined) return "missing entry"
        const tags = yield* tagNames(db)
        const tagName = (code: string) => tags.get(code) ?? code
        // The dictionary's own usage labels and notes are the register hints Claude writes to.
        const senses = entry.senses.slice(0, EXAMPLE_SENSES).map((sense, index) => ({
          index,
          glosses: sense.glosses.map((gloss) => gloss.text),
          partsOfSpeech: sense.pos.map(tagName),
          dialects: sense.dialects.map(tagName),
          notes: [...[...sense.misc, ...sense.fields].map(tagName), ...sense.info]
        }))
        const written = yield* writer.write({
          language: entry.language,
          headword: entry.headword,
          reading: entry.reading,
          otherForms: entry.forms
            .map((form) => form.text)
            .filter((text) => text !== entry.headword)
            .slice(0, 4),
          senses,
          perSense: senses.length > 2 ? 2 : 3
        })
        const now = new Date(yield* Clock.currentTimeMillis)
        yield* saveExamples(
          db,
          entryId,
          written.examples.map((example) => ({ ...example, model: writer.model })),
          now
        )
        const dropped = written.dropped > 0 ? `, ${written.dropped} dropped for using another sense` : ""
        return `${written.examples.length} examples${dropped}`
      })

      const enrich = (kind: JobKind, entryId: EntryId): Effect.Effect<string, unknown> => {
        switch (kind) {
          case "examples":
            return examples(entryId)
          case "audio":
            return audio
              .enrich(entryId)
              .pipe(
                Effect.map(
                  (s) =>
                    `${s.clips} clips, ${s.characters} chars${s.judged > 0 ? `, ${s.judged} seeded sentences judged` : ""}`
                )
              )
        }
      }

      const run = (kind: JobKind, entryId: EntryId): Effect.Effect<string, unknown> =>
        enrich(kind, entryId).pipe(Sentry.withScope((scope) => scope.setConversationId(`entry:${entryId}`)))

      return Enrichers.of({ available, run })
    })
  )
}
