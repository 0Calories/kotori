import { Language } from "@kotori/db"

export { Language }

export const otherLanguage = (language: Language): Language => (language === "en" ? "ja" : "en")
