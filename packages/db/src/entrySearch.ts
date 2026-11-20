import { sql } from "drizzle-orm"
import { type AnyPgColumn, boolean, index, integer, pgEnum, text } from "drizzle-orm/pg-core"
import { bytewiseText, englishDocument, language, simpleDocument, table, textList } from "./columns.ts"
import { entries, reviewState } from "./entries.ts"
import { type EntryId, FORM_KINDS } from "./entryDocument.ts"

/** Form kinds stored in the search projection (matches `FormKind`). */
export const formKind = pgEnum("form_kind", FORM_KINDS)

/** Whether an `entry_search` row projects a searchable form or a searchable gloss. */
export const entrySearchKind = pgEnum("entry_search_kind", ["form", "gloss"])

// Partial index predicates — written with literals so Postgres's query planner matches them.
export const isJapaneseFormSearch = (kind: AnyPgColumn, lang: AnyPgColumn) => sql`${kind} = 'form' AND ${lang} = 'ja'`

export const isEnglishFormSearch = (kind: AnyPgColumn, lang: AnyPgColumn) => sql`${kind} = 'form' AND ${lang} = 'en'`

export const isEnglishSpellingSearch = (kind: AnyPgColumn, lang: AnyPgColumn, fk: AnyPgColumn) =>
  sql`${kind} = 'form' AND ${lang} = 'en' AND ${fk} = 'spelling'`

export const isGlossSearch = (kind: AnyPgColumn) => sql`${kind} = 'gloss'`

export const isJapaneseGlossDocSearch = (kind: AnyPgColumn, lang: AnyPgColumn) =>
  sql`${kind} = 'gloss' AND ${lang} = 'ja'`

export const isEnglishGlossCjkSearch = (kind: AnyPgColumn, lang: AnyPgColumn) =>
  sql`${kind} = 'gloss' AND ${lang} = 'en'`

/**
 * Isolated, disposable search projection derived purely from `entries.base` plus lifecycle scalars
 * (`language`, `review_state`, `common`, `priority`). Entries with `review_state = 'discarded'` or
 * `redirect_to IS NOT NULL` are omitted. Updating or wiping `entries.enrichment` never touches this
 * table or triggers GIN index write amplification.
 */
export const entrySearch = table(
  "entry_search",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    entryId: text()
      .$type<EntryId>()
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    kind: entrySearchKind().notNull(),
    language: language().notNull(),
    reviewState: reviewState().notNull().default("approved"),
    common: boolean().notNull().default(false),
    priority: integer().notNull().default(0),
    /** Form kind when `kind = 'form'`; null for glosses. */
    formKind: formKind(),
    /** Raw form text (bytewise-collated for prefix range scans) or raw gloss text. */
    text: bytewiseText().notNull(),
    /** Case-folded form text for English exact and prefix lookups; null for Japanese forms and glosses. */
    folded: bytewiseText(),
    /** Normalized gloss text (`normalizeGloss` / `normalizeJapaneseGloss`) when `kind = 'gloss'`. */
    norm: text(),
    /** Sense index when `kind = 'gloss'`. */
    sense: integer(),
    /** Gloss position within its sense when `kind = 'gloss'`. */
    position: integer(),
    /** Number of glosses in the sense when `kind = 'gloss'`. */
    glossCount: integer(),
    /** Form tags (e.g. inflection tags) when `kind = 'form'`. */
    tags: textList(),
    /** Sense `misc` usage tags when `kind = 'gloss'`, for ranking penalties. */
    misc: textList(),
    /** Overlapping CJK bigrams and kanji unigrams for short Japanese substring lookup (#180 seam). */
    cjkTokens: textList()
  },
  (t) => [
    index("entry_search_entry_id").on(t.entryId),
    index("entry_search_form_text").on(t.text).where(isJapaneseFormSearch(t.kind, t.language)),
    index("entry_search_form_folded").on(t.folded).where(isEnglishFormSearch(t.kind, t.language)),
    index("entry_search_form_doc")
      .using("gin", simpleDocument(t.text))
      .where(isEnglishSpellingSearch(t.kind, t.language, t.formKind)),
    index("entry_search_form_trgm")
      .using("gin", t.text.op("gin_trgm_ops"))
      .where(isEnglishSpellingSearch(t.kind, t.language, t.formKind)),
    index("entry_search_gloss_norm").on(t.language, t.norm).where(isGlossSearch(t.kind)),
    index("entry_search_gloss_doc")
      .using("gin", englishDocument(t.text))
      .where(isJapaneseGlossDocSearch(t.kind, t.language)),
    index("entry_search_gloss_trgm").using("gin", t.norm.op("gin_trgm_ops")).where(isGlossSearch(t.kind)),
    index("entry_search_cjk_tokens").using("gin", t.cjkTokens).where(isEnglishGlossCjkSearch(t.kind, t.language))
  ]
)
