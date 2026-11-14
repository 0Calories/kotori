import type { EntryId, Note, NoteSense, SenseLayout } from "@kotori/contracts"
import type { Strings } from "../i18n/strings.ts"

// A note is a dictionary entry the learner saved, showing the senses they chose in their order
// (`Note.senses`). These work out the layout (`UpdateNoteRequest.senses`) each change asks for.

/** The learner's note on an entry, if they saved it. */
export const noteOn = (notes: ReadonlyArray<Note> | undefined, entryId: EntryId): Note | undefined =>
  notes?.find((note) => note.entry.id === entryId)

/** The senses a note shows, in its order. */
export const shownSenses = (note: Note): ReadonlyArray<NoteSense> => note.senses.filter((sense) => sense.shown)

/** A sense's glosses run together as its language lists them: "to eat; to dine", "食べる、食事をする". */
export const glossLine = (language: Note["entry"]["language"], glosses: ReadonlyArray<string>, most = 3) =>
  glosses.slice(0, most).join(language === "ja" ? "; " : "、")

/** What a note means, in a line: the glosses of the senses it shows, the first sense's first. */
export const noteMeaning = (note: Note): string =>
  shownSenses(note)
    .map((sense) => glossLine(note.entry.language, sense.glosses, 2))
    .join(note.entry.language === "ja" ? " / " : "／")

/**
 * A short usage hint for a sense in reviews: the word's labels and those the sense adds, worded,
 * e.g. "Casual · Masculine"; null when none is worth saying.
 */
export const senseHint = (t: Strings, note: Note, sense: NoteSense): string | null => {
  const hint = [...note.entry.labels, ...sense.labels]
    .filter((label) => label.severity !== "quiet")
    .map((label) => t.labels.name[label.code])
    .join(" · ")
  return hint.length > 0 ? hint : null
}

/** Whether a note shows the sense: saved, from the entry page's point of view. */
export const showsSense = (note: Note | undefined, index: number): boolean =>
  note?.senses.some((sense) => sense.index === index && sense.shown) ?? false

/** What taking a sense off a note asks for: the note `arrange`d without it, or the note's removal. */
export type SenseRemoval = { readonly kind: "arrange"; readonly senses: SenseLayout } | { readonly kind: "remove" }

/**
 * The layout without one sense, or the note's removal when that is the only one shown, since a
 * note shows at least one. Hiding a sense the note doesn't show changes nothing.
 */
export const withoutSense = (note: Note, index: number): SenseRemoval => {
  const shown = shownSenses(note).map((sense) => sense.index)
  const kept = shown.filter((own) => own !== index)
  return kept.length === 0 ? { kind: "remove" } : { kind: "arrange", senses: kept }
}

/** The senses in an editor, in the note's order: shown ones first, then hidden. */
export interface SenseChoice {
  readonly index: number
  readonly shown: boolean
}

/** Where the editor starts: the note as it is. */
export const choicesOf = (note: Note): ReadonlyArray<SenseChoice> =>
  note.senses.map((sense) => ({ index: sense.index, shown: sense.shown }))

/**
 * Shows or hides a sense. A shown sense keeps its place; a sense shown again goes last among the
 * shown ones. The last shown sense can't be hidden: a note shows at least one.
 */
export const toggleChoice = (choices: ReadonlyArray<SenseChoice>, index: number): ReadonlyArray<SenseChoice> => {
  const target = choices.find((choice) => choice.index === index)
  if (target === undefined) return choices
  const shown = choices.filter((choice) => choice.shown && choice.index !== index)
  const hidden = choices.filter((choice) => !choice.shown && choice.index !== index)
  if (target.shown) {
    if (shown.length === 0) return choices
    // Hidden senses stay in the dictionary's order, as the server lists them.
    return [...shown, ...[...hidden, { index, shown: false }].sort((a, b) => a.index - b.index)]
  }
  return [...shown, { index, shown: true }, ...hidden]
}

/** Moves a shown sense up (-1) or down (+1) among the shown ones; it never passes a hidden one. */
export const moveChoice = (
  choices: ReadonlyArray<SenseChoice>,
  index: number,
  by: -1 | 1
): ReadonlyArray<SenseChoice> => {
  const from = choices.findIndex((choice) => choice.index === index && choice.shown)
  const to = from + by
  if (from === -1 || to < 0 || to >= choices.length || !choices[to]!.shown) return choices
  const moved = [...choices]
  ;[moved[from], moved[to]] = [moved[to]!, moved[from]!]
  return moved
}

/**
 * The layout the choices ask for: the shown senses in order, or null when that is every sense in
 * the dictionary's order, which also follows senses the entry gains later.
 */
export const layoutOf = (choices: ReadonlyArray<SenseChoice>): SenseLayout => {
  const shown = choices.filter((choice) => choice.shown).map((choice) => choice.index)
  const everyInOrder = shown.length === choices.length && shown.every((index, position) => index === position)
  return everyInOrder ? null : shown
}
