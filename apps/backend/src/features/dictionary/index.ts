// The dictionary feature's interface for the rest of the backend: other features and the entry
// points call these, never its queries directly.
export {
  countOf,
  deleteEntries,
  entriesByPriority,
  entryCount,
  findForms,
  getEntries,
  insertEntries,
  saveKotoriCautions,
  type StoredEntry,
  tagNames,
  topEntryId
} from "./queries.ts"
export { reviewEntries } from "./entryReview.ts"
export { labelsBySense } from "./usage.ts"
export { notedEntries } from "./noted.ts"
