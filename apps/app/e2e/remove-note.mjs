/**
 * Removal confirmation on the actual Expo web screen, with a fake API.
 * Start Expo with EXPO_PUBLIC_DEV_SIGN_IN=off, then run this with Playwright installed.
 * KOTORI_PLAYWRIGHT can point to an existing Playwright module outside the repo.
 */
import assert from "node:assert/strict"

const { chromium } = await import(process.env.KOTORI_PLAYWRIGHT ?? "playwright")
const base = process.env.KOTORI_WEB_URL ?? "http://localhost:8087"
const at = new Date(0).toISOString()
const noteId = "00000000-0000-4000-8000-000000000150"
const content = {
  kind: "word",
  entryId: 1,
  senseIndex: 0,
  language: "ja",
  headword: "食べる",
  reading: "たべる",
  meaning: "to eat",
  hint: null,
  note: null,
  example: null,
  audioUrl: null
}
const schedule = { retentionStage: "review", due: at, interval: 30, ease: 2.5, reps: 1, lapses: 0, leech: false }
const profile = {
  id: "user",
  email: "browser-test@example.com",
  emailVerified: true,
  status: "approved",
  role: "user",
  nativeLanguage: "en",
  targetLanguage: "ja",
  displayName: null,
  timezone: "UTC",
  dailyNewLimit: 20,
  dailyReviewLimit: 200,
  createdAt: at,
  onboarded: true
}
const entry = {
  id: 1,
  language: "ja",
  source: "jmdict",
  headword: "食べる",
  reading: "たべる",
  common: true,
  romaji: "taberu",
  usuallyKana: false,
  labels: [],
  frequency: null,
  loanLink: null,
  cautions: [],
  forms: [],
  audioUrl: null,
  audio: [],
  enrichment: { examples: "unavailable", audio: "unavailable" },
  senses: Array.from({ length: 3 }, (_, index) => ({
    index,
    glosses: [index === 0 ? "to eat" : `meaning ${index + 1}`],
    partsOfSpeech: [],
    fields: [],
    info: [],
    appliesTo: [],
    related: [],
    antonyms: [],
    origins: [],
    examples: [],
    labels: [],
    usagePatterns: Array.from({ length: 8 }, (_, i) => ({
      text: `Usage ${i + 1}: A long explanation of how this meaning is used in everyday conversation, with enough text to make the first meaning scroll offscreen.`,
      source: "jmdict",
      about: null
    })),
    similarWords: []
  }))
}

