import * as Schema from "effect/Schema"

/** Kotori teaches in both directions: English speakers learning Japanese and Japanese speakers learning English. */
export const Language = Schema.Literals(["en", "ja"])
export type Language = typeof Language.Type

export const otherLanguage = (language: Language): Language => (language === "en" ? "ja" : "en")
