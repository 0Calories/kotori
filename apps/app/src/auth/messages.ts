import { ApiError } from "../api/client.ts"
import type { Strings } from "../i18n/strings.ts"
import { AuthError } from "./client.ts"

/** What to tell the learner when signing up, in, or confirming their email didn't work. */
export const authMessage = (t: Strings, error: unknown): string => {
  if (error instanceof AuthError) {
    switch (error.code) {
      case "OFFLINE":
        return t.common.offline
      case "RATE_LIMITED":
        return t.auth.errors.slowDown
      case "INVALID_EMAIL_OR_PASSWORD":
        return t.auth.errors.invalidCredentials
      case "USER_ALREADY_EXISTS":
      case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
        return t.auth.errors.emailTaken
      case "INVALID_EMAIL":
        return t.auth.errors.invalidEmail
      case "PASSWORD_TOO_SHORT":
        return t.auth.errors.passwordTooShort
      case "PASSWORD_TOO_LONG":
        return t.auth.errors.passwordTooLong
      case "INVALID_OTP":
        return t.auth.errors.wrongCode
      case "OTP_EXPIRED":
        return t.auth.errors.codeExpired
      case "TOO_MANY_ATTEMPTS":
        return t.auth.errors.tooManyAttempts
      // Signed up but no session to go on with: Managed Auth wants the email confirmed first.
      case "NO_SESSION":
      case "EMAIL_NOT_VERIFIED":
        return t.auth.errors.verifyFirst
    }
    return error.message || t.common.somethingWrong
  }
  if (error instanceof ApiError)
    return error.tag === "Offline" ? t.common.offline : error.message || t.common.somethingWrong
  return t.common.somethingWrong
}
