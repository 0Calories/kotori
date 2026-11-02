import type { GlossRecord, SenseRecord } from "@kotori/db"
import { asideOnly, splitOutside } from "./text.ts"
import { REGIONS, USAGE } from "./tags.ts"
import { emptySense, type FormOf, formOf, isEnglish, type Word } from "./words.ts"

/**
 * Reads EJDict-hand (github.com/kujirahand/EJDict), a public-domain (CC0) English–Japanese
 * dictionary of about 46,000 words, one per line: `word[, spelling…]<TAB>meanings`, the
 * meanings separated by " / ". It fills in words Japanese Wiktionary has no entry for.
 */

/** The dictionary is kept as one file per initial letter. */
export const EJDICT_FILES = "abcdefghijklmnopqrstuvwxyz"
  .split("")
  .map((letter) => `https://raw.githubusercontent.com/kujirahand/EJDict/master/src/${letter}.txt`)

/** EJDict's part-of-speech marks, used where a line covers more than one part of speech. */
const MARKS: Readonly<Record<string, string>> = {
  名: "n",
  動: "v",
  形: "adj",
  副: "adv",
  間投: "int",
  前: "prep",
  接: "conj",
  代: "pn"
}

/** "《米話》" is two labels written together: 米 and 話. */
const labelsOf = (note: string) => (/^[米英豪][話俗古]$/.test(note) ? note.split("") : [note])

/**
 * A grammar note with the headword spelled out where EJDict writes "~". A note that is only the
 * word's article or possessive, 《a~》 on "crap" (take a crap), says the word is used in that
 * form, as English–Japanese dictionaries put it: 「a crap」の形で. Shown as "a~", it read as debris.
 */
const spelledOut = (note: string, headword: string) => {
  if (!note.includes("~")) return note
  const spelled = note
    .replace(/~/g, ` ${headword} `)
    .replace(/\s+/g, " ")
    .replace(/\s+([,;)])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/([a-z'])\(/gi, "$1 (")
    // EJDict writes 《a~》 for "an" too: "an atom", though "a university", "a one-off".
    .replace(/\ba (?=(?!one\b|eu)[aeio])/gi, "an ")
    .trim()
  const articles = /^(?:[\s,;()]|\b(?:a|an|the|one's|my|your|his|her|its|our|their)\b)*$/i
  return articles.test(note.replace(/~/g, "")) ? `「${spelled}」の形で` : spelled
}

const readSense = (meaning: string, headword: string): SenseRecord | null => {
  const sense = {
    pos: new Set<string>(),
    misc: new Set<string>(),
    dialects: new Set<string>(),
    info: new Array<string>()
  }
  let text = meaning.replace(/\{([^{}]+)\}/g, (_, mark: string) => {
    const pos = MARKS[mark]
    if (pos !== undefined) sense.pos.add(pos)
    return ""
  })
  text = text.replace(/〈([CU])〉/g, (_, kind: string) => {
    sense.pos.add("n")
    sense.misc.add(kind === "C" ? "countable" : "uncountable")
    return ""
  })
  // Usage labels become tags; grammar notes ("《補語にのみ用いて》", "《+『for』+『名』》") become notes.
  text = text.replace(/《([^《》]*)》/g, (_, note: string) => {
    const labels = labelsOf(note.trim())
    if (labels.every((label) => USAGE[label] !== undefined || REGIONS[label] !== undefined)) {
      for (const label of labels) {
        const usage = USAGE[label]
        if (usage !== undefined) sense.misc.add(usage)
        else sense.dialects.add(REGIONS[label]!)
      }
    } else {
      sense.info.push(spelledOut(note.replace(/[『』]/g, "").trim(), headword))
    }
    return ""
  })
  text = text.replace(/[『』]/g, "")

  const glosses: Array<GlossRecord> = []
  for (const piece of splitOutside(text, ",;")) {
    const aside = asideOnly(piece)
    if (aside !== null) sense.info.push(aside)
    else glosses.push({ text: piece, type: null })
  }
  if (glosses.length === 0) return null
  // "heliumの化学記号", "Mondayの略": an abbreviation or symbol of another word.
  if (glosses.every((gloss) => /の(略|略語|略式|化学記号|記号)$/.test(gloss.text))) sense.misc.add("abbr")
  // EJDict rarely marks parts of speech; "…を" before a verb marks it transitive.
  if (sense.pos.size === 0 && /^(…|〈[^〉]*〉)を/.test(glosses[0]!.text)) sense.pos.add("v").add("vt")
  return {
    ...emptySense(),
    glosses,
    pos: [...sense.pos],
    misc: [...sense.misc],
    dialects: [...sense.dialects],
    info: sense.info.filter((note) => note.length > 0)
  }
}

/** Every word in EJDict, and the lines that only point at another word's spelling or inflection. */
export const parseEjdict = (lines: Iterable<string>) => {
  const words: Array<Word> = []
  const formsOf: Array<FormOf> = []
  for (const line of lines) {
    const tab = line.indexOf("\t")
    if (tab === -1) continue
    const [headword, ...spellings] = line
      .slice(0, tab)
      .split(",")
      .map((word) => word.trim())
      .filter((word) => word.length > 0 && isEnglish(word))
    if (headword === undefined) continue

    const senses: Array<SenseRecord> = []
    const references: Array<string> = []
    for (const meaning of line.slice(tab + 1).split(/\s+\/\s+/)) {
      const trimmed = meaning.trim()
      // "=OK,O.K.": the same word as another, spelled differently.
      const same = /^=\s*(.+)$/.exec(trimmed)
      if (same !== null) {
        references.push(
          ...same[1]!
            .split(",")
            .map((word) => word.trim())
            .filter(isEnglish)
        )
        continue
      }
      // Usage labels may come first: "《古・詩》blessの過去・過去分詞".
      const form = formOf(trimmed.replace(/《[^《》]*》/g, ""))
      if (form !== null) {
        formsOf.push({ text: headword, ...form })
        continue
      }
      const sense = readSense(trimmed, headword)
      if (sense !== null) senses.push(sense)
    }

    if (senses.length === 0) {
      // Nothing but "=color": a spelling of that word.
      for (const base of references) if (base !== headword) formsOf.push({ text: headword, base, tags: [] })
      continue
    }
    const [first, ...rest] = senses
    words.push({
      headword,
      ipa: null,
      spellings,
      inflections: [],
      senses: [{ ...first!, xrefs: references.filter((word) => word !== headword) }, ...rest]
    })
  }
  return { words, formsOf }
}
