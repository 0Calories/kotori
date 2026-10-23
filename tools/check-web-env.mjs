/**
 * Guards the hosted web build. `EXPO_PUBLIC_API_URL` is baked into the bundle at
 * build time, and without it the app falls back to the host serving the page on
 * port 4000 — which is right for a dev server and useless once deployed. A build
 * that would ship that fallback is a build worth failing, so Vercel runs this first
 * (`pnpm check:web-env`, see vercel.json).
 */

const NAME = "EXPO_PUBLIC_API_URL"
const value = process.env[NAME]?.trim()

const fail = (problem, hint) => {
  console.error(`${NAME} ${problem}.\n${hint}`)
  process.exit(1)
}

if (value === undefined || value === "") {
  fail(
    "is not set",
    "Set it to the API's public origin (e.g. https://kotori.fly.dev) in the Vercel project's\n" +
      "environment variables, for every environment the web app is built for."
  )
}

let url
try {
  url = new URL(value)
} catch {
  fail(`is not a URL: ${value}`, "Use an absolute origin, e.g. https://kotori.fly.dev (no trailing path).")
}

if (url.protocol !== "https:") {
  fail(
    `must be https, not ${url.protocol.replace(":", "")}: ${value}`,
    "Browsers refuse credentialed requests from an https page to an http API."
  )
}

// A deployed bundle pointing at the developer's own machine is the failure this exists to catch.
if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/.test(url.hostname)) {
  fail(`points at a local address: ${value}`, "The browser running the deployed app can't reach it.")
}

console.log(`Building the web app against ${url.origin}`)
