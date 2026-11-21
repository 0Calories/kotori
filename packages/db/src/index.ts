/**
 * Kotori's data model, as Drizzle tables: the single source of truth. drizzle-kit diffs them into
 * `../migrations`; the backend's queries infer their results from them, and `@kotori/contracts`
 * derives the HTTP schemas from them. One file per table, each holding the table, the enums only
 * it uses, its JSONB value schemas and its id brand; enums shared by several tables and the column
 * helpers live in `columns.ts`. No connection code and no relations (the backend's query layer
 * owns those), so the client can import it.
 */

export * from "./columns.ts"

// Monolingual Japanese and English dictionary entries stored as PostgreSQL JSONB documents
// (`entries.base` for deterministic Source facts, nullable `entries.enrichment` for Kotori AI
// enrichment) paired with an isolated, rebuildable `entry_search` projection and `tags` lookup.
export * from "./entryDocument.ts"
export * from "./entries.ts"
export * from "./entrySearch.ts"
export * from "./tags.ts"

// The learner: who they are and what they saved. Everything cascades from `users`.
export * from "./users.ts"
export * from "./notes.ts"
export * from "./coachCache.ts"
export * from "./coachUsage.ts"
export * from "./proposals.ts"

// Content-addressed speech clips. Form pronunciation clips resolve deterministically from `audio`
// by language and form text.
export * from "./audio.ts"
export * from "./audioFiles.ts"
