/**
 * The data model, as Drizzle tables. This directory is the single source of truth:
 * drizzle-kit diffs it into `packages/db/migrations`, and row, insert and Effect
 * Schema types derive from it. Managed Better Auth's `neon_auth` tables are declared
 * in `../neonAuth.ts`, outside this directory, so drizzle-kit never diffs them.
 */
export * from "./relations.ts"
export * from "./tables.ts"
