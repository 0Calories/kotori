/**
 * Rebuilds the golden fixture (`packages/nuance/golden/entries.json`) from the local JMDict
 * download: every entry the golden set names, cut to the senses Kotori judges, with the labels
 * of the tags they use, and the katakana loan candidates of the golden English words as the
 * English job's lookup finds them. It reads `data/jmdict/JMdict_e.gz` and writes the fixture,
 * and touches no database. Run `pnpm golden` after editing the golden set or downloading a newer
 * JMDict, and commit the result: `kotori eval` reads only the fixture.
 */
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { gunzipSync } from "node:zlib"
import { workspaceRoot } from "../packages/db/src/Paths.ts"
import { type EntryRecord, loanCandidatesIn, normalizeGloss } from "../packages/db/src/records.ts"
import { parseEntries, parseTags } from "../packages/jmdict/src/parse.ts"
import {
  fixtureEntry,
  GOLDEN_ENGLISH,
  GOLDEN_FIXTURE,
  GOLDEN_PAIRS,
  GOLDEN_SENSES,
  type GoldenFixture
} from "../packages/nuance/src/golden.ts"
import { MAX_GLOSSES, MAX_LOANS } from "../packages/nuance/src/english.ts"
import { MAX_SENSES } from "../packages/nuance/src/state.ts"

const source = join(workspaceRoot, "data/jmdict/JMdict_e.gz")
if (!existsSync(source)) {
  console.error(`${source} is missing. Download https://www.edrdg.org/pub/Nihongo/JMdict_e.gz there.`)
  process.exit(1)
}
const xml = gunzipSync(readFileSync(source)).toString("utf8")

const wanted = new Set([
  ...GOLDEN_SENSES.map((golden) => golden.entryId),
  ...GOLDEN_ENGLISH.map((golden) => golden.entryId),
  ...GOLDEN_PAIRS.flatMap((pair) => [pair.entryId, pair.similarId])
])
const all = Array.from(parseEntries(xml))
const found = new Map(all.filter((entry) => wanted.has(entry.id)).map((entry) => [entry.id, entry]))

// The loan candidates, by the same rules as `DictionaryRepo.loanCandidates`: once as production
// finds them until JMDict is re-imported with lsource (gloss matches only), once as after.
const words = GOLDEN_ENGLISH.map((golden) => golden.english)
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
const byId = new Map(all.map((entry) => [entry.id, entry]))
for (const candidate of [...glossesOnly, ...withSources]) found.set(candidate.entryId, byId.get(candidate.entryId)!)

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
for (const golden of GOLDEN_ENGLISH) {
  const sense = judged(golden.entryId, golden.word, golden.sense)
  const glosses = sense?.glosses.slice(0, MAX_GLOSSES).map((gloss) => normalizeGloss(gloss.text)) ?? []
  if (sense !== undefined && !glosses.includes(normalizeGloss(golden.english))) {
    problems.push(`#${golden.entryId} (${golden.word}) sense ${golden.sense} doesn't lead with "${golden.english}"`)
  }
}
if (problems.length > 0) {
  console.error(`The golden set doesn't match JMDict:\n  ${problems.join("\n  ")}`)
  process.exit(1)
}

const entries = [...found.values()]
  .sort((a: EntryRecord, b: EntryRecord) => a.id - b.id)
  .map((entry) => fixtureEntry(entry, MAX_SENSES))
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
const labels = new Map(parseTags(xml).map((tag) => [tag.code, tag.label]))
const created = /JMdict created: (\d{4}-\d{2}-\d{2})/.exec(xml)?.[1] ?? "an unknown date"

const fixture: GoldenFixture = {
  about: `The JMDict entries the golden set names, cut from JMdict_e.gz (created ${created}) by tools/golden-fixture.ts. Regenerate it; don't edit it.`,
  tags: Object.fromEntries([...codes].sort().map((code) => [code, labels.get(code) ?? code])),
  entries,
  loans
}
const target = join(workspaceRoot, GOLDEN_FIXTURE)
writeFileSync(target, `${JSON.stringify(fixture, null, 2)}\n`)
// Formatted as the repository formats JSON, so regenerating an unchanged set leaves no diff.
spawnSync("pnpm", ["exec", "oxfmt", target], { cwd: workspaceRoot, stdio: "ignore" })
console.log(
  `Wrote ${entries.length} entries, ${codes.size} tags and the loan candidates of ${words.length} words to ${GOLDEN_FIXTURE}.`
)
