/**
 * Signing in as the development account automatically, so manual testing doesn't
 * start with sign-up and a confirmation code every time. Create the account first
 * with `pnpm kotori dev-account`, which uses these same credentials (they are
 * repeated there rather than shared through a package, so that the bundler can
 * drop them from release builds — see below).
 *
 * `__DEV__` is `false` in a release build, so the bundler folds `devSignInEnabled`
 * to `false` and `devCredentials` to `() => null`, and the credentials below never
 * reach a shipped app. Verified against `pnpm --filter @kotori/app build`.
 *
 * To exercise the real sign-in flow instead, set `EXPO_PUBLIC_DEV_SIGN_IN=off`, or
 * sign out in the app, which stands until the next reload.
 */
const devSignInEnabled = __DEV__ && process.env.EXPO_PUBLIC_DEV_SIGN_IN !== "off"

/** The development account's credentials, or null when auto sign-in is off. */
export const devCredentials = (): { readonly email: string; readonly password: string } | null =>
  devSignInEnabled ? { email: "dev@kotori.test", password: "kotori-dev-account" } : null
