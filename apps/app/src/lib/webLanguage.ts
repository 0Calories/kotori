import type { Language } from "@kotori/contracts"

export const webLanguageFromLocation = (pathname: string, search: string): Language | null => {
  const clean = pathname.replace(/\/+$/, "") || "/"
  if (clean === "/ja") return "ja"
  const lang = new URLSearchParams(search).get("lang")
  if (lang === "ja" || lang === "en") return lang
  return null
}
