/**
 * Rebuilds the golden fixture (`packages/nuance/golden/entries.json`) from the local downloads:
 * every entry the golden set names, in JMDict and in the English dictionary, cut to the senses
 * Kotori judges, with the labels of the tags they use, and the golden English words' katakana
 * loan candidates as the nuance job's lookup finds them. It reads `data/jmdict/JMdict_e.gz` and
 * the English dictionary's sources in `data/eiwa` (both downloaded by `kotori seed`), builds the
 * English dictionary in memory as an import would, writes the fixture, and touches no database.
 * Run `pnpm golden` after editing the golden set or downloading newer sources, and commit the
 * result: `kotori eval` reads only the fixture.
 */
import { Effect } from "effect"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { gunzipSync } from "node:zlib"
import { workspaceRoot } from "../packages/db/src/Paths.ts"
import { type EntryRecord, loanCandidatesIn, normalizeGloss } from "../packages/db/src/records.ts"
import { buildEntries } from "../packages/eiwa/src/Eiwa.ts"
import { ENGLISH_TAGS } from "../packages/eiwa/src/tags.ts"
import { parseEntries, parseTags } from "../packages/jmdict/src/parse.ts"
import { MAX_LOANS } from "../packages/nuance/src/english.ts"
import {
  fixtureEntry,
  GOLDEN_ENGLISH_PAIRS,
  GOLDEN_ENGLISH_SENSES,
  GOLDEN_FIXTURE,
  GOLDEN_LOANS,
  GOLDEN_PAIRS,
  GOLDEN_SENSES,
  type GoldenFixture
} from "../packages/nuance/src/golden.ts"
import { MAX_SENSES } from "../packages/nuance/src/state.ts"

const data = (path: string) => join(workspaceRoot, "data", path)
const files = {
  jmdict: data("jmdict/JMdict_e.gz"),
  wiktionary: data("eiwa/ja-wiktionary.jsonl.gz"),
  ejdict: data("eiwa/ejdict.txt"),
  frequency: data("eiwa/en_50k.txt")
}
for (const file of Object.values(files)) {
  if (!existsSync(file)) {
    console.error(
      `${file} is missing; \`pnpm kotori seed\` downloads JMDict to data/jmdict and the English sources to data/eiwa.`
    )
    process.exit(1)
  }
}
const xml = gunzipSync(readFileSync(files.jmdict)).toString("utf8")

// --- JMDict -------------------------------------------------------------------------

const wanted = new Set([
  ...GOLDEN_SENSES.map((golden) => golden.entryId),
  ...GOLDEN_PAIRS.flatMap((pair) => [pair.entryId, pair.similarId])
])
const all = Array.from(parseEntries(xml))
const found = new Map(all.filter((entry) => wanted.has(entry.id)).map((entry) => [entry.id, entry]))

// The loan candidates, by the same rules as `DictionaryRepo.loanCandidates`: once as production
// finds them until JMDict is re-imported with lsource (gloss matches only), once as after.
const words = GOLDEN_LOANS.map((golden) => golden.word)
const withoutSources = all.map((entry) => ({
  ...entry,
  senses: entry.senses.map((sense) => ({ ...sense, sources: [] }))
}))
const idsOf = (candidates: ReturnType<typeof loanCandidatesIn>, word: string) =>
  candidates.filter((candidate) => candidate.word === normalizeGloss(word)).map(({ entryId, by }) => ({ entryId, by }))
const glossesOnly = loanCandidatesIn(withoutSources, words, MAX_LOANS)
const withSources = loanCandidatesIn(all, words, MAX_LOANS)
const loans = Object.fromEntries(
  words.map((word) => [
    normalizeGloss(word),
    { glossesOnly: idsOf(glossesOnly, word), withSources: idsOf(withSources, word) }
  ])
)
const candidateIds = new Set([...glossesOnly, ...withSources].map((candidate) => candidate.entryId))
for (const entry of all) if (candidateIds.has(entry.id)) found.set(entry.id, entry)

// --- The English dictionary ---------------------------------------------------------------

const english = await Effect.runPromise(
  buildEntries({
    files: { wiktionary: files.wiktionary, ejdict: files.ejdict, frequency: files.frequency },
    jmdict: files.jmdict
  })
)
const englishWanted = new Set([
  ...GOLDEN_ENGLISH_SENSES.map((golden) => golden.word),
  ...GOLDEN_ENGLISH_PAIRS.flatMap((pair) => [pair.word, pair.similar]),
  ...words
])
const englishFound = new Map(
  english.filter((entry) => englishWanted.has(entry.headword)).map((entry) => [entry.headword, entry])
)

