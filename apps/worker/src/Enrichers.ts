import { Claude, ExampleWriter, LoanWriter } from "@kotori/ai"
import { DictionaryRepo, EnrichmentRepo, type JobKind } from "@kotori/db"
import { LOAN_SHOWN } from "@kotori/domain"
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
      const loanWriter = yield* LoanWriter
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

        const senses = entry.senses.slice(0, EXAMPLE_SENSES).map((sense, index) => {
          const nuance = judged.get(index)
          return {
            index,
            glosses: sense.glosses.map((gloss) => gloss.text),
            partsOfSpeech: sense.pos.map(label),
            dialects: sense.dialects.map(label),
            notes: [
              ...[...sense.misc, ...sense.fields].map(label),
              ...sense.info,
              ...(nuance ? [`register: ${nuance.formality.value}, ${nuance.medium.value}`] : [])
            ]
          }
        })
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
        return `${written.examples.length} examples, ${written.notes.filter((note) => note.note ?? note.noteJa).length} notes`
      })

      /**
       * Claude writes the warning for an English word's katakana loan that Jev confidently judged
       * to diverge, right after the verdict. A warning already written survives a re-judge that
       * names the same loan, so it is paid for once.
       */
      const trap = Effect.fn("Enrichers.loanTrap")(function* (entryId: number) {
        const [loan] = yield* enrichment.loanWordsFor([entryId])
        if (
          loan?.word == null ||
          loan.trap !== null ||
          loan.verdict?.value !== "diverges" ||
          loan.verdict.confidence < LOAN_SHOWN ||
          !(yield* claude.available)
        ) {
          return false
        }
        const [entry] = yield* dictionary.getEntries([entryId])
        if (entry === undefined) return false
        const written = yield* loanWriter.write({
          headword: entry.headword,
          reading: entry.reading,
          meanings: entry.senses.slice(0, EXAMPLE_SENSES).map((sense) =>
            sense.glosses
              .slice(0, 3)
              .map((gloss) => gloss.text)
              .join("; ")
          ),
          loanWord: loan.word
        })
        if (written === null) return false
        yield* enrichment.saveLoanTrap(entryId, loan.word, written)
        return true
      })

      // A Claude failure fails the job after Jev's answers are saved; the retry asks Jev again,
      // which costs a fraction of a cent and keeps the warning from being silently skipped.
      const judge = Effect.fn("Enrichers.nuance")(function* (entryId: number) {
        const summary = yield* nuance.enrich(entryId)
        const warned = yield* trap(entryId)
        const loan = summary.loan === null ? "" : `, loan ${summary.loan}${warned ? " (warning written)" : ""}`
        return `${summary.senses} senses, ${summary.similar} similar words${loan}, ${summary.inputTokens} tokens`
      })

      const run = (kind: JobKind, entryId: number): Effect.Effect<string, unknown> => {
        switch (kind) {
          case "nuance":
            return judge(entryId)
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
