import { isReturnSecretKey, redactReturnParams } from "../auth/googleReturn.ts"

/**
 * Sentry hooks that blank the values of Google sign-in's return parameters (`id_token`, `state`,
 * the Managed Auth verifier, …) wherever a URL turns up: navigation and fetch breadcrumbs, the
 * event's `request`, transaction and span names and attributes. `googleCapture.web.ts` already
 * takes them off the address bar before Sentry starts; this catches any that get through, such
 * as the verifier in the `/get-session` request URL.
 */

const MAX_DEPTH = 12

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** A copy of `value` with return parameters blanked in every string, and credential-named keys blanked in maps. */
export const redactDeep = <A>(value: A, depth = 0): A => {
  if (typeof value === "string") return redactReturnParams(value) as A
  if (depth >= MAX_DEPTH) return value
  if (Array.isArray(value)) return value.map((item: unknown) => redactDeep(item, depth + 1)) as A
  if (!isPlainObject(value)) return value
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    result[key] = isReturnSecretKey(key) && typeof item === "string" ? "[Filtered]" : redactDeep(item, depth + 1)
  }
  return result as A
}

export const sentryRedaction = {
  beforeBreadcrumb: <B extends object>(breadcrumb: B): B => redactDeep(breadcrumb),
  beforeSend: <E extends object>(event: E): E => redactDeep(event),
  beforeSendTransaction: <E extends object>(event: E): E => redactDeep(event),
  beforeSendSpan: <S extends object>(span: S): S => redactDeep(span)
}
