import { Claude } from "@kotori/ai"
import { Effect, Schema } from "effect"
import type { RawEnSense, RawEnWord } from "./wiktionary.ts"
import type { ConsolidatedWord } from "./words.ts"

const unique = <A>(items: Iterable<A>): Array<A> => [...new Set(items)]

const ModelSenseSchema = Schema.Struct({
  sourceIndices: Schema.Array(Schema.Int).pipe(
    Schema.annotate({
      description: "0-based indices of the raw enwiktionary senses merged into this learner sense (most representative first)."
    })
  ),
  glosses: Schema.Array(Schema.String).pipe(
    Schema.annotate({
      description:
        "Japanese glosses: first 1–2 MUST be short canonical equivalents (e.g. '子供', '音信不通になる', 'ありのままでいる'), followed optionally by 1 concise explanatory gloss for idioms/slang."
    })
  ),
  info: Schema.NullOr(Schema.String).pipe(
    Schema.annotate({
      description: "Optional short grammar or collocation note in Japanese (e.g. 'be ghost の形で'), or null."
    })
  )
})

const ModelWordSchema = Schema.Struct({
  headword: Schema.String,
  familiarity: Schema.Int.pipe(
    Schema.annotate({
      description:
        "Spoken familiarity rating from 1 to 5 where 5 is HIGHEST (5 = everyday core word/idiom like 'eat', 'house', 'hang out'; 4 = well-known idiom/slang like 'keep it real', 'salty', 'under the weather'; 3 = moderately known slang/word like 'twerk', 'rizz'; 2 = formal/dated; 1 = archaic like 'thou', 'hither')."
    })
  ),
  senses: Schema.Array(ModelSenseSchema)
})

export const BatchOutputSchema = Schema.Struct({
  words: Schema.Array(ModelWordSchema)
})

export const CONSOLIDATE_SYSTEM_PROMPT = `You are building an English-to-Japanese dictionary for Japanese speakers learning natural, modern spoken and written English (Kotori).

Given a batch of English headwords and their raw senses extracted from English Wiktionary (enwiktionary):
1. Select, consolidate, and rank at most 6 distinct senses per headword that matter to modern learners:
   - Order senses by everyday modern frequency (commonest everyday meaning first).
   - Merge near-duplicate micro-senses (e.g. "tasting of salt" + "containing salt" -> one sense).
   - Drop obsolete, archaic, historical, dialect-only, or hyper-specialist senses (e.g., gauge theory, IRC bots, 17th-century bowls, goat giving birth) UNLESS the word itself is archaic/historical (like "thou", "thee", "hither", "gramophone") and has no modern senses.
   - IMPORTANT: When a common word has a widely used modern slang or colloquial sense (e.g., "ghost" = cut off contact, "salty" = bitter/upset, "cap" = lie, "slay" = do amazingly well, "goat" = greatest of all time), ALWAYS include that slang sense in the top 2–4 senses so learners see it above the fold.
2. Write natural Japanese dictionary glosses (\`glosses\`) for each kept sense:
   - The first 1–2 items MUST be short, canonical Japanese words or phrases (no trailing periods, e.g. ["子供", "お子さん"], ["塩辛い", "しょっぱい"], ["音信不通になる", "未読スルーする"], ["ありのままでいる", "本音で話す"]) so Japanese reverse lookup and synonym matching work.
   - For verbs, match Japanese transitivity naturally (e.g., "（人を）殺す" or "音信不通になる").
   - When a sense is culture-specific slang or an idiom that a single Japanese word doesn't fully explain (like "twerk", "rizz", "keep it real", "slay"), include a concise, natural Japanese explanation as the 2nd or 3rd gloss (e.g. ["トゥワークする", "腰を落としてお尻を激しく振るダンスを踊る"]).
   - Use \`info\` ONLY for specific grammar patterns, collocations, or usage context (e.g., "be ghost の形で", "主に否定文で", "greatest of all time の略"). Do NOT put bare register labels like "スラング", "口語", "慣用句", or "文語" in \`info\` because those are already rendered as tags; set \`info\` to null when no extra grammar/context note is needed.
3. Reference the \`sourceIndices\` from the raw senses so each sense inherits its part of speech, register tags (slang/colloquial), and synonyms.`

const MAX_PROMPT_SENSES = 35
const PRIORITY_MISC = new Set(["sl", "col", "net-sl", "id", "vulg"])
const OBSOLETE_MISC = new Set(["obs", "arch", "hist"])
const OBSOLETE_OR_RARE_MISC = new Set(["arch", "obs", "rare", "dated", "hist"])

/**
 * Selects up to `MAX_PROMPT_SENSES` raw senses for the prompt, keeping all slang/colloquial/idiomatic
 * senses even if they appear past sense #35 on polysemous words like "ghost" or "cap".
 */
