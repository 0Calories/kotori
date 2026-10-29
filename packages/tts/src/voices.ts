import type { Formality, Language } from "@kotori/domain"

/**
 * Trait tags describing how a curated voice sounds. Gender, age and variety are
 * single-valued; the rest are sets. Selection works on tags (see `casting.ts`),
 * so adding or recasting a voice is a data change, never a code change.
 */
export const VOICE_GENDERS = ["masculine", "feminine", "androgynous"] as const
export const VOICE_AGES = ["child", "youth", "adult", "middle-aged", "older"] as const
export const VOICE_MEDIUMS = ["conversation", "announcement", "narration"] as const
/** Scoring reads only "comic", for humorous sentences; the rest is stored for later voice-settings work. */
export const VOICE_TONES = ["warm", "bright", "calm", "serious", "rough", "gentle", "comic"] as const

/**
 * Regional variety of the language, in the linguist's sense: it covers both
 * Japanese dialects (Kansai-ben differs in grammar and vocabulary) and national
 * varieties of English (mostly accent and spelling). Each language has its own
 * list and its own default, the variety an unlabelled sentence is read in.
 */
export const VARIETIES = {
  ja: ["standard", "kansai", "tohoku", "kyushu"],
  en: ["american", "british", "australian"]
} as const satisfies Record<Language, ReadonlyArray<string>>

export const DEFAULT_VARIETY = { ja: "standard", en: "american" } as const satisfies {
  [L in Language]: Variety<L>
}

export type Variety<L extends Language = Language> = (typeof VARIETIES)[L][number]
export type VoiceGender = (typeof VOICE_GENDERS)[number]
export type VoiceAge = (typeof VOICE_AGES)[number]
export type VoiceMedium = (typeof VOICE_MEDIUMS)[number]
export type VoiceTone = (typeof VOICE_TONES)[number]

export interface VoiceTags<L extends Language = Language> {
  readonly gender: VoiceGender
  readonly age: VoiceAge
  readonly variety: Variety<L>
  /** Registers this voice sounds right in. */
  readonly formality: ReadonlyArray<Formality>
  readonly medium: ReadonlyArray<VoiceMedium>
  readonly tone: ReadonlyArray<VoiceTone>
  /** Eligible as a dictionary voice for headword pronunciations. */
  readonly headword: boolean
}

export interface Voice<L extends Language = Language> {
  /** Stable Kotori id, e.g. "ja-kyoko". Stored on clips; survives recasting the provider voice. */
  readonly id: string
  readonly language: L
  /** ElevenLabs voice id; null while the role is designed but not yet cast. */
  readonly providerId: string | null
  readonly name: string
  readonly tags: VoiceTags<L>
  /** One line for Jev and for humans: how this voice sounds and when to use it. */
  readonly description: string
}

/**
 * The curated casts, one per language. Provider ids are filled in by auditioning
 * the ElevenLabs library (`kotori audio regen --provider-voice`); the tags are
 * the contract.
 */
export const JAPANESE_CAST: ReadonlyArray<Voice<"ja">> = [
  {
    id: "ja-kyoko",
    language: "ja",
    providerId: "4lOQ7A2l7HPuG7UIHiKA",
    name: "Kyoko",
    tags: {
      gender: "feminine",
      age: "adult",
      variety: "standard",
      formality: ["neutral", "polite"],
      medium: ["conversation", "narration"],
      tone: ["warm"],
      headword: true
    },
    description: "A warm adult woman with clear Tokyo-standard Japanese; everyday neutral and polite speech."
  },
  {
    id: "ja-announcer",
    language: "ja",
    providerId: "3JDquces8E8bkmvbh6Bc", // Otani
    name: "Announcer",
    tags: {
      gender: "masculine",
      age: "middle-aged",
      variety: "standard",
      formality: ["polite", "formal"],
      medium: ["announcement", "narration"],
      tone: ["serious"],
      headword: true
    },
    description: "A measured middle-aged male announcer; news, public notices and business mail read aloud."
  },
  {
    id: "ja-polite-f",
    language: "ja",
    providerId: "qbfQuoRJv1T3ei3qV4bc", // Kazuha
    name: "Polite woman",
    tags: {
      gender: "feminine",
      age: "adult",
      variety: "standard",
      formality: ["polite", "formal"],
      medium: ["conversation"],
      tone: ["gentle"],
      headword: false
    },
    description: "A gentle adult woman speaking courteous teineigo; service counters and polite conversation."
  },
  {
    id: "ja-casual-f",
    language: "ja",
    providerId: "DpPUi15aFdxHd3pJG2EF", // Miki
    name: "Casual young woman",
    tags: {
      gender: "feminine",
      age: "youth",
      variety: "standard",
      formality: ["vulgar", "casual", "neutral"],
      medium: ["conversation"],
      tone: ["bright"],
      headword: false
    },
    description: "A bright young woman chatting with friends; relaxed, slangy, feminine speech."
  },
  {
    id: "ja-casual-m",
    language: "ja",
    providerId: "8zFFBbtAT2eoznLuzUMT", // Ryu
    name: "Casual man",
    tags: {
      gender: "masculine",
      age: "adult",
      variety: "standard",
      formality: ["casual", "neutral"],
      medium: ["conversation"],
      tone: ["calm"],
      headword: false
    },
    description: "A calm adult man in everyday conversation; relaxed, friendly masculine speech."
  },
  {
    id: "ja-casual-m2",
    language: "ja",
    providerId: "TlxVR97quVHvTxE8Qkcm", // Samurai
    name: "Casual young man",
    tags: {
      gender: "masculine",
      age: "youth",
      variety: "standard",
      formality: ["vulgar", "casual", "neutral"],
      medium: ["conversation"],
      tone: ["calm"],
      headword: false
    },
    description: "A young man talking with friends; relaxed, slangy masculine speech (ぜ, ぞ, おれ)."
  },
  {
    id: "ja-casual-f2",
    language: "ja",
    providerId: "a0MsDWokG5Xsuji8g8er", // Haru
    name: "Casual woman",
    tags: {
      gender: "feminine",
      age: "middle-aged",
      variety: "standard",
      formality: ["casual", "neutral"],
      medium: ["conversation"],
      tone: ["warm"],
      headword: false
    },
    description: "A warm middle-aged woman speaking casually; relaxed but not youthful."
  },
  {
    id: "ja-kansai-m",
    language: "ja",
    providerId: "OixLI492Bx532sSKQRim", // Goro, a native Osaka speaker
    name: "Kansai man",
    tags: {
      gender: "masculine",
      age: "adult",
      variety: "kansai",
      formality: ["casual", "neutral", "polite"],
      medium: ["conversation"],
      tone: ["bright", "comic"],
      headword: false
    },
    description:
      "A funny adult man speaking natural Kansai-ben; for sentences in the Kansai dialect and for jokes and comic lines."
  },
  {
    id: "ja-elder-m",
    language: "ja",
    providerId: null,
    name: "Elder narrator",
    tags: {
      gender: "masculine",
      age: "older",
      variety: "standard",
      formality: ["neutral", "polite", "formal"],
      medium: ["narration"],
      tone: ["calm"],
      headword: true
    },
    description: "A calm older man with a literary delivery; proverbs, archaic and dated words, prose."
  }
]

