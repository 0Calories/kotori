import { managedAuth } from "./client.ts"
import { callbackURL, type GoogleReturn, readReturn, RETURN_PARAMS } from "./googleReturn.ts"

/**
 * On the web the whole page goes to Google and comes back to the screen it left,
 * with Managed Auth's answer in the query. The browser keeps the challenge cookie
 * (HttpOnly, on the API's origin) for the trade.
 */
export const google = {
  start: async (): Promise<GoogleReturn | "redirected"> => {
    const { url } = await managedAuth.startGoogle(callbackURL(window.location.origin + window.location.pathname))
    window.location.assign(url)
    return "redirected"
  },
  /**
   * The answer the page was loaded with, taken off the address bar so a reload doesn't
   * replay it. Throws AuthError when Google or Managed Auth refused.
   */
  returned: (): GoogleReturn => {
    const url = new URL(window.location.href)
    if (!RETURN_PARAMS.some((name) => url.searchParams.has(name))) return null
    const params = new URLSearchParams(url.searchParams)
    for (const name of RETURN_PARAMS) url.searchParams.delete(name)
    window.history.replaceState(window.history.state, "", url.toString())
    return readReturn(params)
  }
}
