import { Claude, ExampleWriter } from "@kotori/ai"
import { DictionaryRepo, EnrichmentRepo, type JobKind } from "@kotori/db"
import { Jev, NuanceEnricher } from "@kotori/nuance"
import { Pronouncer } from "@kotori/tts"
import { Clock, Context, Effect, Layer } from "effect"

/** Senses that get example sentences; later senses are rarely what learners look for. */
const EXAMPLE_SENSES = 4

export class Enrichers extends Context.Service<
  Enrichers,
  {
    /** Which kinds of enrichment have a configured provider. */
    readonly available: Effect.Effect<ReadonlyArray<JobKind>>
    /** Runs one kind of enrichment for an entry, returning a short description of what was done. */
    run(kind: JobKind, entryId: number): Effect.Effect<string, unknown>
  }
>()("@kotori/worker/Enrichers") {
  static readonly layer = Layer.effect(
    Enrichers,
    Effect.gen(function* () {
      const nuance = yield* NuanceEnricher
      const writer = yield* ExampleWriter
      const pronouncer = yield* Pronouncer
      const dictionary = yield* DictionaryRepo
      const enrichment = yield* EnrichmentRepo
      const jev = yield* Jev
      const claude = yield* Claude

      const available = Effect.gen(function* () {
        const kinds: Array<JobKind> = []
        if (jev.configured) kinds.push("nuance")
        if (yield* claude.available) kinds.push("examples")
        if (pronouncer.configured) kinds.push("audio")
        return kinds
      })

      const examples = Effect.fn("Enrichers.examples")(function* (entryId: number) {
        const [entry] = yield* dictionary.getEntries([entryId])
        if (entry === undefined) return "missing entry"
        const tags = yield* dictionary.tags
        const label = (code: string) => tags.get(code) ?? code
        const judged = new Map((yield* enrichment.nuanceFor([entryId])).map((row) => [row.sense, row.nuance]))
        const english = new Map((yield* enrichment.englishNuanceFor([entryId])).map((row) => [row.sense, row]))

        const senses = entry.senses.slice(0, EXAMPLE_SENSES).map((sense, index) => {
          const nuance = judged.get(index)
          // Only a confident divergence verdict earns the loanword prose request.
          const loan = english.get(index)?.nuance.loan
          return {
            index,
            glosses: sense.glosses.map((gloss) => gloss.text),
            partsOfSpeech: sense.pos.map(label),
            dialects: sense.dialects.map(label),
            notes: [
              ...[...sense.misc, ...sense.fields].map(label),
              ...sense.info,
              ...(nuance ? [`register: ${nuance.formality.value}, ${nuance.medium.value}`] : [])
            ],
            loanDiverges: loan !== undefined && loan.value === "diverges" && loan.confidence >= 0.55
          }
        })
        const written = yield* writer.write({
          headword: entry.headword,
          reading: entry.reading,
          otherForms: entry.forms
            .map((form) => form.text)
            .filter((text) => text !== entry.headword)
            .slice(0, 4),
          senses,
          perSense: senses.length > 2 ? 2 : 3
        })
        const now = yield* Clock.currentTimeMillis
        yield* enrichment.saveExamples(
          entryId,
          written.examples.map((example) => ({ ...example, model: writer.model })),
          now
        )
        yield* enrichment.saveSenseNotes(
          entryId,
          written.notes.map(({ sense, note, noteJa }) => ({ sense, note, noteJa, model: writer.model })),
          now
        )
        yield* Effect.forEach(
          written.notes.filter((note) => note.loanWord !== null),
          (note) => enrichment.saveLoanTrap(entryId, note.sense, note.loanWord!, note.loanTrap),
          { discard: true }
        )
        return `${written.examples.length} examples, ${written.notes.filter((note) => note.note ?? note.noteJa).length} notes`
      })

      const run = (kind: JobKind, entryId: number): Effect.Effect<string, unknown> => {
        switch (kind) {
          case "nuance":
            return nuance
              .enrich(entryId)
              .pipe(Effect.map((s) => `${s.senses} senses, ${s.similar} similar words, ${s.inputTokens} tokens`))
          case "examples":
            return examples(entryId)
          case "audio":
            return pronouncer.enrichEntry(entryId).pipe(Effect.map((s) => `${s.clips} clips, ${s.characters} chars`))
        }
      }

      return Enrichers.of({ available, run })
    })
  )
}
