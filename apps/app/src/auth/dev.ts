/**
 * The account `kotori dev-account` creates, which the app signs in as during
 * development so testing doesn't start with sign-up and a confirmation code. The
 * credentials are repeated there rather than shared through a package, so that
 * `__DEV__` being false lets the bundler fold them out of release builds.
 */
const devSignInEnabled = __DEV__ && process.env.EXPO_PUBLIC_DEV_SIGN_IN !== "off"

/** The development account's credentials, or null when auto sign-in is off. */
export const devCredentials = (): { readonly email: string; readonly password: string } | null =>
  devSignInEnabled ? { email: "dev@kotori.test", password: "kotori-dev-account" } : null
