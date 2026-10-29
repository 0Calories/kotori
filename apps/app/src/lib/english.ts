/** A JMDict gloss as it should be read aloud: "(to be) awkward" → "awkward". */
export const spokenGloss = (gloss: string) =>
  gloss
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
