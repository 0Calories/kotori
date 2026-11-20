import { describe, expect, it } from "vitest"
import { uninflect } from "../src/index.ts"

describe("uninflect", () => {
  it.each([
    ["parties", "party"],
    ["boxes", "box"],
    ["teams", "team"],
    ["stopped", "stop"],
    ["baked", "bake"],
    ["running", "run"],
    ["making", "make"],
    ["lying", "lie"],
    ["bigger", "big"],
    ["happiest", "happy"]
  ])("%s -> %s", (word, base) => {
    expect(uninflect(word).map((candidate) => candidate.base)).toContain(base)
  })

  it("leaves -ss words whole", () => {
    expect(uninflect("glass").map((candidate) => candidate.base)).not.toContain("glas")
  })

  it.each([
    ["ran", "run", ["past"]],
    ["went", "go", ["past"]],
    ["gone", "go", ["past-participle"]],
    ["ate", "eat", ["past"]],
    ["eaten", "eat", ["past-participle"]],
    ["bought", "buy", ["past", "past-participle"]],
    ["broken", "break", ["past-participle"]],
    ["thought", "think", ["past", "past-participle"]],
    ["wrote", "write", ["past"]],
    ["written", "write", ["past-participle"]],
    ["mice", "mouse", ["plural"]],
    ["children", "child", ["plural"]],
    ["geese", "goose", ["plural"]],
    ["knives", "knife", ["plural"]],
    ["phenomena", "phenomenon", ["plural"]],
    ["better", "good", ["comparative"]],
    ["best", "good", ["superlative"]],
    ["worse", "bad", ["comparative"]],
    ["worst", "bad", ["superlative"]],
    ["further", "far", ["comparative"]],
    ["furthest", "far", ["superlative"]],
    ["least", "little", ["superlative"]]
  ])("uninflects irregular %s -> %s", (word, base, tags) => {
    expect(uninflect(word)).toContainEqual({ base, tags })
  })

  it.each([
    ["ran into", "run into", ["past"]],
    ["broke down", "break down", ["past"]],
    ["broken down", "break down", ["past-participle"]],
    ["skating on thin ice", "skate on thin ice", ["present-participle"]],
    ["getting on my nerves", "get on my nerves", ["present-participle"]],
    ["looked forward to", "look forward to", ["past", "past-participle"]],
    ["puts up with", "put up with", ["plural", "third-person"]]
  ])("lemmatizes inflected phrasal verb/idiom %s -> %s", (phrase, base, tags) => {
    expect(uninflect(phrase)).toContainEqual({ base, tags })
  })
})
