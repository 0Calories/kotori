// The dictionary feature's interface for the rest of the backend: other features and the entry
// points call these, never its queries directly.
export { countOf, entriesByPriority, entryCount, getEntries, getEntryDocuments, tagNames } from "./queries.ts"
export { rebuildEntrySearch } from "./searchProjection.ts"