export const ENGLISH_CAST: ReadonlyArray<Voice<"en">> = [
  {
    id: "en-sarah",
    language: "en",
    providerId: "EXAVITQu4vr4xnSDxMaL",
    name: "Sarah",
    tags: {
      gender: "feminine",
      age: "adult",
      variety: "american",
      formality: ["neutral", "polite"],
      medium: ["conversation", "narration"],
      tone: ["warm"],
      headword: true
    },
    description: "A warm adult woman with clear American English; everyday neutral and polite speech."
  },
  {
    id: "en-announcer",
    language: "en",
    providerId: "9ZbFvrGBxO3uSmsw6wdI", // Walter, news anchor
    name: "Announcer",
    tags: {
      gender: "masculine",
      age: "middle-aged",
      variety: "american",
      formality: ["polite", "formal"],
      medium: ["announcement", "narration"],
      tone: ["serious"],
      headword: true
    },
    description: "A measured middle-aged male announcer; news reports, notices and formal writing read aloud."
  },
  {
    id: "en-casual-f",
    language: "en",
    providerId: "cgSgspJ2msm6clMCkdW9", // Jessica
    name: "Casual young woman",
    tags: {
      gender: "feminine",
      age: "youth",
      variety: "american",
      formality: ["vulgar", "casual", "neutral"],
      medium: ["conversation"],
      tone: ["bright"],
      headword: false
    },
    description: "A bright young American woman chatting with friends; relaxed, slangy speech."
  },
  {
    id: "en-casual-m",
    language: "en",
    providerId: "bIHbv24MWmeRgasZH58o", // Will
    name: "Casual young man",
    tags: {
      gender: "masculine",
      age: "youth",
      variety: "american",
      formality: ["vulgar", "casual", "neutral"],
      medium: ["conversation"],
      tone: ["rough"],
      headword: false
    },
    description: "An easygoing young American man talking with friends; relaxed, slangy speech."
  },
  {
    id: "en-british-m",
    language: "en",
    providerId: "JBFqnCBsd6RMkjVDRZzb", // George
    name: "British narrator",
    tags: {
      gender: "masculine",
      age: "adult",
      variety: "british",
      formality: ["neutral", "polite", "formal"],
      medium: ["conversation", "narration"],
      tone: ["calm"],
      headword: true
    },
    description: "A calm adult British man; for British-English sentences and measured narration."
  },
  {
    id: "en-elder-f",
    language: "en",
    providerId: "wGcFBfKz5yUQqhqr0mVy", // Maria Moody
    name: "Elder narrator",
    tags: {
      gender: "feminine",
      age: "older",
      variety: "american",
      formality: ["neutral", "polite"],
      medium: ["narration"],
      tone: ["gentle"],
      headword: false
    },
    description: "A gentle older American woman with a storytelling delivery; prose and proverbs."
  }
]

export type Casts = { readonly [L in Language]: ReadonlyArray<Voice<L>> }

export const CASTS: Casts = { ja: JAPANESE_CAST, en: ENGLISH_CAST }

/** The voices of one language that are actually cast (have a provider voice). */
export const castVoices = <L extends Language>(language: L, casts: Casts = CASTS): ReadonlyArray<Voice<L>> =>
  casts[language].filter((voice) => voice.providerId !== null)

/** Dictionary voices for headword pronunciations, in cast order. */
export const headwordVoices = <L extends Language>(language: L, casts: Casts = CASTS): ReadonlyArray<Voice<L>> =>
  castVoices(language, casts).filter((voice) => voice.tags.headword)
