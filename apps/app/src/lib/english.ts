/** A JMDict gloss as it should be read aloud: "(to be) awkward" → "awkward". */
export const spokenGloss = (gloss: string) => {
  const spoken = gloss
    .replace(/\([^()]*\)/g, " ")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  // A gloss that is all parentheses is read as written.
  return spoken === "" ? gloss.replace(/[()]/g, "").trim() : spoken
}
