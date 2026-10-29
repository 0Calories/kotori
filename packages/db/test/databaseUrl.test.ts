import { assert, describe, it } from "@effect/vitest"
import { remoteDatabaseRefusal } from "../src/DatabaseUrl.ts"

const remote = "postgres://u:p@db.example.com/kotori?sslmode=verify-full"

describe("remoteDatabaseRefusal", () => {
  it("allows a database on this machine", () => {
    for (const url of [
      "postgres://kotori:kotori@localhost:5432/kotori",
      "postgresql://kotori@127.0.0.1/kotori",
      "postgres://kotori@[::1]:5432/kotori"
    ]) {
      assert.isUndefined(remoteDatabaseRefusal(url, {}), url)
    }
  })

  it("refuses any other host, naming it and the way to opt in", () => {
    const refusal = remoteDatabaseRefusal(remote, {})
    assert.include(refusal, "points at db.example.com")
    assert.include(refusal, "KOTORI_ALLOW_REMOTE_DB=db.example.com")
    assert.notInclude(refusal, "u:p")
  })

  it("allows only the host KOTORI_ALLOW_REMOTE_DB names", () => {
    assert.isUndefined(remoteDatabaseRefusal(remote, { KOTORI_ALLOW_REMOTE_DB: "db.example.com" }))
    assert.isUndefined(remoteDatabaseRefusal(remote, { KOTORI_ALLOW_REMOTE_DB: "DB.Example.com" }))
    assert.isString(remoteDatabaseRefusal(remote, { KOTORI_ALLOW_REMOTE_DB: "other.example.com" }))
    assert.isString(remoteDatabaseRefusal(remote, { KOTORI_ALLOW_REMOTE_DB: "1" }))
  })

  it("refuses a URL it can't read a host from", () => {
    assert.isString(remoteDatabaseRefusal("not a url", {}))
    assert.isString(remoteDatabaseRefusal("postgres:///kotori", { KOTORI_ALLOW_REMOTE_DB: "" }))
  })

  it("leaves production to its own DATABASE_URL", () => {
    assert.isUndefined(remoteDatabaseRefusal(remote, { NODE_ENV: "production" }))
    assert.isString(remoteDatabaseRefusal(remote, { NODE_ENV: "development" }))
  })
})
