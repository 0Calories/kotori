import type { Language } from "@kotori/contracts"
import { brand, OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH, SITE_URL } from "../i18n/brand.ts"

const escapeAttribute = (value: string) =>
  value.replace(/[&"<>]/g, (ch) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[ch]!)

const escapeText = (value: string) => value.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]!)

export const renderMetaHead = (language: Language): string => {
  const meta = brand[language]
  const imageUrl = `${SITE_URL}${meta.ogImage}`
  const isDedicatedLocalePage = language === "ja"
  return [
    `    <title>${escapeText(meta.title)}</title>`,
    `    <meta name="description" content="${escapeAttribute(meta.description)}" />`,
    `    <meta name="application-name" content="${escapeAttribute(meta.appName)}" />`,
    `    <meta name="apple-mobile-web-app-title" content="${escapeAttribute(meta.appName)}" />`,
    ...(isDedicatedLocalePage ? [`    <link rel="canonical" href="${escapeAttribute(meta.url)}" />`] : []),
    `    <link rel="alternate" hreflang="en" href="${escapeAttribute(brand.en.url)}" />`,
    `    <link rel="alternate" hreflang="ja" href="${escapeAttribute(brand.ja.url)}" />`,
    `    <link rel="alternate" hreflang="x-default" href="${escapeAttribute(brand.en.url)}" />`,
    `    <meta property="og:type" content="website" />`,
    `    <meta property="og:site_name" content="${escapeAttribute(meta.appName)}" />`,
    ...(isDedicatedLocalePage ? [`    <meta property="og:url" content="${escapeAttribute(meta.url)}" />`] : []),
    `    <meta property="og:title" content="${escapeAttribute(meta.title)}" />`,
    `    <meta property="og:description" content="${escapeAttribute(meta.description)}" />`,
    `    <meta property="og:locale" content="${escapeAttribute(meta.ogLocale)}" />`,
    `    <meta property="og:locale:alternate" content="${escapeAttribute(meta.ogAlternateLocale)}" />`,
    `    <meta property="og:image" content="${escapeAttribute(imageUrl)}" />`,
    `    <meta property="og:image:type" content="image/png" />`,
    `    <meta property="og:image:width" content="${OG_IMAGE_WIDTH}" />`,
    `    <meta property="og:image:height" content="${OG_IMAGE_HEIGHT}" />`,
    `    <meta property="og:image:alt" content="${escapeAttribute(meta.ogImageAlt)}" />`,
    `    <meta name="twitter:card" content="summary_large_image" />`,
    `    <meta name="twitter:title" content="${escapeAttribute(meta.title)}" />`,
    `    <meta name="twitter:description" content="${escapeAttribute(meta.description)}" />`,
    `    <meta name="twitter:image" content="${escapeAttribute(imageUrl)}" />`,
    `    <meta name="twitter:image:alt" content="${escapeAttribute(meta.ogImageAlt)}" />`
  ].join("\n")
}

export const applyWebMeta = (html: string, language: Language): string => {
  const meta = brand[language]
  const withoutExistingMeta = html
    .replace(/<html\s+lang="[^"]*"/i, `<html lang="${language}"`)
    .replace(/<title>[\s\S]*?<\/title>\s*/i, "")
    .replace(/<meta\s+name="(?:description|application-name|apple-mobile-web-app-title)"[^>]*>\s*/gi, "")
    .replace(/<meta\s+property="og:[^"]*"[^>]*>\s*/gi, "")
    .replace(/<meta\s+name="twitter:[^"]*"[^>]*>\s*/gi, "")
    .replace(/<link\s+rel="(?:canonical|alternate)"[^>]*>\s*/gi, "")
    .replace(
      /<noscript>[\s\S]*?<\/noscript>/i,
      `<noscript>\n      <div class="kotori-noscript">\n        <div>\n          <h1>${escapeText(meta.noscriptHeading)}</h1>\n          <p>${escapeText(meta.noscriptBody)}</p>\n        </div>\n      </div>\n    </noscript>`
    )

  return withoutExistingMeta.replace(/<\/head>/i, `${renderMetaHead(language)}\n  </head>`)
}
