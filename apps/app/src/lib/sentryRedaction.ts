import { isReturnSecretKey, redactReturnParams } from "../auth/googleReturn.ts"

const MAX_DEPTH = 12

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

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
