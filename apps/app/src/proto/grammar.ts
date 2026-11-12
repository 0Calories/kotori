import type { Entry, Language, Sense, Tag } from "@kotori/contracts"
import { posLabel, type Strings, tagName } from "../i18n/strings.ts"

export interface GrammarTagItem {
  readonly key: string
  readonly label: string
  readonly kind: "grammar" | "field" | "orthography"
}

/**
 * Splits compound POS codes (`v5u` -> `["verb", "godan"]` in English, `["五段動詞"]` in Japanese)
 * into clean atomic grammar tags without parentheses.
 */
export const expandPosTags = (
  t: Strings,
  uiLanguage: Language,
  partsOfSpeech: ReadonlyArray<Tag>
): ReadonlyArray<GrammarTagItem> => {
  const seen = new Set<string>()
  const out: GrammarTagItem[] = []
  const push = (label: string) => {
    const normalized = label.trim()
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    out.push({ key: `pos:${normalized}`, label: normalized, kind: "grammar" })
  }

  for (const tag of partsOfSpeech) {
    if (uiLanguage === "en") {
      if (tag.code.startsWith("v5")) {
        push("verb")
        push("godan")
        continue
      }
      if (tag.code.startsWith("v1")) {
        push("verb")
        push("ichidan")
        continue
      }
      if (tag.code === "vk") {
        push("verb")
        push("kuru")
        continue
      }
      if (tag.code.startsWith("vs")) {
        push("verb")
        push("suru")
        continue
      }
    } else {
      if (tag.code.startsWith("v5")) {
        push("五段動詞")
        continue
      }
      if (tag.code.startsWith("v1")) {
        push("一段動詞")
        continue
      }
      if (tag.code === "vk") {
        push("カ変動詞")
        continue
      }
    }
    const label = posLabel(t, tag.code) ?? tag.name
    push(label)
  }
  return out
}

/** Primary grammar tags shown in the entry headboard (taken from the primary sense). */
export const heroGrammarTags = (
  t: Strings,
  uiLanguage: Language,
  entry: Pick<Entry, "senses" | "usuallyKana">
): ReadonlyArray<GrammarTagItem> => {
  const first = entry.senses[0]
  const pos = first ? expandPosTags(t, uiLanguage, first.partsOfSpeech) : []
  const kana: ReadonlyArray<GrammarTagItem> = entry.usuallyKana
    ? [{ key: "orth:uk", label: t.entry.usuallyKana, kind: "orthography" }]
    : []
  return [...pos, ...kana]
}

/**
 * Grammar and subject-field tags shown inside a sense card: only POS tags that differ from the
 * headboard's grammar tags, followed by this sense's subject fields (`food`, `business`, `law`).
 */
export const senseGrammarTags = (
  t: Strings,
  uiLanguage: Language,
  sense: Pick<Sense, "partsOfSpeech" | "fields">,
  heroTagLabels: ReadonlySet<string>
): ReadonlyArray<GrammarTagItem> => {
  const diffPos = expandPosTags(t, uiLanguage, sense.partsOfSpeech).filter((item) => !heroTagLabels.has(item.label))
  const fields: ReadonlyArray<GrammarTagItem> = sense.fields.map((field) => ({
    key: `field:${field.code}`,
    label: tagName(t, field),
    kind: "field"
  }))
  return [...diffPos, ...fields]
}
