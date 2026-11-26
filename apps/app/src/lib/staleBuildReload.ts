import { isBuildChunk, type Page, reloadIfStale } from "./staleBuild.ts"

/**
 * Reloads the web page when it asks for a JavaScript chunk a newer deploy has removed; see
 * `staleBuild.ts`. `index.ts` loads this module before Expo Router, which requests the first
 * route's chunk as soon as it renders. iOS and Android ship every route in the app and have no
 * `document`, so nothing is set up there.
 */

const page: Page = {
  status: async (url) => {
    try {
      // A missing chunk's 404 is itself served as cacheable for a year (`vercel.json`), so ask the server.
      const response = await fetch(url, { method: "HEAD", cache: "no-store" })
      return response.status
    } catch {
      return null
    }
  },
  // A getter: reading `window.sessionStorage` throws when site data is blocked, and `reloadIfStale` handles that.
  get storage() {
    return window.sessionStorage
  },
  now: () => Date.now(),
  reload: () => window.location.reload()
}

if (typeof document !== "undefined") {
  // A `<script>` that fails to load fires `error` on itself without bubbling, so listen while capturing.
  window.addEventListener(
    "error",
    (event) => {
      const { target } = event
      if (!(target instanceof HTMLScriptElement) || !isBuildChunk(target.src, window.location.origin)) return
      void reloadIfStale(target.src, page)
    },
    true
  )
}
