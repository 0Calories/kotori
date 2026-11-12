import type { Language } from "@kotori/contracts"

/**
 * What Claude is told about cautions, wherever it writes them: in Ask Kotori drafts
 * (`Lexicographer`) and in the offline pass over dictionary words (`CautionWriter`). One wording,
 * so a draft and a dictionary word are held to the same rules. The kinds are `CAUTION_KINDS` in
 * `@kotori/db`; the caller drops any other.
 */

// `tone` is for a word's weight, not its politeness: asked with "how heavy or light it lands"
// alone, Claude filed 食う's roughness and every slang word's "sounds try-hard from older people"
// under it (`kotori eval cautions`, `kotori eval drafts`).
const TONE =
  "tone (a playful, mock or ironic use, or a feeling much lighter or heavier than the gloss suggests, that no label conveys; never politeness or roughness, and never how strong a vulgar, derogatory or slang word is)"

/** The kinds a caution on a word of each language can be, with what each means. */
export const CAUTION_GUIDE: Readonly<Record<Language, string>> = {
  ja: `rude_upward (sounds rude, rough or too casual to a superior or in polite company), keigo_direction (respectful vs humble, said of whom), set_phrase (a fixed phrase with a fixed use), particle_pattern (the particle it takes), gendered_speech, confusable (a word it is easily mixed up with), collocation (what it goes with), ${TONE}`,
  en: `wasei_eigo (a katakana loan that means something else in English), textbook_english (correct but stiff or dated as taught), directness (how blunt or soft it lands), variety (differs between US, UK and other English), confusable, collocation, ${TONE}`
}

/**
 * The register labels' meanings as the learner reads them on the page, so a caution never says
 * them again. Only those a caution is tempted to repeat.
 */
export const LABELS_SAY =
  "col, sl and net-sl already tell the learner the word is casual or slang and out of place with elders, superiors or in formal settings; vulg that it offends; derog that it belittles; male and fem who mostly says it; hon that it raises someone else's action and is never said of yourself; hum that it lowers your own; pol that it fits strangers and superiors; form that it is formal written wording, stiff in conversation; dated and arch that it sounds old"

/**
 * What Claude wrote as cautions that a label already carries or that is no pitfall at all, found by the
 * golden evals: each line was a needless caution on a word the golden set says needs none.
 */
export const NOT_CAUTIONS = [
  "anything about a vulgar, X-rated or derogatory word's strength, its other uses or the set phrases it appears in, or a milder word to say instead: its label already says it",
  "a usage fact that wouldn't lead a learner into an actual mistake, however interesting: a caution names the pitfall a learner would hit",
  "that a slang or young people's word sounds odd, try-hard or ironic from older speakers, or is out of place in formal settings: its label says so",
  "the word's keigo counterparts (召し上がる and いただく for 食べる): they are the keigo word's caution, not the plain word's",
  "another word spelled or written the same, or how a kanji is read in a different word",
  "anything the glosses or the dictionary's notes already say"
]
  .map((line) => `- ${line}`)
  .join("\n")
