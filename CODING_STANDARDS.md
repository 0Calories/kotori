# Kotori — Coding Standards

## Closed sets and lifecycles

A status, kind or state is a closed set. `apps/backend/src/features/enrichment/jobs.ts` (the job lifecycle) and `enrichmentStatus` are the worked example.

- **Match exhaustively**: give every member its own case, so a new member fails to compile until it is given a meaning. Use `Match.value(x).pipe(..., Match.exhaustive)` where the decision is an expression, a `switch` with every case listed elsewhere (`typescript/switch-exhaustiveness-check` treats a `default` as covering nothing). For a union that carries data, `Schema.TaggedUnion` and its `match`.
- **Type by the set**: derive the type from its schema or table (`(typeof jobs.$inferSelect)["status"]`), so the compiler knows the members.
- **Name absence**: "no job yet" is a state with its own case and its own wire value (`unrequested`).
- **One transition table per lifecycle**: every move, the states it is made from and the state it leads to, in one place (`MOVES`); queries apply the table.

## Comments

Leave declarations and statements uncommented when the identifier, types, implementation, or `GLOSSARY.md` / `docs/adr/` already convey what they do.

- **Comment only non-obvious constraints**: write a comment only for an invariant, edge case, external quirk, or performance reason a reader cannot infer from the code (e.g. why an English `reading` is excluded from search forms, or why an expression index needs parentheses).
- **Never narrate or restate**: omit file banners, JSDoc prose dumps on self-explanatory schemas, queries, services, and components, and step-by-step narration in tests.
- **Keep comments to what is unique**: write one direct sentence on the non-obvious fact; domain rules belong in `GLOSSARY.md` and `docs/adr/`, not repeated across source files.
