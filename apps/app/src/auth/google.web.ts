import { managedAuth } from "./client.ts"
import {
  type GoogleLinkReturn,
  type GoogleReturn,
  LINK_PARAM,
  LINK_VALUE,
  readLinkReturn,
  readReturn,
  RETURN_PARAMS
} from "./googleReturn.ts"

/**
 * Navigates to Google's consent page. Never settles during a normal unload so buttons
 * stay in their opening state; resolves `"cancelled"` if the browser restores the page
 * from bfcache (e.g. pressing Back on Google's page).
 */
const redirect = (url: string): Promise<"cancelled"> =>
  new Promise((resolve) => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        window.removeEventListener("pageshow", onPageShow)
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
 * On the web the whole page goes to Google and comes back to the screen it left,
 * with Managed Auth's answer in the query. The browser keeps the challenge cookie
 * (HttpOnly, on the API's origin) for the trade.
 */
export const google = {
  start: async (): Promise<GoogleReturn> => {
    const { url } = await managedAuth.startGoogle(currentPage())
    return redirect(url)
  },
  link: async (): Promise<GoogleLinkReturn> => {
    const { url } = await managedAuth.linkGoogle(currentPage())
    return redirect(url)
  },
  /**
   * The answer the page was loaded with, taken off the address bar so a reload doesn't
   * replay it. Throws AuthError when Google or Managed Auth refused.
   */
  returned: (): GoogleReturn => {
    const params = takeParams(
      (q) => q.get(LINK_PARAM) !== LINK_VALUE && RETURN_PARAMS.some((name) => q.has(name)),
      RETURN_PARAMS
    )
    return params === null ? null : readReturn(params)
  },
  /** The answer when the Settings page comes back from linking Google. */
  linkReturned: (): GoogleLinkReturn => {
    const params = takeParams((q) => q.get(LINK_PARAM) === LINK_VALUE, [LINK_PARAM, ...RETURN_PARAMS])
    return params === null ? null : readLinkReturn(params)
  }
}
