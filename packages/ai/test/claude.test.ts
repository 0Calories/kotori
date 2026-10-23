import { Effect } from "effect"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, vi } from "vitest"
import { Claude, HowToSayOutput, NaturalnessOutput, outputSchema } from "../src/index.ts"
import { ExamplesOutput } from "../src/ExampleWriter.ts"

type JsonSchema = {
  type?: string
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  additionalProperties?: unknown
  required?: Array<string>
  anyOf?: Array<JsonSchema>
}

const objects = (schema: JsonSchema): Array<JsonSchema> => [
  ...(schema.type === "object" ? [schema] : []),
  ...Object.values(schema.properties ?? {}).flatMap(objects),
  ...(schema.items ? objects(schema.items) : []),
  ...(schema.anyOf ?? []).flatMap(objects)
]

describe("structured output schemas", () => {
  it.each([
    ["naturalness", NaturalnessOutput],
    ["how to say", HowToSayOutput],
    ["examples", ExamplesOutput]
  ] as const)("%s: every object is closed and fully required", (_, schema) => {
    const json = outputSchema(schema) as JsonSchema
    const all = objects(json)
    expect(all.length).toBeGreaterThan(0)
    for (const object of all) {
      expect(object.additionalProperties).toBe(false)
      expect(new Set(object.required)).toEqual(new Set(Object.keys(object.properties ?? {})))
    }
  })
})

describe("Claude.available", () => {
  it("answers false within the probe timeout when the API hangs", async () => {
    // Accepts connections and never responds.
    const server = createServer(() => {})
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    vi.stubEnv("ANTHROPIC_BASE_URL", `http://127.0.0.1:${(server.address() as AddressInfo).port}`)
    vi.stubEnv("ANTHROPIC_API_KEY", "test")
    try {
      const started = Date.now()
      const available = await Effect.runPromise(
        Effect.flatMap(Claude, (claude) => claude.available).pipe(Effect.provide(Claude.layer))
      )
      expect(available).toBe(false)
      expect(Date.now() - started).toBeLessThan(4000)
    } finally {
      vi.unstubAllEnvs()
      server.closeAllConnections()
      server.close()
    }
  }, 10_000)
})
