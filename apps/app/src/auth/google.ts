import * as Linking from "expo-linking"
import * as WebBrowser from "expo-web-browser"
import { managedAuth } from "./client.ts"
import {
  type GoogleLinkReturn,
  type GoogleReturn,
  NATIVE_CALLBACK_PATH,
  readLinkReturn,
  readReturn
} from "./googleReturn.ts"
import { transport } from "./transport"

const openGoogle = async <A>(
  begin: (returnTo: string) => Promise<{ readonly url: string }>,
  parse: (params: URLSearchParams) => A
): Promise<A | "cancelled"> => {
  const returnTo = Linking.createURL(NATIVE_CALLBACK_PATH)
  const { url } = await begin(returnTo)
  const result = await WebBrowser.openAuthSessionAsync(url, returnTo)
  if (result.type !== "success") {
    await transport.clearChallenge()
    return "cancelled"
  }
  try {
    const parsed = parse(new URL(result.url).searchParams)
    if (parsed === null || parsed === "cancelled") await transport.clearChallenge()
    return parsed
  } catch (error) {
    await transport.clearChallenge()
    throw error
  }
}

/**
 * On iOS and Android, Google's page opens in the system's sign-in sheet
 * (ASWebAuthenticationSession / Custom Tabs) and returns to `kotori://auth/callback`,
 * which `app/+native-intent.ts` keeps out of Expo Router on Android. The challenge
 * cookie from starting the flow is kept by the native transport until traded or cleared.
 */
export const google = {
  start: (): Promise<GoogleReturn> => openGoogle(managedAuth.startGoogle, readReturn),
  link: (): Promise<GoogleLinkReturn> => openGoogle(managedAuth.linkGoogle, readLinkReturn),
  /** Only the web comes back to a fresh page load; see `google.web.ts`. */
  returned: (): GoogleReturn => null,
  linkReturned: (): GoogleLinkReturn => null
}
