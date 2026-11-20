import * as OpenApi from "effect/http-api/OpenApi"
import { describe, expect, it } from "vitest"
import { KotoriApi } from "../src/index.ts"

describe("KotoriApi", () => {
  it("publishes the committed OpenAPI document", async () => {
    await expect(`${JSON.stringify(OpenApi.fromApi(KotoriApi), null, 2)}\n`).toMatchFileSnapshot("./openapi.json")
  })
})
