import { afterEach, assert, describe, it, vi } from "vitest"
import { captureReturnUrl, LINK_STORAGE_KEY, parsePendingLink } from "../src/auth/googleReturn.ts"

const JWT = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl"
const PENDING = { state: "s-1", nonce: "n-1" }

/** A page as `googleCapture.web.ts` and `google.web.ts` see it: an address bar, history, and sessionStorage. */
const fakeWindow = (href: string, pending: object | null) => {
  const storage = new Map<string, string>(pending === null ? [] : [[LINK_STORAGE_KEY, JSON.stringify(pending)]])
  const replaced: Array<string> = []
  const location = { href }
  const window = {
    location,
    history: {
      state: null,
      replaceState: (_state: unknown, _title: string, url: string) => {
        replaced.push(url)
        location.href = url
      }
    },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key)
    }
  }
  return { window, storage, replaced }
}

/** Loads a fresh copy of the web modules against a page, as a page load does. */
const loadPage = async (href: string, pending: object | null = null) => {
  const page = fakeWindow(href, pending)
  vi.stubGlobal("window", page.window)
  vi.resetModules()
  vi.doMock("../src/auth/client.ts", () => ({ managedAuth: {} }))
  // Metro picks the `.web.ts` module on the web; Vitest needs telling.
  vi.doMock("../src/auth/googleCapture", () => import("../src/auth/googleCapture.web.ts"))
  // `index.ts` loads the capture first; the address bar is clean before anything else runs.
  await import("../src/auth/googleCapture.web.ts")
  const hrefAfterCapture = page.window.location.href
  const { google } = await import("../src/auth/google.web.ts")
  return { ...page, google, hrefAfterCapture }
}

/** The AuthError code `fn` throws. Each page load has its own copy of the AuthError class, so match by class name. */
const thrownCode = (fn: () => unknown): string => {
  try {
    fn()
  } catch (error) {
    assert.instanceOf(error, Error)
    assert.strictEqual(error.constructor.name, "AuthError")
    return (error as Error & { readonly code: string }).code
  }
  return assert.fail("Expected AuthError")
}

