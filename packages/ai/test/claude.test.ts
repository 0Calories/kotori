import { describe, expect, it } from "vitest"
import { HowToSayOutput, NaturalnessOutput, outputSchema } from "../src/index.ts"
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
