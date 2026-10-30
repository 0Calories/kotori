import type { Formality, Medium, Nuance, Sense } from "@kotori/domain"
import type { IconName } from "../components/Icon.tsx"
import type { ScaleRow } from "../components/NuanceScales.tsx"
import { type Strings, tagLabel } from "../i18n/strings.ts"

// How the entry page shows a word's judged nuance: which scales, chips and cautions, and where.

/** Below this confidence a judgment is kept to ourselves: a hint is only worth showing when it's right. */
export const CONFIDENT = 0.55

const FORMALITY_ORDER: ReadonlyArray<Formality> = ["vulgar", "casual", "neutral", "polite", "formal"]
const MEDIUM_ORDER: ReadonlyArray<Medium> = ["spoken", "both", "written"]

/** The stop for a judged label: "neutral" sits dead centre regardless of Jev's raw score. */
const snapped = <L extends string>(order: ReadonlyArray<L>, value: L) =>
  Math.max(order.indexOf(value), 0) / (order.length - 1)

/** The confidently judged register shape; absent or unsure means "treat as scaled". */
export const shapeOf = (nuance: Nuance) =>
  nuance.registerShape && nuance.registerShape.confidence >= CONFIDENT ? nuance.registerShape.value : "scaled"

/**
 * How the word's register is shown: a slider per scale, except where a slider is the
 * wrong model — a word at a scale's far end, a fixed-register word (insults, ceremonial
 * wording) or a split one (clinical in one world, crude in the other) becomes chips.
 * Low-confidence judgments are left out entirely.
 */
export const registerDisplay = (t: Strings, nuance: Nuance): { rows: Array<ScaleRow>; chips: Array<string> } => {
  const shape = shapeOf(nuance)
  // A split register has no honest slider position and no single label: one chip says it all.
  if (shape === "split") return { rows: [], chips: [t.nuance.contextSplit] }
  const rows: Array<ScaleRow> = []
  const chips: Array<string> = []
  if (nuance.formality.confidence >= CONFIDENT) {
    const value = nuance.formality.value
    if (value === "vulgar" || value === "formal") chips.push(t.nuance.edge[value])
    else if (shape === "fixed") chips.push(t.nuance.scale[value])
    else {
      rows.push({
        left: t.nuance.poles.casual,
        right: t.nuance.poles.formal,
        position: snapped(FORMALITY_ORDER, value),
        value: t.nuance.scale[value],
        stops: FORMALITY_ORDER.length
      })
    }
  }
  if (nuance.medium.confidence >= CONFIDENT) {
    const value = nuance.medium.value
    if (value === "spoken" || value === "written") chips.push(t.nuance.edge[value])
    else if (shape !== "fixed") {
      rows.push({
        left: t.nuance.poles.spoken,
        right: t.nuance.poles.written,
        position: snapped(MEDIUM_ORDER, value),
        value: t.nuance.mediumScale[value],
        stops: MEDIUM_ORDER.length
      })
    }
  }
  return { rows, chips }
}

/** The nuance worth saying in words: tags such as "Young people", and cautions such as "Slang". */
export const nuanceNotes = (t: Strings, nuance: Nuance) => {
  const tags = [
    nuance.keigo.value !== "none" && nuance.keigo.confidence >= CONFIDENT ? t.nuance.keigo[nuance.keigo.value] : null,
    nuance.gender.value !== "neutral" && nuance.gender.confidence >= CONFIDENT
      ? t.nuance.gender[nuance.gender.value]
      : null,
    nuance.age.value !== "any" && nuance.age.confidence >= CONFIDENT ? t.nuance.age[nuance.age.value] : null,
    nuance.currency.value !== "current" && nuance.currency.confidence >= CONFIDENT
      ? t.nuance.currency[nuance.currency.value]
      : null,
    nuance.connotation.value !== "neutral" && nuance.connotation.confidence >= CONFIDENT
      ? t.nuance.connotation[nuance.connotation.value]
      : null,
    // English words: whose English it is.
    nuance.variety && nuance.variety.value !== "universal" && nuance.variety.confidence >= CONFIDENT
      ? t.nuance.english.variety[nuance.variety.value]
      : null
  ].filter((tag): tag is string => tag !== null && tag.length > 0)
  // Vulgar, fixed-register and dictionary-tagged insult words announce themselves; the
  // rudeness caution earns its place on words that look safe but misfire upward (了解,
  // ご苦労様, "yep") — including harmless slang, which is why slang alone doesn't suppress it.
  const obviouslyRude =
    (nuance.formality.value === "vulgar" && nuance.formality.confidence >= CONFIDENT) ||
    shapeOf(nuance) === "fixed" ||
    (nuance.connotation.value === "negative" && nuance.connotation.source === "jmdict")
  const profanity =
    nuance.profanity && nuance.profanity.value !== "none" && nuance.profanity.confidence >= CONFIDENT
      ? nuance.profanity.value
      : null
  const cautions: Array<{ readonly label: string; readonly icon: IconName }> = [
    // English words: how offensive a swear word is, which learners can't tell from its meaning.
    ...(profanity === null ? [] : [{ label: t.nuance.english.profanity[profanity], icon: "error" as const }]),
    ...(nuance.cautions.rudeToSuperiors >= 0.6 && !obviouslyRude
      ? [{ label: t.nuance.cautionRude, icon: "work_off" as const }]
      : []),
    ...(nuance.cautions.stiffWithFriends >= 0.6 ? [{ label: t.nuance.cautionStiff, icon: "info" as const }] : []),
    ...(nuance.cautions.slang >= 0.6 ? [{ label: t.nuance.cautionSlang, icon: "info" as const }] : []),
    ...((nuance.cautions.textbook ?? 0) >= 0.6 ? [{ label: t.nuance.cautionTextbook, icon: "info" as const }] : [])
  ]
  return { tags, cautions }
}

/**
 * A sense's dictionary tags, less those its judged nuance already shows, in the card up top or
 * on the sense (アメリカ英語 from en-US, 古語 from arch), so no label is shown twice.
 */
export const dictionaryTags = (t: Strings, sense: Sense) => {
  const judged = new Set(sense.nuance ? nuanceNotes(t, sense.nuance).tags : [])
  return [...sense.misc, ...sense.fields, ...sense.dialects].filter((tag) => !judged.has(tagLabel(t, tag)))
}
