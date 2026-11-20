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
  } catch {}
}

// Never resolves during unload so buttons stay busy, unless the browser restores the page from bfcache (event.persisted).
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
  returned: (): GoogleReturn => {
    if (readPendingLink() !== null) return null
    const params = capturedReturn.takeQuery(
      (q) => q.get(LINK_PARAM) !== LINK_VALUE && RETURN_PARAMS.some((name) => q.has(name)),
      RETURN_PARAMS
    )
    return params === null ? null : readReturn(params)
  },
  linkReturned: (): GoogleLinkReturn => {
    const pending = readPendingLink()
    // Always consume the hash so an unsolicited id_token in the URL is discarded.
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
