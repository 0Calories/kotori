import { Claude, ExampleWriter, type LoanItem, LoanWriter } from "@kotori/ai"
import { DictionaryRepo, EnrichmentRepo, type JobKind } from "@kotori/db"
import { EnglishEnricher, Jev, NuanceEnricher } from "@kotori/nuance"
import { Pronouncer } from "@kotori/tts"
import { Clock, Context, Effect, Layer } from "effect"

/** Senses that get example sentences; later senses are rarely what learners look for. */
const EXAMPLE_SENSES = 4

/** Below this a loan verdict isn't shown, matching the app, so it earns no warning. */
const LOAN_CONFIDENT = 0.55

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
      const english = yield* EnglishEnricher
      const writer = yield* ExampleWriter
      const loanWriter = yield* LoanWriter
      const pronouncer = yield* Pronouncer
      const dictionary = yield* DictionaryRepo
      const enrichment = yield* EnrichmentRepo
      const jev = yield* Jev
      const claude = yield* Claude

      const available = Effect.gen(function* () {
        const kinds: Array<JobKind> = []
        if (jev.configured) kinds.push("nuance", "english")
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

      const judge = Effect.fn("Enrichers.nuance")(function* (entryId: number) {
        const summary = yield* nuance.enrich(entryId)
        return `${summary.senses} senses, ${summary.similar} similar words, ${summary.inputTokens} tokens`
      })

      /**
       * Claude writes the warning for each loan Jev confidently judged to diverge, once per English
       * word and loan, right after the verdict. Warnings already written are kept by re-judging
       * while the loan stays the same, so they are paid for once.
       */
      const traps = Effect.fn("Enrichers.loanTraps")(function* (entryId: number) {
        const wanted = (yield* enrichment.englishNuanceFor([entryId])).filter(
          (row) =>
            row.loanWord !== null &&
            row.loanTrap === null &&
            row.nuance.loan.value === "diverges" &&
            row.nuance.loan.confidence >= LOAN_CONFIDENT
        )
        if (wanted.length === 0 || !(yield* claude.available)) return 0
        const [entry] = yield* dictionary.getEntries([entryId])
        if (entry === undefined) return 0
        const items = new Map<string, { readonly item: LoanItem; readonly rows: Array<(typeof wanted)[number]> }>()
        for (const row of wanted) {
          const glosses = entry.senses[row.sense]?.glosses.map((gloss) => gloss.text) ?? []
          const item = { english: glosses[row.gloss] ?? "", meaning: glosses.join("; "), loanWord: row.loanWord! }
          const key = `${item.english}\u0000${item.loanWord}`
          const known = items.get(key)
          if (known === undefined) items.set(key, { item, rows: [row] })
          else known.rows.push(row)
        }
        const asked = [...items.values()]
        const written = yield* loanWriter.write({
          headword: entry.headword,
          reading: entry.reading,
          items: asked.map(({ item }) => item)
        })
        yield* Effect.forEach(
          written.flatMap(({ item, loanTrap }) => (asked[item]?.rows ?? []).map((row) => ({ row, loanTrap }))),
          ({ row, loanTrap }) => enrichment.saveLoanTrap(entryId, row.sense, row.gloss, loanTrap),
          { discard: true }
        )
        return written.length
      })

      // A Claude failure fails the job after Jev's answers are saved; the retry asks Jev again,
      // which costs a fraction of a cent and keeps the warning from being silently skipped.
      const englishSide = Effect.fn("Enrichers.english")(function* (entryId: number) {
        const summary = yield* english.enrich(entryId)
        const written = yield* traps(entryId)
        return `${summary.glosses} glosses, ${summary.loans} katakana loans, ${summary.inputTokens} tokens, ${written} loan warnings`
      })

      const run = (kind: JobKind, entryId: number): Effect.Effect<string, unknown> => {
        switch (kind) {
          case "nuance":
            return judge(entryId)
          case "english":
            return englishSide(entryId)
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
