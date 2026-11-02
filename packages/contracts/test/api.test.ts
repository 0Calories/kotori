import * as OpenApi from "effect/http-api/OpenApi"
import { describe, expect, it } from "vitest"
import { KotoriApi } from "../src/index.ts"

describe("KotoriApi", () => {
  // The schemas derive from the tables, so a column change can change the wire without touching
  // this package. The committed document makes every such change a reviewed diff: run
  // `pnpm --filter @kotori/contracts test -u` to accept one.
  it("publishes the committed OpenAPI document", async () => {
    await expect(`${JSON.stringify(OpenApi.fromApi(KotoriApi), null, 2)}\n`).toMatchFileSnapshot("./openapi.json")
  })
})
