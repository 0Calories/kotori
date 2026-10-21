import { NodeRuntime } from "@effect/platform-node"
import { DatabaseLive, DictionaryRepo, loadDotEnv, SituationRepo, type SituationInput } from "@kotori/db"
import { embedPassages } from "@kotori/db/embedder"
import { Effect, Layer, Schema } from "effect"
import { readFileSync } from "node:fs"
import { corpus } from "./corpus.ts"
import { resolveLinks } from "./resolve.ts"
import { SituationDraft } from "./schema.ts"

loadDotEnv()

const fileFlag = process.argv.indexOf("--file")
const drafts = fileFlag >= 0
  ? Schema.decodeUnknownSync(Schema.Array(SituationDraft))(JSON.parse(readFileSync(process.argv[fileFlag + 1]!, "utf8")))
  : corpus

const program = Effect.gen(function*() {
  const dictionary = yield* DictionaryRepo
  const repo = yield* SituationRepo
  const seen = new Set<string>()
  for (const draft of drafts) {
    if (seen.has(draft.id)) return yield* Effect.die(`duplicate situation ${draft.id}`)
    seen.add(draft.id)
    if (draft.aliases.length < 3 || draft.phrases.length < 2 || draft.words.length < 1) {
      return yield* Effect.die(`${draft.id} needs at least 3 aliases, 2 phrases, and 1 word`)
    }
  }

  const texts = [...new Set(drafts.flatMap((draft) => draft.words.flatMap((word) => [word.word, word.reading])))]
  const forms = yield* dictionary.findForms(texts)
  const records = yield* dictionary.getEntries([...new Set(forms.map((form) => form.entryId))])
  const ranks = new Map(records.map((entry) => [
    entry.id,
    { reading: entry.reading, common: entry.common, priority: entry.priority }
  ]))

  const missed: string[] = []
  const resolved = drafts.map((draft) => {
    const links = resolveLinks(draft.words, forms, ranks)
    for (const word of links.missed) missed.push(`${draft.id}: ${word.word}/${word.reading}`)
    return { draft, ids: links.ids }
  })

  const passages = resolved.flatMap(({ draft }) => [draft.title, ...draft.aliases])
  const vectors = yield* embedPassages(passages)
  let cursor = 0
  const inputs: SituationInput[] = resolved.map(({ draft, ids }) => {
    const embedded = [draft.title, ...draft.aliases].map((text) => ({ text, vector: vectors[cursor++]! }))
    return {
      id: draft.id,
      title: draft.title,
      category: draft.category,
      note: draft.note,
      aliases: draft.aliases,
      phrases: draft.phrases,
      entryIds: ids,
      embeddings: embedded
    }
  })

  yield* repo.replaceAll(inputs)
  const linked = inputs.reduce((sum, situation) => sum + situation.entryIds.length, 0)
  console.log(
    `Indexed ${yield* repo.count} situations, ${linked} entry links, ${passages.length} vectors ` +
      `via ${yield* repo.vectorBackend}.`
  )
  if (missed.length > 0) {
    console.log(`Unresolved headwords (${missed.length}):`)
    console.log(missed.join("\n"))
  }
}).pipe(Effect.provide(Layer.mergeAll(SituationRepo.layer, DictionaryRepo.layer).pipe(Layer.provide(DatabaseLive))))

NodeRuntime.runMain(program)