const browser = await chromium.launch({ channel: "chrome", headless: true })
try {
  await Promise.all(
    [
      { width: 390, height: 844 },
      { width: 1280, height: 800 }
    ].map(async (viewport) => {
      const context = await browser.newContext({ viewport, timezoneId: "UTC" })
      const page = await context.newPage()
      let deleted = false
      let attempts = 0
      let finishDelete
      const deleting = new Promise((resolve) => {
        finishDelete = resolve
      })
      let finishRefetch
      const refetching = new Promise((resolve) => {
        finishRefetch = resolve
      })
      const all = Array.from({ length: 200 }, (_, i) => ({
        id: i === 150 ? noteId : `note${i}`,
        retentionStage: "review"
      }))
      const items = all.slice(0, 100).map((note) => ({
        note: { ...schedule, id: note.id, content, createdAt: at },
        labels: { again: "1m", hard: "1d", good: "4d", easy: "7d" }
      }))
      const errors = []
      page.on("pageerror", (error) => errors.push(error.message))
      await page.route("http://localhost:4000/**", async (route) => {
        const request = route.request()
        const pathname = new URL(request.url()).pathname
        const json = (body, status = 200) => route.fulfill({ status, json: body })
        // Hold post-delete refetches so assertions must see the immediate cache update.
        if (deleted && ["/study/notes", "/study/due", "/study/stats"].includes(pathname)) await refetching
        if (pathname === "/study/due")
          return json({ items, all, counts: { new: 0, learning: 0, review: deleted ? 199 : 200 }, nextDue: null })
        if (pathname === "/study/stats")
          return json({
            due: { new: 0, learning: 0, review: deleted ? 199 : 200 },
            reviewedToday: 0,
            streak: 0,
            notes: deleted ? 199 : 200,
            unseen: 0,
            young: 0,
            mature: deleted ? 199 : 200,
            retention: null,
            forecast: [0, 0, 0, 0, 0, 0, 0]
          })
        if (pathname === "/api/auth/token") return json({ token: "browser-test-token" })
        if (pathname === "/account/me") return json(profile)
        if (pathname === "/dictionary/entries/1") return json(entry)
        if (pathname === "/study/notes")
          return json(deleted ? [] : [{ ...schedule, id: noteId, content, createdAt: at }])
        if (pathname === `/study/notes/${noteId}` && request.method() === "DELETE") {
          attempts += 1
          if (attempts === 1) return json({ _tag: "NotFound", message: "test failure" }, 404)
          await deleting
          deleted = true
          return route.fulfill({ status: 204 })
        }
        if (pathname === "/health")
          return json({
            ok: true,
            version: "test",
            features: { coach: false, formality: false, audio: false, email: false },
            dictionary: { entries: 1 }
          })
        throw new Error(`Unexpected API request: ${request.method()} ${pathname}`)
      })
      try {
        await page.goto(`${base}/review`, { waitUntil: "domcontentloaded" })
        await page.getByText("200", { exact: true }).waitFor()
        await page.getByText("Your saved words & phrases", { exact: true }).click()
        await page.getByText("食べる", { exact: true }).click()
        const headerBookmark = () => page.getByRole("button", { name: "Remove from deck", exact: true }).first()
        await headerBookmark().waitFor()
        await page.getByText("meaning 3", { exact: true }).evaluate((node) => {
          let parent = node.parentElement
          while (parent && !["auto", "scroll"].includes(getComputedStyle(parent).overflowY))
            parent = parent.parentElement
          if (!parent) throw new Error("No entry scroller")
          parent.scrollTop = parent.scrollHeight
        })
        await headerBookmark().click()
        const title = page.getByText("Remove this from your deck?", { exact: true })
        await title.waitFor()
        const box = await title.boundingBox()
        assert.ok(
          box && box.y >= 0 && box.y + box.height <= viewport.height,
          "header removal confirmation must be in the viewport after scrolling"
        )
        const remove = page.getByRole("button", { name: "Remove", exact: true })
        const removeBox = await remove.boundingBox()
        assert.ok(
          removeBox && removeBox.y >= 0 && removeBox.y + removeBox.height <= viewport.height,
          "confirmation action must be reachable"
        )
        if (process.env.KOTORI_SCREENSHOTS)
          await page.screenshot({ path: `${process.env.KOTORI_SCREENSHOTS}/remove-${viewport.width}.png` })
        await page.getByRole("button", { name: "Cancel", exact: true }).click()
        await title.waitFor({ state: "hidden" })
        assert.equal(attempts, 0, "cancel must not delete")
        // The meaning bookmark opens the same modal; Escape cancels without deleting.
        await page.getByRole("button", { name: "Remove from deck", exact: true }).nth(1).click()
        await title.waitFor()
        assert.equal(await page.getByRole("dialog").getByText("to eat", { exact: true }).count(), 1)
        await page.keyboard.press("Escape")
        await title.waitFor({ state: "hidden" })
        assert.equal(attempts, 0)
        await headerBookmark().click()
        await remove.click()
        await page.getByText("Couldn't remove it. Try again.", { exact: true }).waitFor()
        assert.equal(deleted, false, "failed deletion must preserve the note")
        await remove.click()
        await page.getByRole("button", { name: "Removing…", exact: true }).waitFor()
        assert.equal(
          await page.getByRole("button", { name: "Cancel", exact: true }).getAttribute("aria-disabled"),
          "true"
        )
        await page.keyboard.press("Escape")
        assert.equal(await title.isVisible(), true, "pending deletion cannot be dismissed")
        finishDelete()
        await title.waitFor({ state: "hidden" })
        await page.getByRole("button", { name: "Save to review", exact: true }).first().waitFor()
        assert.equal(attempts, 2)
        assert.equal(deleted, true)
        await page.getByRole("button", { name: "Back", exact: true }).click()
        await page.getByText("Saved", { exact: true }).waitFor()
        await page.getByRole("button", { name: "Back", exact: true }).click()
        await page.getByText("199", { exact: true }).waitFor()
        await page.getByText("199 / 199", { exact: true }).waitFor()
        assert.deepEqual(errors, [], "the screen must not throw")
        console.log(
          `ok ${viewport.width}px: header and meaning confirmation, cancel, pending/error/retry; due counts update before refetch`
        )
      } catch (error) {
        await page.screenshot({ path: `/private/tmp/kotori-pr59-removal-failure-${viewport.width}.png` })
        throw error
      } finally {
        finishDelete()
        finishRefetch()
        await context.close()
      }
    })
  )
} finally {
  await browser.close()
}
