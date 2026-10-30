import { describe, expect, it } from "vitest"
import { chooseHeadword, parseEntries, parseTags, priorityScore } from "../src/index.ts"

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE JMdict [
<!ENTITY v1 "Ichidan verb">
<!ENTITY vt "transitive verb">
<!ENTITY uk "word usually written using kana alone">
<!ENTITY n "noun (common) (futsuumeishi)">
<!ENTITY iK "word containing irregular kanji usage">
<!ENTITY hon "honorific or respectful (sonkeigo) language">
]>
<JMdict>
<entry>
<ent_seq>1358280</ent_seq>
<k_ele><keb>食べる</keb><ke_pri>ichi1</ke_pri><ke_pri>news1</ke_pri><ke_pri>nf20</ke_pri></k_ele>
<k_ele><keb>喰べる</keb><ke_inf>&iK;</ke_inf></k_ele>
<r_ele><reb>たべる</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&v1;</pos><pos>&vt;</pos><gloss>to eat</gloss></sense>
<sense><gloss>to live on (e.g. a salary)</gloss><gloss g_type="fig">to subsist on</gloss><xref>食う・くう・1</xref></sense>
</entry>
<entry>
<ent_seq>1001720</ent_seq>
<k_ele><keb>御菓子</keb></k_ele>
<k_ele><keb>お菓子</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>おかし</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&n;</pos><misc>&uk;</misc><gloss>confections &amp; sweets</gloss></sense>
</entry>
</JMdict>`

describe("JMDict parser", () => {
  it("reads tag descriptions from the DTD", () => {
    expect(parseTags(xml)).toContainEqual({ code: "hon", label: "honorific or respectful (sonkeigo) language" })
  })

  it("parses forms, senses and priorities", () => {
    const [taberu] = Array.from(parseEntries(xml))
    expect(taberu).toMatchObject({ id: 1358280, headword: "食べる", reading: "たべる", common: true })
    expect(taberu?.priority).toBe(Math.round(40 + 20 + 29 * 1.5))
    expect(taberu?.forms.map((form) => [form.text, form.tags])).toEqual([
      ["食べる", []],
      ["喰べる", ["iK"]],
      ["たべる", []]
    ])
  })

  it("inherits parts of speech from the previous sense", () => {
    const [taberu] = Array.from(parseEntries(xml))
    expect(taberu?.senses[1]?.pos).toEqual(["v1", "vt"])
    expect(taberu?.senses[1]?.glosses).toEqual([
      { text: "to live on (e.g. a salary)", type: null },
      { text: "to subsist on", type: "fig" }
    ])
    expect(taberu?.senses[1]?.xrefs).toEqual(["食う・くう・1"])
  })

  it("prefers kana headwords for words usually written in kana and decodes entities", () => {
    const [, okashi] = Array.from(parseEntries(xml))
    expect(okashi?.headword).toBe("おかし")
    expect(okashi?.senses[0]?.glosses[0]?.text).toBe("confections & sweets")
  })

  it("reads the English words a loan comes from, and whether it is wasei-eigo", () => {
    const loans = `<JMdict>
<entry><ent_seq>1130040</ent_seq><r_ele><reb>マンション</reb></r_ele>
<sense><pos>&n;</pos><lsource xml:lang="eng">mansion</lsource><gloss>condominium</gloss></sense>
<sense><lsource ls_type="part" ls_wasei="y">sub</lsource><lsource xml:lang="fre"/><gloss>sub-leader</gloss></sense>
<sense><lsource ls_wasei="y">salaried man</lsource><gloss>salaryman</gloss></sense>
</entry>
</JMdict>`
    const [mansion] = Array.from(parseEntries(loans))
    expect(mansion?.senses.map((sense) => [sense.sources, sense.wasei])).toEqual([
      [["mansion"], false],
      [[], true],
      [["salaried man"], true]
    ])
    const [taberu] = Array.from(parseEntries(xml))
    expect(taberu?.senses[0]).toMatchObject({ sources: [], wasei: false })
  })

  it("scores newspaper frequency bands", () => {
    expect(priorityScore(["nf01"])).toBeGreaterThan(priorityScore(["nf40"]))
    expect(priorityScore([])).toBe(0)
  })

  it("skips irregular kanji when choosing the headword", () => {
    const { headword } = chooseHeadword(
      [
        { kind: "kanji", text: "喰う", common: false, tags: ["iK"], priorities: [], restrictions: [], noKanji: false },
        { kind: "kanji", text: "食う", common: true, tags: [], priorities: [], restrictions: [], noKanji: false },
        { kind: "kana", text: "くう", common: true, tags: [], priorities: [], restrictions: [], noKanji: false }
      ],
      []
    )
    expect(headword).toBe("食う")
  })
})
