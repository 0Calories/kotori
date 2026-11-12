import { EntryId, type Entry, type EntrySummary, type Label, type Tag } from "@kotori/contracts"
import type { FrequencyTier } from "./frequency.ts"

export type ProtoSearchResult = EntrySummary & { readonly frequencyTier: FrequencyTier }

/**
 * PROTOTYPE DATA: Authentic dictionary entries covering every chip severity (`quiet`, `info`,
 * `warning`, `avoid`), Kotori's Notes (`AI`) provenance, katakana loan chips & wasei-eigo origins,
 * atomic grammar tags (`verb`, `godan`, `transitive`, `usually written in kana`), domain fields
 * (`food`, `business`, `law`), cross-reference chips (`Compare`, `Opposites`), plain snow headers,
 * and search rows.
 */
export type SampleWordKey = "kuu" | "gokurousama" | "manshon" | "advice" | "kangamiru"

const tag = (code: string, name: string): Tag => ({ code, name })
const lbl = (code: Label["code"], severity: Label["severity"], source: Label["source"] = "jmdict"): Label => ({
  code,
  severity,
  source
})

export const SAMPLE_ENTRIES: Record<SampleWordKey, { readonly label: string; readonly entry: Entry }> = {
  kuu: {
    label: "食う (verb + casual)",
    entry: {
      id: EntryId.make(1269130),
      language: "ja",
      source: "jmdict",
      headword: "食う",
      reading: "くう",
      romaji: "kuu",
      common: true,
      usuallyKana: false,
      labels: [lbl("col", "warning", "kotori"), lbl("male", "warning", "jmdict")],
      frequency: { everyday: false, spokenCount: 2840, score: 4 },
      loanLink: null,
      cautions: [
        {
          id: 1,
          kind: "gendered_speech",
          text: "Rough and casual — common among close male friends, blunt or uncouth in polite company.",
          sense: null,
          about: { entryId: EntryId.make(1358280), headword: "食べる", reading: "たべる" },
          source: "kotori"
        }
      ],
      forms: [{ text: "喰う", kind: "kanji", common: false, tags: [] }],
      senses: [
        {
          index: 0,
          glosses: ["to eat", "to have a meal"],
          partsOfSpeech: [tag("v5u", "Godan verb"), tag("vt", "transitive verb")],
          fields: [tag("food", "food, cooking")],
          info: [],
          appliesTo: [],
          related: [],
          antonyms: [],
          origins: [],
          labels: [],
          usagePatterns: [
            {
              text: "Everyday rough counterpart to 食べる; fine in set idioms regardless of speaker.",
              source: "kotori",
              about: { entryId: EntryId.make(1358280), headword: "食べる", reading: "たべる" }
            }
          ],
          examples: [
            {
              id: 101,
              ja: "もう飯食った？",
              furigana: "もう{飯|めし}{食|く}った？",
              en: "Did you eat yet?",
              formality: "casual",
              note: "Close friends only.",
              noteJa: null,
              source: "kotori",
              audioUrl: null,
              translationAudioUrl: null
            }
          ],
          similarWords: []
        },
        {
          index: 1,
          glosses: ["to make a living", "to get by", "to subsist"],
          partsOfSpeech: [tag("v5u", "Godan verb"), tag("vi", "intransitive verb")],
          fields: [],
          info: [],
          appliesTo: [],
          related: [],
          antonyms: [{ text: "飢える", entryId: EntryId.make(1219490) }],
          origins: [],
          labels: [lbl("id", "quiet", "jmdict"), lbl("hon", "info", "kotori")],
          usagePatterns: [{ text: "usu. as 食っていく", source: "jmdict", about: null }],
          examples: [],
          similarWords: []
        },
        {
          index: 2,
          glosses: ["to dupe", "to make a fool of", "to toy with"],
          partsOfSpeech: [tag("vt", "transitive verb")],
          fields: [],
          info: [],
          appliesTo: [],
          related: [],
          antonyms: [],
          origins: [],
          labels: [lbl("id", "quiet", "jmdict"), lbl("derog", "avoid", "jmdict"), lbl("vulg", "avoid", "kotori")],
          usagePatterns: [{ text: "人を食った態度 — brazen, insolent attitude", source: "kotori", about: null }],
          examples: [],
          similarWords: []
        }
      ],
      audioUrl: null,
      audio: [],
      enrichment: { examples: "ready", audio: "ready" }
    }
  },
  gokurousama: {
    label: "ご苦労様 (polite + caution)",
    entry: {
      id: EntryId.make(1270610),
      language: "ja",
      source: "jmdict",
      headword: "ご苦労様",
      reading: "ごくろうさま",
      romaji: "gokurousama",
      common: false,
      usuallyKana: false,
      labels: [lbl("pol", "info", "jmdict"), lbl("sens", "warning", "kotori")],
      frequency: { everyday: false, spokenCount: 410, score: 3 },
      loanLink: null,
      cautions: [
        {
          id: 2,
          kind: "rude_upward",
          text: "Sounds patronising when said to a boss, client, or senior colleague — say お疲れ様です instead.",
          sense: null,
          about: { entryId: EntryId.make(2134110), headword: "お疲れ様", reading: "おつかれさま" },
          source: "kotori"
        }
      ],
      forms: [{ text: "御苦労様", kind: "kanji", common: false, tags: [] }],
      senses: [
        {
          index: 0,
          glosses: ["thank you for your hard work", "I appreciate your efforts"],
          partsOfSpeech: [tag("exp", "expression"), tag("n", "noun")],
          fields: [],
          info: [],
          appliesTo: [],
          related: [],
          antonyms: [],
          origins: [],
          labels: [lbl("dated", "warning", "kotori"), lbl("hum", "info", "jmdict")],
          usagePatterns: [
            { text: "usu. to one's subordinate or delivery staff", source: "jmdict", about: null },
            {
              text: "Safe toward delivery drivers or younger staff, avoided upward in workplaces.",
              source: "kotori",
              about: { entryId: EntryId.make(2134110), headword: "お疲れ様", reading: "おつかれさま" }
            }
          ],
          examples: [
            {
              id: 201,
              ja: "雨の中、配達ご苦労様です。",
              furigana: "{雨|あめ}の{中|なか}、{配達|はいたつ}ご{苦労様|くろうさま}です。",
              en: "Thanks for making the delivery in the rain.",
              formality: "polite",
              note: null,
              noteJa: null,
              source: "kotori",
              audioUrl: null,
              translationAudioUrl: null
            }
          ],
          similarWords: []
        }
      ],
      audioUrl: null,
      audio: [],
      enrichment: { examples: "ready", audio: "ready" }
    }
  },
  manshon: {
    label: "マンション (loan + kana)",
    entry: {
      id: EntryId.make(1129610),
      language: "ja",
      source: "jmdict",
      headword: "マンション",
      reading: "マンション",
      romaji: "manshon",
      common: true,
      usuallyKana: true,
      labels: [lbl("col", "warning", "kotori")],
      frequency: { everyday: true, spokenCount: 3120, score: 5 },
      loanLink: {
        katakana: "マンション",
        katakanaEntryId: EntryId.make(1129610),
        english: "mansion",
        englishEntryId: EntryId.make(100004910),
        meaning: "wasei_eigo",
        source: "jmdict",
        meaningSource: "kotori"
      },
      cautions: [
        {
          id: 4,
          kind: "wasei_eigo",
          text: "Means a modern concrete apartment or condo building — not a palatial English “mansion” (豪邸).",
          sense: null,
          about: null,
          source: "kotori"
        }
      ],
      forms: [],
      senses: [
        {
          index: 0,
          glosses: ["apartment building", "condominium", "flat"],
          partsOfSpeech: [tag("n", "noun")],
          fields: [],
          info: [],
          appliesTo: [],
          related: [],
          antonyms: [],
          origins: [],
          labels: [],
          usagePatterns: [
            {
              text: "Contrasts with アパート, which usually means a smaller two-storey wooden or light-steel building.",
              source: "kotori",
              about: null
            }
          ],
          examples: [
            {
              id: 401,
              ja: "駅前のマンションに引っ越した。",
              furigana: "{駅前|えきまえ}のマンションに{引|ひ}っ{越|こ}した。",
              en: "I moved into an apartment building in front of the station.",
              formality: "neutral",
              note: null,
              noteJa: null,
              source: "kotori",
              audioUrl: null,
              translationAudioUrl: null
            }
          ],
          similarWords: []
        }
      ],
      audioUrl: null,
      audio: [],
      enrichment: { examples: "ready", audio: "ready" }
    }
  },
  advice: {
    label: "advice (English + loan)",
    entry: {
      id: EntryId.make(100000013),
      language: "en",
      source: "enwiktionary",
      headword: "advice",
      reading: "/ədˈvaɪs/",
      romaji: "",
      common: true,
      usuallyKana: false,
      labels: [lbl("uncountable", "quiet", "enwiktionary"), lbl("en-GB", "info", "enwiktionary")],
      frequency: { everyday: true, spokenCount: 9200, score: 5 },
      loanLink: {
        katakana: "アドバイス",
        katakanaEntryId: EntryId.make(1016440),
        english: "advice",
        englishEntryId: EntryId.make(100000013),
        meaning: "true_loanword",
        source: "jmdict",
        meaningSource: "kotori"
      },
      cautions: [
        {
          id: 3,
          kind: "collocation",
          text: "Uncountable in English — say “some advice” or “a piece of advice”, never “an advice”.",
          sense: 0,
          about: null,
          source: "kotori"
        }
      ],
      forms: [],
      senses: [
        {
          index: 0,
          glosses: ["助言", "アドバイス", "忠告"],
          partsOfSpeech: [tag("n", "noun")],
          fields: [],
          info: [],
          appliesTo: [],
          related: [],
          antonyms: [],
          origins: [],
          labels: [lbl("col", "warning", "kotori")],
          usagePatterns: [
            {
              text: "Often paired with give, ask for, or take.",
              source: "kotori",
              about: null
            }
          ],
          examples: [
            {
              id: 301,
              ja: "ちょっといいアドバイスをもらえますか？",
              furigana: "ちょっといいアドバイスをもらえますか？",
              en: "Could you give me a quick piece of advice?",
              formality: "polite",
              note: null,
              noteJa: "「一つ」と言いたいときは a piece of を添えます。",
              source: "kotori",
              audioUrl: null,
              translationAudioUrl: null
            }
          ],
          similarWords: []
        },
        {
          index: 1,
          glosses: ["通知", "案内状"],
          partsOfSpeech: [tag("n", "noun")],
          fields: [tag("bus", "business")],
          info: [],
          appliesTo: [],
          related: [],
          antonyms: [],
          origins: [],
          labels: [lbl("form", "info", "enwiktionary"), lbl("rare", "warning", "kotori")],
          usagePatterns: [{ text: "payment advice / remittance advice", source: "enwiktionary", about: null }],
          examples: [],
          similarWords: []
        }
      ],
      audioUrl: null,
      audio: [],
      enrichment: { examples: "ready", audio: "ready" }
    }
  },
  kangamiru: {
    label: "鑑みる (plain snow header)",
    entry: {
      id: EntryId.make(1573640),
      language: "ja",
      source: "jmdict",
      headword: "鑑みる",
      reading: "かんがみる",
      romaji: "kangamiru",
      common: false,
      usuallyKana: false,
      labels: [lbl("form", "info", "jmdict"), lbl("arch", "avoid", "jmdict")],
      frequency: { everyday: false, spokenCount: 12, score: 2 },
      loanLink: null,
      cautions: [],
      forms: [{ text: "鑒みる", kind: "kanji", common: false, tags: [] }],
      senses: [
        {
          index: 0,
          glosses: ["to take into consideration", "to bear in mind (a precedent)"],
          partsOfSpeech: [tag("v1", "Ichidan verb"), tag("vt", "transitive verb")],
          fields: [tag("law", "law")],
          info: [],
          appliesTo: [],
          related: [],
          antonyms: [],
          origins: [],
          labels: [lbl("dated", "warning", "jmdict")],
          usagePatterns: [{ text: "usu. 〜に鑑みて in official statements", source: "jmdict", about: null }],
          examples: [],
          similarWords: []
        }
      ],
      audioUrl: null,
      audio: [],
      enrichment: { examples: "unavailable", audio: "unavailable" }
    }
  }
}

