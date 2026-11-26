import { assert, describe, it } from "vitest"
import {
  isBuildChunk,
  type Page,
  RELOAD_INTERVAL_MS,
  RELOAD_STORAGE_KEY,
  reloadIfStale
} from "../src/lib/staleBuild.ts"

const ORIGIN = "https://hellokotori.com"
const CHUNK = `${ORIGIN}/_expo/static/js/web/index-18e9ca8d8edfde12db41000dbd687e1c.js`
const NOW = 1_795_000_000_000

/** A page whose server answers every chunk with `status` (null: unreachable), and which counts its reloads. */
const fakePage = (status: number | null, stored: ReadonlyArray<readonly [string, string]> = []) => {
  const storage = new Map<string, string>(stored)
  const state = { reloads: 0, now: NOW }
  const page: Page = {
    status: () => Promise.resolve(status),
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => void storage.set(key, value)
    },
    now: () => state.now,
    reload: () => {
      state.reloads += 1
    }
  }
  return { page, storage, state }
}

describe("isBuildChunk", () => {
  it("accepts the site's own hashed chunks", () => {
    assert.isTrue(isBuildChunk(CHUNK, ORIGIN))
    assert.isTrue(isBuildChunk(`${ORIGIN}/_expo/static/js/web/__common-84478306d9f60e750b05ab84c003abf4.js`, ORIGIN))
  })

  it("rejects scripts from elsewhere, other paths, and a script without a source", () => {
    assert.isFalse(isBuildChunk("https://accounts.google.com/gsi/client", ORIGIN))
    assert.isFalse(isBuildChunk("https://example.com/_expo/static/js/web/index-18e9.js", ORIGIN))
    assert.isFalse(isBuildChunk(`${ORIGIN}/assets/thing.js`, ORIGIN))
    assert.isFalse(isBuildChunk("", ORIGIN))
  })
})

describe("reloadIfStale", () => {
  it("reloads when the server no longer has the chunk, and records when", async () => {
    const { page, storage, state } = fakePage(404)
    await reloadIfStale(CHUNK, page)
    assert.strictEqual(state.reloads, 1)
    assert.strictEqual(storage.get(RELOAD_STORAGE_KEY), String(NOW))
  })

  it("leaves the page alone when the chunk is still served", async () => {
    const { page, storage, state } = fakePage(200)
    await reloadIfStale(CHUNK, page)
    assert.strictEqual(state.reloads, 0)
    assert.isFalse(storage.has(RELOAD_STORAGE_KEY))
  })

  it("leaves the page alone when the server can't be reached or is failing", async () => {
    const pages = [null, 500, 503].map((status) => fakePage(status))
    await Promise.all(pages.map(({ page }) => reloadIfStale(CHUNK, page)))
    assert.deepStrictEqual(
      pages.map(({ state }) => state.reloads),
      [0, 0, 0]
    )
  })

  it("does not reload again when a reload a moment ago didn't help", async () => {
    const { page, state } = fakePage(404, [[RELOAD_STORAGE_KEY, String(NOW - RELOAD_INTERVAL_MS + 1)]])
    await reloadIfStale(CHUNK, page)
    assert.strictEqual(state.reloads, 0)
  })

  it("reloads again for a later deploy in the same tab", async () => {
    const { page, storage, state } = fakePage(404, [[RELOAD_STORAGE_KEY, String(NOW - RELOAD_INTERVAL_MS)]])
    await reloadIfStale(CHUNK, page)
    assert.strictEqual(state.reloads, 1)
    assert.strictEqual(storage.get(RELOAD_STORAGE_KEY), String(NOW))
  })

  it("reloads once when several chunks fail together", async () => {
    const { page, state } = fakePage(404)
    await Promise.all([
      reloadIfStale(CHUNK, page),
      reloadIfStale(`${ORIGIN}/_expo/static/js/web/notebook-3fb7de28456fd7306aa0a7a919e9e116.js`, page)
    ])
    assert.strictEqual(state.reloads, 1)
  })

  it("does not reload when storage is unavailable, as nothing would stop a loop", async () => {
    const { page, state } = fakePage(404)
    const blocked: Page = {
      ...page,
      storage: {
        getItem: () => {
          throw new DOMException("The operation is insecure.", "SecurityError")
        },
        setItem: () => {}
      }
    }
    await reloadIfStale(CHUNK, blocked)
    assert.strictEqual(state.reloads, 0)
  })
})
