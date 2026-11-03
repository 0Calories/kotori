// The audio feature's interface for the rest of the backend: other features and the entry
// points call these, never its queries directly.
export { audioCharactersSince, entryClips, exampleClips, linkEntryAudio, linkExampleAudio } from "./queries.ts"
export { AUDIO_BUDGET_WINDOW, DEFAULT_AUDIO_MONTHLY_CHARS } from "./Speech.ts"
