// Inlined rather than imported from a workspace package so Metro dead-code-eliminates it when __DEV__ is false.
const devSignInEnabled = __DEV__ && process.env.EXPO_PUBLIC_DEV_SIGN_IN !== "off"

export const devCredentials = (): { readonly email: string; readonly password: string } | null =>
  devSignInEnabled ? { email: "dev@kotori.test", password: "kotori-dev-account" } : null
