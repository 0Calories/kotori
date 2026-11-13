import { managedAuth } from "./client.ts"
import { capturedReturn } from "./googleCapture"
import {
  buildGoogleIdTokenUrl,
  type GoogleLinkReturn,
  type GoogleReturn,
  ID_TOKEN_RETURN_PARAMS,
  LINK_PARAM,
  LINK_STORAGE_KEY,
  LINK_VALUE,
  type PendingGoogleLink,
  parsePendingLink,
  randomOAuthToken,
  readIdTokenReturn,
  readLinkReturn,
  readReturn,
  RETURN_PARAMS
} from "./googleReturn.ts"

const readPendingLink = (): PendingGoogleLink | null => {
  try {
    return parsePendingLink(window.sessionStorage.getItem(LINK_STORAGE_KEY))
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
   * The answer the page was loaded with, which `googleCapture.web.ts` took off the address bar
   * at load. Handed out once, so a retry doesn't replay it. Throws AuthError when Google or
   * Managed Auth refused.
   */
  returned: (): GoogleReturn => {
    if (readPendingLink() !== null) return null
    const params = capturedReturn.takeQuery(
      (q) => q.get(LINK_PARAM) !== LINK_VALUE && RETURN_PARAMS.some((name) => q.has(name)),
      RETURN_PARAMS
    )
    return params === null ? null : readReturn(params)
  },
  /** The answer when the Settings page comes back from linking Google. */
  linkReturned: (): GoogleLinkReturn => {
    const pending = readPendingLink()
    // Taken either way: an `id_token` with no pending link in this tab is discarded.
    const hashParams = capturedReturn.takeHash()
    if (pending !== null) {
      const queryParams = capturedReturn.takeQuery(
        (q) => hashParams !== null || ID_TOKEN_RETURN_PARAMS.some((name) => q.has(name)),
        ID_TOKEN_RETURN_PARAMS
      )
      const params = hashParams ?? queryParams
      if (params !== null) {
        clearPendingLink()
        return readIdTokenReturn(params, pending)
      }
    }
    const params = capturedReturn.takeQuery((q) => q.get(LINK_PARAM) === LINK_VALUE, [LINK_PARAM, ...RETURN_PARAMS])
    return params === null ? null : readLinkReturn(params)
  }
}