afterEach(() => {
  vi.doUnmock("../src/auth/client.ts")
  vi.doUnmock("../src/auth/googleCapture")
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe("captureReturnUrl", () => {
  it("leaves a normal page load untouched", () => {
    const { query, hash, cleanUrl } = captureReturnUrl("https://hellokotori.com/entry/42?lang=ja#top")
    assert.strictEqual(query.toString(), "")
    assert.isNull(hash)
    assert.isNull(cleanUrl)
  })

  it("takes the sign-in verifier and errors out of the query and keeps other parameters", () => {
    const { query, hash, cleanUrl } = captureReturnUrl(
      "https://hellokotori.com/sign-in?lang=ja&neon_auth_session_verifier=v-1&error=x&error_description=y"
    )
    assert.strictEqual(query.get("neon_auth_session_verifier"), "v-1")
    assert.strictEqual(query.get("error"), "x")
    assert.strictEqual(query.get("error_description"), "y")
    assert.isNull(hash)
    assert.strictEqual(cleanUrl, "https://hellokotori.com/sign-in?lang=ja")
  })

  it("takes the Settings link marker with its verifier", () => {
    const { query, cleanUrl } = captureReturnUrl(
      "https://hellokotori.com/settings?google=linked&neon_auth_session_verifier=v-2"
    )
    assert.strictEqual(query.get("google"), "linked")
    assert.strictEqual(query.get("neon_auth_session_verifier"), "v-2")
    assert.strictEqual(cleanUrl, "https://hellokotori.com/settings")
  })

  it("takes Google's id_token fragment, and a refusal in the query", () => {
    const fragment = captureReturnUrl(`https://hellokotori.com/settings#state=s-1&id_token=${JWT}`)
    assert.strictEqual(fragment.hash?.get("id_token"), JWT)
    assert.strictEqual(fragment.hash?.get("state"), "s-1")
    assert.strictEqual(fragment.cleanUrl, "https://hellokotori.com/settings")

    const refusal = captureReturnUrl("https://hellokotori.com/settings?state=s-1&error=access_denied")
    assert.strictEqual(refusal.query.get("state"), "s-1")
    assert.strictEqual(refusal.query.get("error"), "access_denied")
    assert.strictEqual(refusal.cleanUrl, "https://hellokotori.com/settings")
  })

  it("keeps a fragment that isn't a Google return", () => {
    assert.isNull(captureReturnUrl("https://hellokotori.com/terms#section-2").cleanUrl)
  })
})

describe("parsePendingLink", () => {
  it("reads a stored state and nonce and rejects anything else", () => {
    assert.deepStrictEqual(parsePendingLink(JSON.stringify(PENDING)), PENDING)
    assert.isNull(parsePendingLink(null))
    assert.isNull(parsePendingLink("not json"))
    assert.isNull(parsePendingLink("null"))
    assert.isNull(parsePendingLink(JSON.stringify({ state: "s-1" })))
    assert.isNull(parsePendingLink(JSON.stringify({ state: 1, nonce: "n" })))
  })
})

describe("Google return on a web page load", () => {
  it("strips a sign-in return at load and hands the verifier over once", async () => {
    const page = await loadPage("https://hellokotori.com/sign-in?neon_auth_session_verifier=v-1")
    assert.strictEqual(page.hrefAfterCapture, "https://hellokotori.com/sign-in")
    assert.deepStrictEqual(page.google.returned(), { verifier: "v-1" })
    assert.isNull(page.google.returned())
    assert.isNull(page.google.linkReturned())
    assert.deepStrictEqual(page.replaced, ["https://hellokotori.com/sign-in"])
  })

  it("reports a cancelled or refused sign-in", async () => {
    const cancelled = await loadPage("https://hellokotori.com/sign-in?error=access_denied")
    assert.strictEqual(cancelled.google.returned(), "cancelled")

    const refused = await loadPage("https://hellokotori.com/sign-in?error=account_not_linked")
    assert.strictEqual(
      thrownCode(() => refused.google.returned()),
      "GOOGLE_NOT_LINKED"
    )
  })

  it("strips a linking return at load and hands the id_token to Settings once", async () => {
    const page = await loadPage(`https://hellokotori.com/settings#state=s-1&id_token=${JWT}`, PENDING)
    assert.strictEqual(page.hrefAfterCapture, "https://hellokotori.com/settings")
    // Sign-in leaves a page with a pending link alone.
    assert.isNull(page.google.returned())
    assert.deepStrictEqual(page.google.linkReturned(), { kind: "id_token", idToken: JWT, nonce: "n-1" })
    assert.isFalse(page.storage.has(LINK_STORAGE_KEY))
    assert.isNull(page.google.linkReturned())
  })

  it("still rejects an id_token whose state doesn't match", async () => {
    const page = await loadPage(`https://hellokotori.com/settings#state=forged&id_token=${JWT}`, PENDING)
    assert.strictEqual(
      thrownCode(() => page.google.linkReturned()),
      "GOOGLE_FAILED"
    )
  })

  it("reads a linking refusal from the query", async () => {
    const page = await loadPage("https://hellokotori.com/settings?state=s-1&error=access_denied", PENDING)
    assert.strictEqual(page.hrefAfterCapture, "https://hellokotori.com/settings")
    assert.strictEqual(page.google.linkReturned(), "cancelled")
  })

  it("clears and discards an id_token when this tab has no pending link", async () => {
    const page = await loadPage(`https://hellokotori.com/settings#state=s-1&id_token=${JWT}`)
    assert.strictEqual(page.hrefAfterCapture, "https://hellokotori.com/settings")
    assert.isNull(page.google.returned())
    assert.isNull(page.google.linkReturned())
  })

  it("leaves a normal page load alone", async () => {
    const page = await loadPage("https://hellokotori.com/entry/42?lang=ja")
    assert.strictEqual(page.hrefAfterCapture, "https://hellokotori.com/entry/42?lang=ja")
    assert.deepStrictEqual(page.replaced, [])
    assert.isNull(page.google.returned())
    assert.isNull(page.google.linkReturned())
  })
})
