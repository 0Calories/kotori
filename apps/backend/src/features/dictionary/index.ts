// The dictionary feature's interface for the rest of the backend: other features and the entry
// points call these, never its queries directly.
export {
  countOf,
  entriesByPriority,
  entryCount,
  findForms,
  getEntries,
  insertEntries,
  saveKotoriCautions,
  tagNames
} from "./queries.ts"
export { labelsBySense } from "./usage.ts"