export const SAMPLE_SEARCH_RESULTS: ReadonlyArray<ProtoSearchResult> = [
  {
    id: EntryId.make(1358280),
    language: "ja",
    headword: "食べる",
    reading: "たべる",
    romaji: "taberu",
    common: true,
    frequencyTier: "everyday",
    meanings: ["to eat", "to have a meal"],
    partOfSpeech: "v1",
    labels: [],
    inflection: [],
    audioUrl: null
  },
  {
    id: EntryId.make(1269130),
    language: "ja",
    headword: "食う",
    reading: "くう",
    romaji: "kuu",
    common: true,
    frequencyTier: "common",
    meanings: ["to eat", "to make a living"],
    partOfSpeech: "v5u",
    labels: [lbl("col", "warning", "kotori"), lbl("male", "warning", "jmdict")],
    inflection: ["past"],
    audioUrl: null
  },
  {
    id: EntryId.make(1594790),
    language: "ja",
    headword: "召し上がる",
    reading: "めしあがる",
    romaji: "meshiagaru",
    common: true,
    frequencyTier: "common",
    meanings: ["to eat", "to drink"],
    partOfSpeech: "v5r",
    labels: [lbl("hon", "info", "jmdict")],
    inflection: [],
    audioUrl: null
  },
  {
    id: EntryId.make(1482040),
    language: "ja",
    headword: "晩餐",
    reading: "ばんさん",
    romaji: "bansan",
    common: false,
    frequencyTier: "uncommon",
    meanings: ["dinner", "evening banquet"],
    partOfSpeech: "n",
    labels: [lbl("form", "info", "jmdict")],
    inflection: [],
    audioUrl: null
  },
  {
    id: EntryId.make(1007200),
    language: "ja",
    headword: "てめえ",
    reading: "てめえ",
    romaji: "temee",
    common: false,
    frequencyTier: "rare",
    meanings: ["you (hostile)"],
    partOfSpeech: "pn",
    labels: [lbl("vulg", "avoid", "jmdict"), lbl("male", "warning", "jmdict")],
    inflection: [],
    audioUrl: null
  }
]
