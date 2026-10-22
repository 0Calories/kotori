import { assert, describe, it } from "@effect/vitest"
import { Result } from "effect"
import { int8AsNumber } from "../src/Database.ts"

const INT64_PROBE = 2n ** 60n

// PGlite never exercises this codec (it parses text, not the binary protocol),
// so a real-Postgres regression here would otherwise only surface at runtime.
describe("int8AsNumber", () => {
  const roundtrip = (value: number | bigint) =>
    Result.getOrThrow(int8AsNumber.decode(Result.getOrThrow(int8AsNumber.encode(value))))

  it("round-trips numbers and bigints, timestamps included", () => {
    assert.strictEqual(roundtrip(0), 0)
    assert.strictEqual(roundtrip(-42), -42)
    // The driver passes integers above int32 range as bigint (e.g. Clock.currentTimeMillis).
    assert.strictEqual(roundtrip(1_792_686_946_379n), 1_792_686_946_379)
    assert.strictEqual(roundtrip(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER)
  })

  it("rejects what cannot round-trip safely", () => {
    assert.isTrue(Result.isFailure(int8AsNumber.encode(1.5)))
    assert.isTrue(Result.isFailure(int8AsNumber.encode(2n ** 63n)))
    // A stored value beyond Number.MAX_SAFE_INTEGER fails decoding instead of losing precision.
    const bytes = new Uint8Array(8)
    new DataView(bytes.buffer).setBigInt64(0, INT64_PROBE)
    assert.isTrue(Result.isFailure(int8AsNumber.decode(bytes)))
  })
})
