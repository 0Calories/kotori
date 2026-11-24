import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { assert, describe, it } from "vitest"
import { formatDocumentTitle, syncWebLanguage, syncWebTheme } from "../src/lib/webChrome.ts"

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..")
const repoDir = join(appDir, "..", "..")
const publicDir = join(appDir, "public")

interface ManifestIcon {
  readonly src: string
  readonly sizes: string
  readonly type: string
  readonly purpose?: string
}

interface WebManifest {
  readonly name: string
  readonly short_name: string
  readonly description: string
  readonly start_url: string
  readonly display: string
  readonly theme_color: string
  readonly background_color: string
  readonly icons: ReadonlyArray<ManifestIcon>
}

interface VercelConfig {
  readonly trailingSlash?: boolean
  readonly headers?: ReadonlyArray<{
    readonly source: string
    readonly headers: ReadonlyArray<{ readonly key: string; readonly value: string }>
  }>
  readonly rewrites?: ReadonlyArray<{ readonly source: string; readonly destination: string }>
}

describe("web metadata and production assets", () => {
  it("ships complete public HTML metadata without conflicting canonicals or Expo-duplicated tags", () => {
    const html = readFileSync(join(publicDir, "index.html"), "utf8")

    assert.include(html, 'lang="%LANG_ISO_CODE%"')
    assert.include(html, "<title>%WEB_TITLE%</title>")
    assert.include(html, "viewport-fit=cover")
    assert.notMatch(html, /user-scalable=no|maximum-scale=1/)

    // SPA shell serves /, /privacy, and /terms — avoid hardcoded root canonical/og:url that contradict sitemap.xml.
    assert.notMatch(html, /rel="canonical"/)
    assert.notMatch(html, /property="og:url"/)

    // favicon.ico precedes favicon.svg so modern browsers prefer the vector icon.
    const icoIdx = html.indexOf('href="/favicon.ico"')
    const svgIdx = html.indexOf('href="/favicon.svg"')
    assert.isAbove(icoIdx, -1)
    assert.isAbove(svgIdx, icoIdx)

    assert.include(html, 'rel="manifest" href="/site.webmanifest"')
    assert.include(html, 'rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"')
    assert.include(html, 'property="og:image" content="https://hellokotori.com/og-image.png"')
    assert.include(html, 'name="twitter:card" content="summary_large_image"')
    assert.include(html, 'name="twitter:image" content="https://hellokotori.com/og-image.png"')

    // Expo CLI injects theme-color and description from app.json.
    assert.notMatch(html, /name="theme-color"/)
    assert.notMatch(html, /name="description"/)

    // Every local asset referenced in index.html exists in apps/app/public.
    for (const match of html.matchAll(
      /(?:href|content)="((?:https:\/\/hellokotori\.com)?\/[^"]+\.(?:ico|svg|png|webmanifest))"/g
    )) {
      const url = match[1]!
      const filePath = url.replace(/^https:\/\/hellokotori\.com/, "").replace(/^\//, "")
      assert.isTrue(existsSync(join(publicDir, filePath)), `missing public asset: ${filePath}`)
    }

    // OG thumbnails must contain rendered text (textless fallback is ~31 KB; full card with Gabarito + Murecho is >50 KB).
    assert.isAbove(statSync(join(publicDir, "og-image.png")).size, 45_000)
    assert.isAbove(statSync(join(publicDir, "og-image-ja.png")).size, 45_000)
  })

  it("uses GLOSSARY.md terminology ('usage', never 'nuance') across web metadata", () => {
    for (const file of [
      join(appDir, "app.json"),
      join(appDir, "src/i18n/brand.ts"),
      join(appDir, "src/lib/legal.ts"),
      join(publicDir, "index.html"),
      join(publicDir, "site.webmanifest"),
      join(repoDir, "tools/render-assets.ts")
    ]) {
      assert.notMatch(readFileSync(file, "utf8"), /\bnuance\b|ニュアンス/i, `banned term 'nuance' in ${file}`)
    }
  })

  it("ships a valid web app manifest whose icons all exist", () => {
    const manifest = JSON.parse(readFileSync(join(publicDir, "site.webmanifest"), "utf8")) as WebManifest

    assert.strictEqual(manifest.name, "Kotori")
    assert.strictEqual(manifest.short_name, "Kotori")
    assert.strictEqual(manifest.start_url, "/")
    assert.strictEqual(manifest.display, "standalone")
    assert.isAbove(manifest.description.length, 20)
    assert.isAbove(manifest.icons.length, 0)

    const purposes = new Set(manifest.icons.map((icon) => icon.purpose))
    assert.isTrue(purposes.has("any"))
    assert.isTrue(purposes.has("maskable"))

    for (const icon of manifest.icons) {
      const filePath = icon.src.replace(/^\//, "")
      assert.isTrue(existsSync(join(publicDir, filePath)), `missing manifest icon: ${filePath}`)
    }
  })

  it("ships crawler-friendly robots.txt and sitemap.xml", () => {
    const robots = readFileSync(join(publicDir, "robots.txt"), "utf8")
    assert.include(robots, "Allow: /")
    assert.include(robots, "Sitemap: https://hellokotori.com/sitemap.xml")
    // Never block JS/asset bundles needed for rendering public routes.
    assert.notInclude(robots, "Disallow: /_expo/")
    assert.notInclude(robots, "Disallow: /assets/")
    // Signed-in screens and account forms stay out of the index; a rule without a trailing slash covers the route itself.
    const disallowed = robots.split("\n").flatMap((line) => (line.startsWith("Disallow: ") ? [line.slice(10)] : []))
    for (const route of ["/say", "/check", "/notebook", "/settings", "/sign-in", "/sign-up"]) {
      assert.include(disallowed, route)
    }
    for (const publicRoute of ["/welcome", "/ja", "/privacy", "/terms"]) {
      assert.isFalse(
        disallowed.some((rule) => publicRoute.startsWith(rule)),
        `${publicRoute} must stay crawlable`
      )
    }

    const sitemap = readFileSync(join(publicDir, "sitemap.xml"), "utf8")
    assert.include(sitemap, "<loc>https://hellokotori.com/</loc>")
    assert.include(sitemap, "<loc>https://hellokotori.com/ja</loc>")
    assert.include(sitemap, "<loc>https://hellokotori.com/privacy</loc>")
    assert.include(sitemap, "<loc>https://hellokotori.com/terms</loc>")
  })

  it("configures Expo web metadata and Vercel security/caching headers", () => {
    const appJson = JSON.parse(readFileSync(join(appDir, "app.json"), "utf8")) as {
      readonly expo: { readonly web: Record<string, string> }
    }
    assert.strictEqual(appJson.expo.web.lang, "en")
    assert.strictEqual(appJson.expo.web.favicon, "./assets/favicon.png")
    assert.isTrue(existsSync(join(appDir, appJson.expo.web.favicon!)))
    assert.isAbove((appJson.expo.web.description ?? "").length, 20)

    const vercel = JSON.parse(readFileSync(join(repoDir, "vercel.json"), "utf8")) as VercelConfig
    assert.strictEqual(vercel.trailingSlash, false)

    const allHeaders = (vercel.headers ?? []).flatMap((rule) =>
      rule.headers.map((h) => [rule.source, h.key, h.value] as const)
    )
    const hasHeader = (key: string) => allHeaders.some(([, k]) => k === key)
    assert.isTrue(hasHeader("Strict-Transport-Security"))
    assert.isTrue(hasHeader("X-Content-Type-Options"))
    assert.isTrue(hasHeader("X-Frame-Options"))
    assert.isTrue(hasHeader("Referrer-Policy"))
    assert.isTrue(hasHeader("Permissions-Policy"))
    assert.isTrue(hasHeader("Content-Security-Policy"))

    const staticCache = allHeaders.find(([source, key]) => source === "/_expo/static/(.*)" && key === "Cache-Control")
    assert.include(staticCache?.[2] ?? "", "immutable")

    const jaRewrite = vercel.rewrites?.find((rule) => rule.source === "/ja")
    assert.strictEqual(jaRewrite?.destination, "/ja/index.html")

    const rewrite = vercel.rewrites?.at(-1)
    assert.isDefined(rewrite)
    assert.strictEqual(rewrite.destination, "/index.html")
    assert.include(rewrite.source, "_expo/")
    assert.include(rewrite.source, "assets/")
  })

  it("registers a custom 404 route and exports a Sentry-wrapped root ErrorBoundary", () => {
    assert.isTrue(existsSync(join(appDir, "app/+not-found.tsx")))
    const layout = readFileSync(join(appDir, "app/_layout.tsx"), "utf8")
    assert.match(layout, /export const ErrorBoundary = Sentry\.wrapExpoRouterErrorBoundary\(/)
    assert.match(layout, /Stack\.Screen name="\+not-found"/)
  })
})

describe("web chrome helpers", () => {
  it("formats browser document titles cleanly", () => {
    assert.strictEqual(formatDocumentTitle(undefined, "Kotori"), "Kotori")
    assert.strictEqual(formatDocumentTitle("Kotori", "Kotori"), "Kotori")
    assert.strictEqual(formatDocumentTitle("Settings", "Kotori"), "Settings · Kotori")
    assert.strictEqual(formatDocumentTitle("設定", "ことり"), "設定 · ことり")
    assert.strictEqual(formatDocumentTitle(["食べる", "Sources"], "Kotori"), "食べる · Sources · Kotori")
    assert.strictEqual(formatDocumentTitle([undefined, "Kotori", ""], "Kotori"), "Kotori")
  })

  it("syncs theme-color meta tag, root/body background, and html lang", () => {
    const meta = { name: "theme-color", content: "#F6FAFC" } as HTMLMetaElement
    const fakeDoc = {
      documentElement: { lang: "en", style: { backgroundColor: "" } },
      body: { style: { backgroundColor: "" } },
      head: { appendChild: () => meta },
      querySelector: () => meta,
      createElement: () => meta
    } as unknown as Document

    syncWebTheme("#F7FAF7", fakeDoc)
    assert.strictEqual(fakeDoc.documentElement.style.backgroundColor, "#F7FAF7")
    assert.strictEqual(fakeDoc.body.style.backgroundColor, "#F7FAF7")
    assert.strictEqual(meta.content, "#F7FAF7")

    syncWebLanguage("ja", fakeDoc)
    assert.strictEqual(fakeDoc.documentElement.lang, "ja")
  })
})
