import { normalizeJapaneseGloss } from "@kotori/language"

const OPENING = "(（〈《「『〔【["
const CLOSING = ")）〉》」』〕】]"

const splitOutside = (text: string, separators: string): Array<string> => {
  const pieces: Array<string> = []
  let depth = 0
  let start = 0
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (OPENING.includes(char)) depth++
    else if (CLOSING.includes(char)) depth = Math.max(0, depth - 1)
    else if (depth === 0 && separators.includes(char)) {
      pieces.push(text.slice(start, index))
      start = index + 1
    }
  }
  pieces.push(text.slice(start))
  return pieces.map((piece) => piece.trim()).filter((piece) => piece.length > 0)
}

const asideOnly = (piece: string): string | null => {
  const open = OPENING.indexOf(piece[0] ?? "")
  if (open === -1 || CLOSING.indexOf(piece.at(-1) ?? "") === -1) return null
  let depth = 0
  for (let index = 0; index < piece.length; index++) {
    const char = piece[index]!
    if (OPENING.includes(char)) depth++
    else if (CLOSING.includes(char)) depth--
    // Reject strings like "(米) 食べ物 (口語)" where the opening bracket closes before the end.
    if (depth === 0 && index < piece.length - 1) return null
  }
  return piece.slice(1, -1).trim()
}

export const leadingAside = (text: string): { readonly aside: string; readonly rest: string } | null => {
  const trimmed = text.trimStart()
  if (trimmed[0] !== "(" && trimmed[0] !== "（") return null
  let depth = 0
  for (let index = 0; index < trimmed.length; index++) {
    const char = trimmed[index]!
    if (char === "(" || char === "（") depth++
    else if (char === ")" || char === "）") depth--
    if (depth === 0) return { aside: trimmed.slice(1, index).trim(), rest: trimmed.slice(index + 1).trim() }
  }
  return null
}

const SYNONYM_LENGTH = 10

export const splitDefinition = (
  definition: string
): { readonly glosses: ReadonlyArray<string>; readonly notes: ReadonlyArray<string> } => {
  const glosses: Array<string> = []
  const notes: Array<string> = []
  for (const sentence of splitOutside(definition, "。；;")) {
    const aside = asideOnly(sentence)
    if (aside !== null) {
      if (aside.length > 0) notes.push(aside)
      continue
    }
    if (/^(cf\.|→|参照)/i.test(sentence)) {
      notes.push(sentence)
      continue
    }
    const parts = splitOutside(sentence, "、")
    const synonyms =
      parts.length > 1 &&
      parts.every((part) => {
        const norm = normalizeJapaneseGloss(part)
        return norm.length > 0 && norm.length <= SYNONYM_LENGTH && !/^(または|特に|つまり|すなわち)/.test(part)
      })
    glosses.push(...(synonyms ? parts : [sentence]))
  }
  return { glosses, notes }
}
