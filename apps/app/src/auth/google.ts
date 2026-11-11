import * as Linking from "expo-linking"
import * as WebBrowser from "expo-web-browser"
import { managedAuth } from "./client.ts"
import {
  callbackURL,
  type GoogleLinkReturn,
  type GoogleReturn,
  linkCallbackURL,
  readLinkReturn,
  readReturn
} from "./googleReturn.ts"

/**
 * On iOS and Android, Google's page opens in the system's sign-in sheet
 * (ASWebAuthenticationSession / Custom Tabs), which hands the `kotori://` return URL
 * straight back here instead of to the router. The challenge cookie from starting the
 * sign-in is kept by the native transport, so the verifier can be traded right after.
 */
export const google = {
  start: async (): Promise<GoogleReturn | "redirected"> => {
    const returnTo = Linking.createURL("/sign-in")
    const { url } = await managedAuth.startGoogle(callbackURL(returnTo))
    const result = await WebBrowser.openAuthSessionAsync(url, returnTo)
    if (result.type !== "success") return null
    return readReturn(new URL(result.url).searchParams)
  },
  link: async (): Promise<GoogleLinkReturn | "redirected"> => {
    const returnTo = Linking.createURL("/settings")
    const { url } = await managedAuth.linkGoogle(linkCallbackURL(returnTo))
    const result = await WebBrowser.openAuthSessionAsync(url, returnTo)
    if (result.type !== "success") return null
    return readLinkReturn(new URL(result.url).searchParams)
  },
  /** Only the web comes back to a fresh page load; see `google.web.ts`. */
  returned: (): GoogleReturn => null,
  linkReturned: (): GoogleLinkReturn => null
}
