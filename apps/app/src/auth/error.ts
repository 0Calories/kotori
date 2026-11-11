/**
 * A Managed Auth refusal, by Better Auth's error code (INVALID_EMAIL_OR_PASSWORD,
 * USER_ALREADY_EXISTS, INVALID_OTP…), a Google sign-in's `error` (GOOGLE_NOT_LINKED,
 * GOOGLE_EMAIL_MISMATCH…), or OFFLINE when it, or the API's proxy to it,
 * can't be reached.
 */
export class AuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}
