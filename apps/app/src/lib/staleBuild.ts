/**
 * Recovers a page that is running a build the server has since replaced.
 *
 * Every web deploy gives the JavaScript chunks new hashed names and drops the old ones. A page
 * still running an older build (a long-open tab, or one the browser restored from its cache) asks
 * for a route's chunk by its old name and gets a 404, and asking again can never succeed. Loading
 * the page again can: the HTML is always revalidated, and it names the current chunks.
 * `staleBuildReload.ts` listens for the failed request.
 */

/** Where `expo export --platform web` puts the hashed JavaScript chunks. */
const CHUNK_PATH = "/_expo/static/js/"

/** sessionStorage key for when this tab last reloaded itself, in milliseconds since the epoch. */
export const RELOAD_STORAGE_KEY = "kotori.staleBuildReload"

/** How long after reloading itself a tab waits before doing so again, so a reload that didn't help can't loop. */
export const RELOAD_INTERVAL_MS = 60_000

/** What recovery needs from the page it runs in. */
export interface Page {
  /** The status the server gives `url` now, past any cache; null when the server can't be reached. */
  readonly status: (url: string) => Promise<number | null>
  readonly storage: Pick<Storage, "getItem" | "setItem">
  readonly now: () => number
  readonly reload: () => void
}

/** Whether the script at `src` is one of this site's own JavaScript chunks. */
export const isBuildChunk = (src: string, origin: string): boolean => {
  if (!URL.canParse(src)) return false
  const url = new URL(src)
  return url.origin === origin && url.pathname.startsWith(CHUNK_PATH)
}

/**
 * Reloads the page when the chunk at `chunkUrl` failed to load because the server no longer has
 * it. A chunk that failed for any other reason (offline, a server error) leaves the page as it is:
 * reloading would swap the app's own error screen for the browser's.
 */
export const reloadIfStale = async (chunkUrl: string, page: Page): Promise<void> => {
  if ((await page.status(chunkUrl)) !== 404) return
  try {
    // Read and written together, after the wait: of several chunks failing at once, only the first reloads.
    const last = Number(page.storage.getItem(RELOAD_STORAGE_KEY))
    const now = page.now()
    if (now - last < RELOAD_INTERVAL_MS) return
    page.storage.setItem(RELOAD_STORAGE_KEY, String(now))
  } catch {
    // Without storage (blocked site data) nothing would stop a loop.
    return
  }
  page.reload()
}