const selectPromptSenses = (senses: ReadonlyArray<RawEnSense>): ReadonlyArray<RawEnSense> => {
  if (senses.length <= MAX_PROMPT_SENSES) return senses
  const current = senses.filter((s) => !s.misc.some((m) => OBSOLETE_MISC.has(m)))
  const pool = current.length > 0 ? current : senses
  if (pool.length <= MAX_PROMPT_SENSES) return pool

  const kept = new Map<number, RawEnSense>()
  for (const s of pool) {
    if (s.misc.some((m) => PRIORITY_MISC.has(m))) kept.set(s.index, s)
  }
  for (const s of pool) {
    if (kept.size >= MAX_PROMPT_SENSES) break
    kept.set(s.index, s)
  }
  return [...kept.values()].sort((a, b) => a.index - b.index)
}

export const formatConsolidatePrompt = (words: ReadonlyArray<RawEnWord>): string =>
  words
    .map((word) => {
      const header = `=== ${word.headword}${word.ipa ? ` ${word.ipa}` : ""} ===`
      const jaHints =
        word.entryJaTranslations.length > 0 ? `Wiktionary JA hints: ${word.entryJaTranslations.join(", ")}` : null
      const senses = selectPromptSenses(word.senses)
        .map((sense) => {
          const tags = [...sense.pos, ...sense.misc, ...sense.dialects, ...sense.fields]
          const ex = sense.examples[0] ? ` — e.g. "${sense.examples[0]}"` : ""
          const ja = sense.jaTranslations.length > 0 ? ` [JA: ${sense.jaTranslations.join(", ")}]` : ""
          return `  [${sense.index}] (${tags.join(", ")}) ${sense.glosses.join(" / ")}${ja}${ex}`
        })
        .join("\n")
      return [header, jaHints, senses].filter((part): part is string => part !== null).join("\n")
    })
    .join("\n\n")

export const mergeConsolidatedWord = (
  raw: RawEnWord,
  model: typeof ModelWordSchema.Type
): ConsolidatedWord => {
  const familiarity = Math.max(1, Math.min(5, model.familiarity))
  const senses = model.senses
    .map((sense) => {
      const sources = sense.sourceIndices
        .map((index) => raw.senses[index])
        .filter((item): item is RawEnSense => item !== undefined)
      const activeSources = sources.length > 0 ? sources : raw.senses.slice(0, 1)
      const primary = activeSources[0]
      const pos = unique(activeSources.flatMap((src) => src.pos))
      const misc = unique(
        activeSources
          .flatMap((src) => src.misc)
          .filter((tag) => !OBSOLETE_OR_RARE_MISC.has(tag) || (primary?.misc.includes(tag) ?? false))
      )
      const fields = unique(activeSources.flatMap((src) => src.fields))
      const dialects = unique(activeSources.flatMap((src) => src.dialects))
      const synonyms = unique(activeSources.flatMap((src) => src.synonyms)).slice(0, 6)
      const antonyms = unique(activeSources.flatMap((src) => src.antonyms)).slice(0, 6)
      const glosses = sense.glosses.map((g) => g.trim()).filter((g) => g.length > 0)
      const info = sense.info && sense.info.trim().length > 0 ? [sense.info.trim()] : []
      return {
        pos: pos.length > 0 ? pos : ["exp"],
        ...(misc.length > 0 ? { misc } : {}),
        ...(fields.length > 0 ? { fields } : {}),
        ...(dialects.length > 0 ? { dialects } : {}),
        glosses,
        ...(info.length > 0 ? { info } : {}),
        ...(synonyms.length > 0 ? { synonyms } : {}),
        ...(antonyms.length > 0 ? { antonyms } : {})
      }
    })
    .filter((sense) => sense.glosses.length > 0)

  return {
    headword: raw.headword,
    ipa: raw.ipa,
    familiarity,
    ...(raw.spellings.length > 0 ? { spellings: [...raw.spellings] } : {}),
    ...(raw.inflections.length > 0
      ? { inflections: raw.inflections.map((f) => ({ text: f.text, tags: [...f.tags] })) }
      : {}),
    senses
  }
}

/**
 * Consolidates, ranks, and translates a batch of raw `enwiktionary` entries using Claude.
 */
export const consolidateBatch = Effect.fn("Eiwa.consolidateBatch")(function* (words: ReadonlyArray<RawEnWord>) {
  if (words.length === 0) return [] as Array<ConsolidatedWord>
  const claude = yield* Claude
  const output = yield* claude.generate({
    schema: BatchOutputSchema,
    system: CONSOLIDATE_SYSTEM_PROMPT,
    prompt: formatConsolidatePrompt(words),
    effort: "low"
  })
  const byHeadword = new Map(output.words.map((item) => [item.headword, item]))
  const results: Array<ConsolidatedWord> = []
  for (const raw of words) {
    const model =
      byHeadword.get(raw.headword) ??
      output.words.find((item) => item.headword.toLowerCase() === raw.headword.toLowerCase())
    if (model !== undefined) {
      const merged = mergeConsolidatedWord(raw, model)
      if (merged.senses.length > 0) results.push(merged)
    }
  }
  return results
})
