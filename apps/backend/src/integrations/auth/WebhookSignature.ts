import { CompactSign, type JWK } from "jose"
import { createPublicKey, type KeyObject, verify } from "node:crypto"

const base64url = (bytes: Uint8Array | string) =>
  (typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes)).toString("base64url")

export const ed25519Key = (jwk: JWK): KeyObject | undefined => {
  try {
    const key = createPublicKey({ key: { ...jwk }, format: "jwk" })
    return key.asymmetricKeyType === "ed25519" ? key : undefined
  } catch {
    return undefined
  }
}

// Neon Auth signs webhooks with Ed25519 detached JWS (header..signature) over base64url(timestamp + "." + base64url(rawBody)).
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
