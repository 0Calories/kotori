import type { Formality, Language } from "@kotori/domain"

/**
 * Trait tags describing how a curated voice sounds. Gender, age and dialect are
 * single-valued; the rest are sets. Selection works on tags (see `casting.ts`),
 * so adding or recasting a voice is a data change, never a code change.
 */
export const VOICE_GENDERS = ["masculine", "feminine", "androgynous"] as const
export const VOICE_AGES = ["child", "youth", "adult", "middle-aged", "older"] as const
/** Japanese and English regional varieties share one dimension. */
export const VOICE_DIALECTS = ["standard", "kansai", "tohoku", "kyushu", "american", "british", "australian"] as const
export const VOICE_MEDIUMS = ["conversation", "announcement", "narration"] as const
/** Stored for later voice-settings work; scoring ignores tone for now. */
export const VOICE_TONES = ["warm", "bright", "calm", "serious", "rough", "gentle"] as const

export type VoiceGender = (typeof VOICE_GENDERS)[number]
export type VoiceAge = (typeof VOICE_AGES)[number]
export type VoiceDialect = (typeof VOICE_DIALECTS)[number]
export type VoiceMedium = (typeof VOICE_MEDIUMS)[number]
export type VoiceTone = (typeof VOICE_TONES)[number]

export interface VoiceTags {
  readonly gender: VoiceGender
  readonly age: VoiceAge
  readonly dialect: VoiceDialect
  /** Registers this voice sounds right in. */
  readonly formality: ReadonlyArray<Formality>
  readonly medium: ReadonlyArray<VoiceMedium>
  readonly tone: ReadonlyArray<VoiceTone>
  /** Eligible as a dictionary voice for headword pronunciations. */
  readonly headword: boolean
}

export interface Voice {
  /** Stable Kotori id, e.g. "ja-kyoko". Stored on clips; survives recasting the provider voice. */
  readonly id: string
  readonly language: Language
  /** ElevenLabs voice id; null while the role is designed but not yet cast. */
  readonly providerId: string | null
  readonly name: string
  readonly tags: VoiceTags
  /** One line for Jev and for humans: how this voice sounds and when to use it. */
  readonly description: string
}

/**
 * The curated cast. Provider ids are filled in by auditioning the ElevenLabs
 * library (`kotori audio regen --provider-voice`); the tags are the contract.
 */
export const CAST: ReadonlyArray<Voice> = [
  {
    id: "ja-kyoko",
    language: "ja",
    providerId: "4lOQ7A2l7HPuG7UIHiKA",
    name: "Kyoko",
    tags: {
      gender: "feminine",
      age: "adult",
      dialect: "standard",
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
    providerId: null,
    name: "Announcer",
    tags: {
      gender: "masculine",
      age: "middle-aged",
      dialect: "standard",
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
    providerId: null,
    name: "Polite woman",
    tags: {
      gender: "feminine",
      age: "adult",
      dialect: "standard",
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
    providerId: null,
    name: "Casual young woman",
    tags: {
      gender: "feminine",
      age: "youth",
      dialect: "standard",
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
    providerId: null,
    name: "Casual young man",
    tags: {
      gender: "masculine",
      age: "youth",
      dialect: "standard",
      formality: ["vulgar", "casual", "neutral"],
      medium: ["conversation"],
      tone: ["rough"],
      headword: false
    },
    description: "An energetic young man talking with friends; rough masculine speech (ぜ, ぞ, おれ)."
  },
  {
    id: "ja-casual-f2",
    language: "ja",
    providerId: null,
    name: "Casual woman",
    tags: {
      gender: "feminine",
      age: "middle-aged",
      dialect: "standard",
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
    providerId: null,
    name: "Kansai man",
    tags: {
      gender: "masculine",
      age: "adult",
      dialect: "kansai",
      formality: ["casual", "neutral", "polite"],
      medium: ["conversation"],
      tone: ["bright"],
      headword: false
    },
    description: "An adult man speaking natural Kansai-ben; for sentences written in the Kansai dialect."
  },
  {
    id: "ja-elder-m",
    language: "ja",
    providerId: null,
    name: "Elder narrator",
    tags: {
      gender: "masculine",
      age: "older",
      dialect: "standard",
      formality: ["neutral", "polite", "formal"],
      medium: ["narration"],
      tone: ["calm"],
      headword: true
    },
    description: "A calm older man with a literary delivery; proverbs, archaic and dated words, prose."
  },
  {
    id: "en-sarah",
    language: "en",
    providerId: "EXAVITQu4vr4xnSDxMaL",
    name: "Sarah",
    tags: {
      gender: "feminine",
      age: "adult",
      dialect: "american",
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
    providerId: null,
    name: "Announcer",
    tags: {
      gender: "masculine",
      age: "middle-aged",
      dialect: "american",
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
    providerId: null,
    name: "Casual young woman",
    tags: {
      gender: "feminine",
      age: "youth",
      dialect: "american",
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
    providerId: null,
    name: "Casual young man",
    tags: {
      gender: "masculine",
      age: "youth",
      dialect: "american",
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
    providerId: null,
    name: "British narrator",
    tags: {
      gender: "masculine",
      age: "adult",
      dialect: "british",
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
    providerId: null,
    name: "Elder narrator",
    tags: {
      gender: "feminine",
      age: "older",
      dialect: "american",
      formality: ["neutral", "polite"],
      medium: ["narration"],
      tone: ["gentle"],
      headword: false
    },
    description: "A gentle older American woman with a storytelling delivery; prose and proverbs."
  }
]

/** The voices of one language that are actually cast (have a provider voice). */
export const castVoices = (language: Language, cast: ReadonlyArray<Voice> = CAST): ReadonlyArray<Voice> =>
  cast.filter((voice) => voice.language === language && voice.providerId !== null)

/** Dictionary voices for headword pronunciations, in cast order. */
export const headwordVoices = (language: Language, cast: ReadonlyArray<Voice> = CAST): ReadonlyArray<Voice> =>
  castVoices(language, cast).filter((voice) => voice.tags.headword)
