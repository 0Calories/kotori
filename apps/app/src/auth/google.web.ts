import { managedAuth } from "./client.ts"
import {
  buildGoogleIdTokenUrl,
  type GoogleLinkReturn,
  type GoogleReturn,
  ID_TOKEN_RETURN_PARAMS,
  LINK_PARAM,
  LINK_VALUE,
  type PendingGoogleLink,
  randomOAuthToken,
  readIdTokenReturn,
  readLinkReturn,
  readReturn,
  RETURN_PARAMS
} from "./googleReturn.ts"

const LINK_STORAGE_KEY = "kotori.googleLink"

const readPendingLink = (): PendingGoogleLink | null => {
  try {
    const raw = window.sessionStorage.getItem(LINK_STORAGE_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>)["state"] === "string" &&
      typeof (parsed as Record<string, unknown>)["nonce"] === "string"
    ) {
      return {
        state: (parsed as Record<string, string>)["state"]!,
        nonce: (parsed as Record<string, string>)["nonce"]!
      }
    }
    return null
  } catch {
    return null
  }
}

const savePendingLink = (pending: PendingGoogleLink) => {
  try {
    window.sessionStorage.setItem(LINK_STORAGE_KEY, JSON.stringify(pending))
  } catch {
    // Private-browsing storage quota refusal surfaces on return as GOOGLE_FAILED.
  }
}

const clearPendingLink = () => {
  try {
    window.sessionStorage.removeItem(LINK_STORAGE_KEY)
  } catch {
    // Ignore storage errors during cleanup.
  }
}

/**
 * Navigates to Google's consent page. Never settles during a normal unload so buttons
 * stay in their opening state; resolves `"cancelled"` if the browser restores the page
 * from bfcache (e.g. pressing Back on Google's page).
 */
const redirect = (url: string, onCancel?: () => void): Promise<"cancelled"> =>
  new Promise((resolve) => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        window.removeEventListener("pageshow", onPageShow)
        onCancel?.()
        resolve("cancelled")
      }
    }
    window.addEventListener("pageshow", onPageShow)
    window.location.assign(url)
  })

const currentPage = () => window.location.origin + window.location.pathname

const takeParams = (
  predicate: (params: URLSearchParams) => boolean,
  keys: ReadonlyArray<string>
): URLSearchParams | null => {
  const url = new URL(window.location.href)
  if (!predicate(url.searchParams)) return null
  const params = new URLSearchParams(url.searchParams)
  for (const key of keys) url.searchParams.delete(key)
  window.history.replaceState(window.history.state, "", url.toString())
  return params
}

/**
 * On the web, sign-in goes through Managed Auth's `/sign-in/social/init` hop and returns a
 * verifier to trade with the challenge cookie on the API's origin. Account linking in Settings
 * requests an OIDC `id_token` directly from Google back to the Settings page (`#state=...&id_token=...`),
 * since Neon Managed Auth doesn't wrap `/link-social` with an `/init` state-cookie hop.
 */
export const google = {
  start: async (): Promise<GoogleReturn> => {
    clearPendingLink()
    const { url } = await managedAuth.startGoogle(currentPage())
    return redirect(url)
  },
  link: async (): Promise<GoogleLinkReturn> => {
    const clientId = await managedAuth.googleLinkClientId()
    const state = randomOAuthToken()
    const nonce = randomOAuthToken()
    savePendingLink({ state, nonce })
    return redirect(buildGoogleIdTokenUrl({ clientId, redirectUri: currentPage(), state, nonce }), clearPendingLink)
  },
  /**
   * The answer the page was loaded with, taken off the address bar so a reload doesn't
   * replay it. Throws AuthError when Google or Managed Auth refused.
   */
  returned: (): GoogleReturn => {
    if (readPendingLink() !== null) return null
    const params = takeParams(
      (q) => q.get(LINK_PARAM) !== LINK_VALUE && RETURN_PARAMS.some((name) => q.has(name)),
      RETURN_PARAMS
    )
    return params === null ? null : readReturn(params)
  },
  /** The answer when the Settings page comes back from linking Google. */
  linkReturned: (): GoogleLinkReturn => {
    const pending = readPendingLink()
    if (pending !== null) {
      const url = new URL(window.location.href)
      const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""))
      const inHash = ID_TOKEN_RETURN_PARAMS.some((name) => hashParams.has(name))
      const inQuery = ID_TOKEN_RETURN_PARAMS.some((name) => url.searchParams.has(name))
      if (inHash || inQuery) {
        const params = inHash ? hashParams : new URLSearchParams(url.searchParams)
        clearPendingLink()
        url.hash = ""
        for (const key of ID_TOKEN_RETURN_PARAMS) url.searchParams.delete(key)
        window.history.replaceState(window.history.state, "", url.toString())
        return readIdTokenReturn(params, pending)
      }
    }
    const params = takeParams((q) => q.get(LINK_PARAM) === LINK_VALUE, [LINK_PARAM, ...RETURN_PARAMS])
    return params === null ? null : readLinkReturn(params)
  }
}
