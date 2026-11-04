import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { assert, describe, it } from "vitest"
import { strings } from "../src/i18n/strings.ts"

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..")

describe("disabled speak and check tabs", () => {
  it("provides localized tooltip copy in English and Japanese", () => {
    assert.ok(strings.en.tabs.notReady.length > 0)
    assert.ok(strings.ja.tabs.notReady.length > 0)
    assert.notEqual(strings.en.tabs.notReady, strings.ja.tabs.notReady)
  })

  it("keeps the speak and check tab buttons in the bar while disabling them with a tooltip", () => {
    const layout = readFileSync(join(appDir, "app/(tabs)/_layout.tsx"), "utf8")
    const tabBar = readFileSync(join(appDir, "src/components/TabBar.tsx"), "utf8")

    assert.match(layout, /Tabs\.Screen name="say"/)
    assert.match(layout, /Tabs\.Screen name="check"/)
    assert.match(tabBar, /DISABLED_TABS.*new Set\(\["say", "check"\]\)/)
    assert.match(tabBar, /tooltip=\{disabled \? t\.tabs\.notReady : undefined\}/)
    assert.match(tabBar, /role="tooltip"/)
  })
})

describe("lookup hero sky card", () => {
  it("stretches full-width and flush with the top on mobile while staying a padded card on desktop", () => {
    const index = readFileSync(join(appDir, "app/(tabs)/index.tsx"), "utf8")

    assert.match(index, /const desktop = width > theme\.maxWidth/)
    assert.match(index, /marginHorizontal: -theme\.space\.lg/)
    assert.match(index, /marginTop: -\(insets\.top \+ theme\.space\.sm\)/)
    assert.match(index, /paddingTop: insets\.top \+ theme\.space\.md/)
    assert.match(index, /borderBottomLeftRadius: 40/)
    assert.match(index, /borderBottomRightRadius: 40/)
    assert.match(index, /borderRadius: theme\.radius\.xl/)
  })
})
