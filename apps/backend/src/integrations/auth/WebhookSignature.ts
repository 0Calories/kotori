import { CompactSign, type JWK } from "jose"
import { createPublicKey, type KeyObject, verify } from "node:crypto"

const base64url = (bytes: Uint8Array | string) =>
  (typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes)).toString("base64url")

/** The JWK as a Node public key if it is an Ed25519 one, the only kind Neon signs webhooks with. */
export const ed25519Key = (jwk: JWK): KeyObject | undefined => {
  try {
    const key = createPublicKey({ key: { ...jwk }, format: "jwk" })
    return key.asymmetricKeyType === "ed25519" ? key : undefined
  } catch {
    return undefined
  }
}

/**
 * Neon's documented check (docs/auth/guides/webhooks, "Signature verification"):
 * `X-Neon-Signature` is a detached JWS, `header..signature`, whose payload is
 * `base64url(timestamp + "." + base64url(rawBody))`, so the signing input is
 * `header + "." + that`, verified with the Ed25519 key named by
 * `X-Neon-Signature-Kid`. The raw bytes are used as received: re-serialised JSON
 * would not match.
 */
export const signatureIsValid = (body: Uint8Array, signature: string, timestamp: string, key: KeyObject) => {
  const parts = signature.split(".")
  const [header = "", detached, sig = ""] = parts
  if (parts.length !== 3 || detached !== "" || header === "" || sig === "") return false
  if (key.asymmetricKeyType !== "ed25519") return false
  const signingInput = `${header}.${base64url(`${timestamp}.${base64url(body)}`)}`
  try {
    return verify(null, Buffer.from(signingInput), key, Buffer.from(sig, "base64url"))
  } catch {
    return false
  }
}

/**
 * Signs a body the way Managed Auth does, for tests and the in-memory auth server.
 * jose does the JWS encoding, so this doesn't share code with `signatureIsValid`.
 */
export const signWebhook = async (
  privateKey: Parameters<CompactSign["sign"]>[0],
  kid: string,
  body: string,
  timestamp: number
): Promise<Record<string, string>> => {
  const payload = new TextEncoder().encode(`${timestamp}.${base64url(body)}`)
  const jws = await new CompactSign(payload).setProtectedHeader({ alg: "EdDSA", typ: "JWS", kid }).sign(privateKey)
  const [header, , signature] = jws.split(".")
  return {
    "content-type": "application/json",
    "x-neon-signature": `${header}..${signature}`,
    "x-neon-signature-kid": kid,
    "x-neon-timestamp": String(timestamp)
  }
}
