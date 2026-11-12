import { captureReturnUrl, LINK_STORAGE_KEY, parsePendingLink } from "./googleReturn.ts"

/**
 * Takes what Google or Managed Auth returned off the address bar as soon as the bundle starts,
 * and keeps it in memory for `google.web.ts`. `index.ts` loads this module before Expo Router,
 * which would otherwise copy the URL into its navigation state and write it back, and before
 * `Sentry.init`, so Sentry never records a navigation from a URL that carried it.
 */

const hasPendingLink = () => {
  try {
    return parsePendingLink(window.sessionStorage.getItem(LINK_STORAGE_KEY)) !== null
  } catch {
    return false
  }
}

const capture = (): { readonly query: URLSearchParams; readonly hash: URLSearchParams | null } => {
  if (typeof window === "undefined") return { query: new URLSearchParams(), hash: null }
  const { query, hash, cleanUrl } = captureReturnUrl(window.location.href)
  if (cleanUrl !== null) window.history.replaceState(window.history.state, "", cleanUrl)
  // An `id_token` this tab didn't ask for (the link started in another tab, or storage was cleared) is dropped.
  return { query, hash: hash !== null && hasPendingLink() ? hash : null }
}

const captured = capture()
const query = captured.query
let hash = captured.hash

export const capturedReturn = {
  /** Removes `keys` from the captured query and returns what it held, if `predicate` accepts it. */
  takeQuery: (predicate: (params: URLSearchParams) => boolean, keys: ReadonlyArray<string>): URLSearchParams | null => {
    if (!predicate(query)) return null
    const params = new URLSearchParams(query)
    for (const key of keys) query.delete(key)
    return params
  },
  /** The captured fragment, handed out once. */
  takeHash: (): URLSearchParams | null => {
    const taken = hash
    hash = null
    return taken
  }
}
