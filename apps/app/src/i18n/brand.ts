import type { Language } from "@kotori/contracts"

export const SITE_URL = "https://hellokotori.com"

export interface BrandMeta {
  readonly appName: string
  readonly title: string
  readonly tagline: string
  readonly description: string
  readonly url: string
  readonly ogImage: string
  readonly ogImageAlt: string
  readonly ogLocale: string
  readonly ogAlternateLocale: string
  readonly noscriptHeading: string
  readonly noscriptBody: string
}

export const brand: Record<Language, BrandMeta> = {
  en: {
    appName: "Kotori",
    title: "Kotori — Real-world Japanese & English",
    tagline: "Your companion for real-world Japanese and English.",
    description:
      "Understand how Japanese and English are really used — with a usage-first dictionary, Ask Kotori for tricky expressions, and a notebook that helps words stick.",
    url: `${SITE_URL}/`,
    ogImage: "/og-image.png",
    ogImageAlt: "Kotori — your companion for real-world Japanese and English, with its shima-enaga mascot",
    ogLocale: "en_US",
    ogAlternateLocale: "ja_JP",
    noscriptHeading: "Kotori",
    noscriptBody: "Please enable JavaScript to use Kotori."
  },
  ja: {
    appName: "ことり",
    title: "ことり (Kotori) — リアルな英語・日本語のための辞書と相棒",
    tagline: "リアルな英語と日本語を身につけるための、ことばの相棒。",
    description:
      "リアルな使い方がわかる日英・英日辞書、気になる表現を聞ける「ことりに聞く」、定着させる復習ノートをひとつに。",
    url: `${SITE_URL}/ja`,
    ogImage: "/og-image-ja.png",
    ogImageAlt: "ことり — リアルな英語と日本語を身につけるための、ことばの相棒（シマエナガのマスコット付き）",
    ogLocale: "ja_JP",
    ogAlternateLocale: "en_US",
    noscriptHeading: "ことり",
    noscriptBody: "ことりを利用するには JavaScript を有効にしてください。"
  }
}

export const OG_IMAGE_WIDTH = 1200
export const OG_IMAGE_HEIGHT = 630
