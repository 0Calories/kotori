// The enrichment feature's interface for the rest of the backend: other features and the entry
// points call these, never its queries directly.
export { type ExampleRow, examplesFor, wipeEnrichment } from "./queries.ts"
