export const normalizeGloss = (text: string) =>
  text
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}' -]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(to|a|an|the) /, "")

const ASIDE = /\([^()]*\)|〈[^〈〉]*〉|《[^《》]*》|〔[^〔〕]*〕|\[[^[\]]*\]/g

export const normalizeJapaneseGloss = (text: string) => {
  let norm = text.normalize("NFKC")
  // Twice to strip two levels of nested brackets.
  norm = norm.replace(ASIDE, "").replace(ASIDE, "")
  return norm
    .replace(/[『』「」【】"]/g, "")
    .replace(/^\s*[~〜…・.]+\s*(?:を|に|が|と|で|の|へ|から|より)?/, "")
    .replace(/[\s。、.,!?！？・;；:：]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
}