// --- Checks ---------------------------------------------------------------------------------

const problems: Array<string> = []
/** The entry, checked to be the word the golden set means and to have the sense as a judged one. */
const judged = (entryId: number, word: string, sense: number) => {
  const entry = found.get(entryId)
  if (entry === undefined) return void problems.push(`#${entryId} (${word}) is not in JMDict`)
  if (!entry.forms.some((form) => form.text === word)) problems.push(`#${entryId} has no form ${word}`)
  if (sense >= Math.min(entry.senses.length, MAX_SENSES))
    problems.push(`#${entryId} (${word}) has no judged sense ${sense}`)
  return entry.senses[sense]
}
for (const golden of GOLDEN_SENSES) judged(golden.entryId, golden.word, golden.sense)
for (const pair of GOLDEN_PAIRS) {
  judged(pair.entryId, pair.word, pair.sense)
  judged(pair.similarId, pair.similar, pair.similarSense)
}
/** The English word's sense, checked to be a judged one, and, given a gloss, to have it. */
const judgedEnglish = (word: string, sense: number, gloss?: string) => {
  const entry = englishFound.get(word)
  if (entry === undefined) return void problems.push(`"${word}" is not in the English dictionary`)
  if (sense >= Math.min(entry.senses.length, MAX_SENSES)) problems.push(`"${word}" has no judged sense ${sense}`)
  const glosses = (entry.senses[sense]?.glosses ?? []).map((own) => own.text).join("、")
  if (gloss !== undefined && !glosses.startsWith(gloss)) {
    problems.push(`"${word}" sense ${sense} doesn't start with ${gloss}; it has ${glosses}`)
  }
}
for (const golden of GOLDEN_ENGLISH_SENSES) judgedEnglish(golden.word, golden.sense, golden.gloss)
for (const pair of GOLDEN_ENGLISH_PAIRS) {
  judgedEnglish(pair.word, pair.sense)
  judgedEnglish(pair.similar, pair.similarSense)
}
for (const word of words) judgedEnglish(word, 0)
if (problems.length > 0) {
  console.error(`The golden set doesn't match the dictionaries:\n  ${problems.join("\n  ")}`)
  process.exit(1)
}

// --- The fixture -----------------------------------------------------------------------------

const entries = [
  ...[...found.values()].sort((a: EntryRecord, b: EntryRecord) => a.id - b.id),
  ...[...englishFound.values()].sort((a, b) => a.id - b.id)
].map((entry) => fixtureEntry(entry, MAX_SENSES))
const codes = new Set(
  entries.flatMap((entry) =>
    entry.senses.flatMap((sense) => [
      ...sense.pos,
      ...(sense.misc ?? []),
      ...(sense.fields ?? []),
      ...(sense.dialects ?? [])
    ])
  )
)
const labels = new Map([
  ...parseTags(xml).map((tag) => [tag.code, tag.label] as const),
  ...ENGLISH_TAGS.map((tag) => [tag.code, tag.label] as const)
])
const created = /JMdict created: (\d{4}-\d{2}-\d{2})/.exec(xml)?.[1] ?? "an unknown date"

const fixture: GoldenFixture = {
  about: `The entries the golden set names, cut from JMdict_e.gz (created ${created}) and the English dictionary built from data/eiwa, by tools/golden-fixture.ts. Regenerate it; don't edit it. Excerpts of JMdict (© EDRDG), Japanese Wiktionary and FrequencyWords, shared under CC BY-SA 4.0, and of EJDict-hand (CC0): see NOTICE.md beside this file.`,
  tags: Object.fromEntries([...codes].sort().map((code) => [code, labels.get(code) ?? code])),
  entries,
  loans
}
const target = join(workspaceRoot, GOLDEN_FIXTURE)
writeFileSync(target, `${JSON.stringify(fixture, null, 2)}\n`)
// Formatted as the repository formats JSON, so regenerating an unchanged set leaves no diff.
spawnSync("pnpm", ["exec", "oxfmt", target], { cwd: workspaceRoot, stdio: "ignore" })
console.log(
  `Wrote ${found.size} JMDict and ${englishFound.size} English entries, ${codes.size} tags and the loan candidates of ${words.length} words to ${GOLDEN_FIXTURE}.`
)
