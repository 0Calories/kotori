/**
 * Kotori's data model, as Drizzle tables: the single source of truth. drizzle-kit diffs the
 * tables into `../migrations`; the backend's queries infer their results from them, and
 * `@kotori/contracts` derives the HTTP schemas from them. No connection code, so this package
 * is safe for the client to import.
 */
export * from "./relations.ts"
export * from "./tables.ts"
