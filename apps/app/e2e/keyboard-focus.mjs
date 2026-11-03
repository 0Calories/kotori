/**
 * Sign-up focus on the web build. Run against a dev server:
 *
 *   EXPO_PUBLIC_DEV_SIGN_IN=off pnpm --filter @kotori/app exec expo start --web --port 8081
 *   node apps/app/e2e/keyboard-focus.mjs
 *
 * Playwright must resolve from this directory (it is not a repo dependency).
 * Chromium is system Chrome. Touch-drag is Chromium-only; wheel, typing, tap-outside,
 * and Enter run in Chromium, Firefox, and WebKit at phone, tablet, and desktop widths.
 */
import { chromium, firefox, webkit } from "playwright"

const base = process.env.KOTORI_WEB_URL ?? "http://localhost:8081"

const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "ipad", width: 1024, height: 768 },
  { name: "iphone", width: 390, height: 844 },
  { name: "android", width: 412, height: 915 }
]

const engines = [
  { name: "chromium", launch: () => chromium.launch({ channel: "chrome", headless: true }) },
  { name: "firefox", launch: () => firefox.launch({ headless: true }) },
  { name: "webkit", launch: () => webkit.launch({ headless: true }) }
]

const fail = (message) => {
  throw new Error(message)
}

const emailInput = (page) => page.locator('input[type="email"]')

const scrollerOf = async (page) => {
  const handle = await emailInput(page).evaluateHandle((input) => {
    let node = input.parentElement
    while (node !== null) {
      const overflow = getComputedStyle(node).overflowY
      if (overflow === "auto" || overflow === "scroll") return node
      node = node.parentElement
    }
    return null
  })
  const element = handle.asElement()
  if (element === null) fail("email field has no scrolling ancestor")
  return element
}

const openSignUp = async (page) => {
  await page.goto(`${base}/sign-up`, { waitUntil: "domcontentloaded" })
  await emailInput(page).waitFor({ state: "visible", timeout: 30_000 })
}

const typeEmail = async (page) => {
  const email = emailInput(page)
  await email.click()
  await email.pressSequentially("ash@example.com", { delay: 20 })
  const focused = await email.evaluate((node) => document.activeElement === node)
  const value = await email.inputValue()
  if (!focused) fail(`email lost focus while typing (value ${JSON.stringify(value)})`)
  if (value !== "ash@example.com") fail(`email value is ${JSON.stringify(value)}`)
}

/** Make the form taller than the scroller so a scroll event can fire at any viewport. */
const forceOverflow = async (scroller) => {
  await scroller.evaluate((node) => {
    const inner = node.firstElementChild
    if (inner instanceof HTMLElement) inner.style.minHeight = "2400px"
  })
}

/** A mouse wheel scrolls the screen and must leave the field focused. */
const scrollWithoutPointer = async (page) => {
  const email = emailInput(page)
  await email.click()
  const scroller = await scrollerOf(page)
  await forceOverflow(scroller)
  const box = await page.getByText("WHAT ARE YOU LEARNING?").boundingBox()
  if (box === null) fail("could not find a place to wheel")
  await page.mouse.move(box.x + 24, box.y + 8)
  const before = await scroller.evaluate((node) => node.scrollTop)
  await page.mouse.wheel(0, 400)
  let after = before
  for (let i = 0; i < 20 && after === before; i += 1) {
    await page.waitForTimeout(50)
    after = await scroller.evaluate((node) => node.scrollTop)
  }
  if (after === before) fail("mouse wheel did not scroll the screen")
  const focused = await email.evaluate((node) => document.activeElement === node)
  if (!focused) fail("mouse wheel blurred the email field")
}

/** A real touch drag (Chromium). The screen scrolls and the field blurs. */
const dragScroll = async (page) => {
  const email = emailInput(page)
  await email.click()
  const scroller = await scrollerOf(page)
  await forceOverflow(scroller)
  await scroller.evaluate((node) => {
    node.scrollTop = 0
  })
  const box = await page.getByText("WHAT ARE YOU LEARNING?").boundingBox()
  if (box === null) fail("could not find a place to drag")
  const x = Math.round(box.x + 40)
  const y = Math.round(box.y + 70)
  const before = await scroller.evaluate((node) => node.scrollTop)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 0 }] })
  for (const dy of [40, 120, 220]) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - dy, id: 0 }] })
    await page.waitForTimeout(40)
  }
  const moved = await scroller.evaluate((node, start) => node.scrollTop !== start, before)
  const focused = await email.evaluate((node) => document.activeElement === node)
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await cdp.detach()
  if (!moved) fail("touch drag did not scroll the screen")
  if (focused) fail("touch drag left the email field focused")
}

const tapOutside = async (page) => {
  const email = emailInput(page)
  await email.click()
  await email.fill("still@example.com")
  // The beta line is ordinary text, not a button, so the browser moves focus off the field.
  await page.getByText("Kotori is in private beta", { exact: false }).click()
  const focused = await email.evaluate((node) => document.activeElement === node)
  if (focused) fail("tapping outside the field left it focused")
}

/** Enter on a single-line field submits and blurs, independent of keyboardDismissMode. */
const submitMovesOn = async (page) => {
  const email = emailInput(page)
  await email.click()
  await email.fill("next@example.com")
  await email.press("Enter")
  const passwordFocused = await page
    .locator('input[type="password"]')
    .evaluate((node) => document.activeElement === node)
  if (!passwordFocused) fail("Enter on Email did not move to Password")
}

const runViewport = async (browser, viewport, touch) => {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: true })
  const steps = [
    ["type", typeEmail],
    ["wheel", scrollWithoutPointer],
    ["tap outside", tapOutside],
    ["enter submits", submitMovesOn],
    ...(touch ? [["touch drag", dragScroll]] : [])
  ]
  try {
    await openSignUp(page)
    for (const [name, step] of steps) {
      const label = typeof name === "string" ? name : "step"
      try {
        await step(page)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        fail(`${viewport.name} / ${label}: ${message}`)
      }
    }
  } finally {
    await page.close()
  }
}

const failures = []
for (const engine of engines) {
  let browser
  try {
    browser = await engine.launch()
  } catch (error) {
    failures.push(`${engine.name}: could not launch (${error instanceof Error ? error.message : String(error)})`)
    continue
  }
  try {
    for (const viewport of viewports) {
      try {
        await runViewport(browser, viewport, engine.name === "chromium")
        console.log(`ok  ${engine.name}  ${viewport.name}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failures.push(`${engine.name} ${viewport.name}: ${message}`)
        console.error(`FAIL ${engine.name}  ${viewport.name}: ${message}`)
      }
    }
  } finally {
    await browser.close()
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"))
  process.exit(1)
}
console.log("focus held while typing; drag blurs; tap outside blurs; Enter moves on")
