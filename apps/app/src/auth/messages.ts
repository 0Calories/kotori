import { apiErrorMessage } from "../api/errors.ts"
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
      // Changing the password with the wrong current one.
      case "INVALID_PASSWORD":
        return t.auth.errors.wrongPassword
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
      case "GOOGLE_NOT_LINKED":
        return t.auth.errors.googleNotLinked
      case "GOOGLE_EMAIL_MISMATCH":
      case "LINKING_DIFFERENT_EMAILS_NOT_ALLOWED":
        return t.auth.errors.googleEmailMismatch
      case "GOOGLE_ALREADY_LINKED":
      case "SOCIAL_ACCOUNT_ALREADY_LINKED":
        return t.auth.errors.googleAlreadyLinked
      case "GOOGLE_FAILED":
        return t.auth.errors.googleFailed
      // Signed up but no session to go on with: Managed Auth wants the email confirmed first.
      case "NO_SESSION":
      case "EMAIL_NOT_VERIFIED":
        return t.auth.errors.verifyFirst
    }
    // Managed Auth's own message is English and not written for learners.
    return t.common.somethingWrong
  }
  return apiErrorMessage(t, error)
}
