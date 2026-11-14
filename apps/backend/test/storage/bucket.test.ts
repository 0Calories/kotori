import { assert, describe, it, layer } from "@effect/vitest"
import { audio, audioFiles } from "@kotori/db"
import { count } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Option, Redacted } from "effect"
import { createHash } from "node:crypto"
import { Database } from "../../src/db/Database.ts"
import { AudioStore, clipObject } from "../../src/features/audio/AudioStore.ts"
import { moveClipsToBucket } from "../../src/features/audio/move.ts"
import { Bucket, BucketError, describeCause, objectUrl, signRequest } from "../../src/integrations/storage/Bucket.ts"
import { DatabaseMemory } from "../../src/testing/DatabaseMemory.ts"

describe("Signature Version 4", () => {
  // AWS's worked example: https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
  it("signs AWS's example GET Object request as AWS does", () => {
    const headers = signRequest(
      {
        method: "GET",
        url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
        headers: { Range: "bytes=0-9" },
        payload: new Uint8Array()
      },
      {
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: Redacted.make("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"),
        region: "us-east-1"
      },
      new Date("2013-05-24T00:00:00Z")
    )
    assert.strictEqual(
      headers["authorization"],
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
    )
    assert.strictEqual(headers["x-amz-date"], "20130524T000000Z")
    assert.notProperty(headers, "host")
  })

  it("addresses objects path-style, under the endpoint's own path", () => {
    assert.strictEqual(
      objectUrl(new URL("https://br-x.storage.example"), "audio", "ab.mp3").toString(),
      "https://br-x.storage.example/audio/ab.mp3"
    )
    assert.strictEqual(
      objectUrl(new URL("http://localhost:9000/s3/"), "audio", "a b/c'.mp3").toString(),
      "http://localhost:9000/s3/audio/a%20b/c%27.mp3"
    )
  })
})

describe("a failed request's cause", () => {
  it("names each cause's code and message, outermost first", () => {
    // How undici reports a connection the server dropped.
    const socket = Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" })
    assert.strictEqual(
      describeCause(new TypeError("fetch failed", { cause: socket })),
      "fetch failed ← UND_ERR_SOCKET: other side closed"
    )
  })

  it("is empty when there is no cause", () => {
    assert.strictEqual(describeCause(undefined), "")
    assert.strictEqual(describeCause("not an error"), "")
  })
})

/**
 * A bucket in memory. `corrupt` makes it store the next uploads with a byte changed, as a broken
 * provider might; `down` makes its reads fail.
 */
const memoryBucket = (etags: "md5" | "opaque") => {
  const objects = new Map<string, Uint8Array>()
  const corrupt = { next: 0 }
  const down = { get: false }
  const md5 = (bytes: Uint8Array) => createHash("md5").update(bytes).digest("hex")
  const layer = Layer.succeed(
    Bucket,
    Bucket.of({
      name: "test-audio",
      put: (key, bytes) =>
        Effect.sync(() => {
          const stored = new Uint8Array(bytes)
          if (corrupt.next > 0 && corrupt.next--) stored[0] = (stored[0]! + 1) % 256
          objects.set(key, stored)
        }),
      get: (key) =>
        down.get
          ? Effect.fail(new BucketError({ message: "503 Service Unavailable" }))
          : Effect.sync(() => Option.fromNullishOr(objects.get(key))),
      head: (key) =>
        Effect.sync(() =>
          Option.map(Option.fromNullishOr(objects.get(key)), (bytes) => ({
            size: bytes.byteLength,
            etag: etags === "md5" ? md5(bytes) : "opaque-1"
          }))
        )
    })
  )
  return { objects, corrupt, down, layer }
}

const key = (n: number) => createHash("sha256").update(`clip ${n}`).digest("hex")
const mp3 = (n: number) => new TextEncoder().encode(`mp3 bytes of clip ${n}`)

/** Clips as they were stored before the bucket: a row in `audio` and the bytes in `audio_files`. */
const storeInTable = (ns: ReadonlyArray<number>) =>
  Effect.gen(function* () {
    const db = yield* Database
    for (const n of ns) {
      yield* db.insert(audio).values({
        key: key(n),
        text: `clip ${n}`,
        language: "ja",
        voiceId: "v",
        modelId: "m",
        characters: 6,
        bytes: mp3(n).byteLength
      })
      yield* db.insert(audioFiles).values({ key: key(n), data: Buffer.from(mp3(n)) })
    }
  })

const rowsInTable = Effect.gen(function* () {
  const db = yield* Database
  const [row] = yield* db.select({ n: count() }).from(audioFiles)
  return row?.n ?? 0
})

const bucketA = memoryBucket("md5")

layer(AudioStore.bucket.pipe(Layer.provideMerge(bucketA.layer), Layer.provideMerge(DatabaseMemory)))(
  "the bucket audio store",
  (it) => {
    it.effect("writes new clips to the bucket, and reads clips not yet moved from the table", () =>
      Effect.gen(function* () {
        yield* storeInTable([1])
        const store = yield* AudioStore
        yield* store.put(key(2), mp3(2))
        assert.deepStrictEqual(bucketA.objects.get(clipObject(key(2))), mp3(2))
        assert.strictEqual(yield* rowsInTable, 1)
        assert.deepStrictEqual(yield* store.read(key(1)), Option.some(mp3(1)))
        assert.deepStrictEqual(yield* store.read(key(2)), Option.some(mp3(2)))
        assert.isTrue(yield* store.exists(key(1)))
        assert.isTrue(yield* store.exists(key(2)))
        assert.isFalse(yield* store.exists(key(3)))
        assert.deepStrictEqual(yield* store.read(key(3)), Option.none())
        assert.deepStrictEqual(yield* store.read("../etc/passwd"), Option.none())

        // With the bucket failing, clips not yet moved still play.
        bucketA.down.get = true
        assert.deepStrictEqual(yield* store.read(key(1)), Option.some(mp3(1)))
        assert.deepStrictEqual(yield* store.read(key(2)), Option.none())
        bucketA.down.get = false
      })
    )

    it.effect("moves the table's clips to the bucket, checking each, and truncates the table", () =>
      Effect.gen(function* () {
        yield* storeInTable([10, 11, 12, 13, 14])
        const db = yield* Database
        const result = yield* moveClipsToBucket(db, { batch: 2, concurrency: 2 })
        assert.deepStrictEqual(
          { moved: result.moved, unverified: result.unverified, truncated: result.truncated },
          { moved: 6, unverified: [], truncated: true }
        )
        assert.strictEqual(yield* rowsInTable, 0)
        const store = yield* AudioStore
        for (const n of [1, 10, 14]) assert.deepStrictEqual(yield* store.read(key(n)), Option.some(mp3(n)))
      })
    )
  }
)

const bucketB = memoryBucket("opaque")

layer(Layer.mergeAll(bucketB.layer, DatabaseMemory))("moving clips to a bucket", (it) => {
  it.effect("keeps a clip that doesn't read back the same, and leaves the table", () =>
    Effect.gen(function* () {
      yield* storeInTable([20, 21, 22])
      const db = yield* Database
      // The first upload is stored with a byte changed; entity tags aren't MD5s here, so it's read back.
      bucketB.corrupt.next = 1
      const result = yield* moveClipsToBucket(db, { batch: 10, concurrency: 1 })
      // Clips go in key order, so the first key is the one that was corrupted.
      const [first] = [20, 21, 22].map(key).sort()
      assert.deepStrictEqual([result.moved, result.unverified, result.truncated], [2, [first], false])
      assert.strictEqual(yield* rowsInTable, 1)
      // Run again with an honest bucket: the clip left behind moves, and the table is truncated.
      const again = yield* moveClipsToBucket(db, { batch: 10, concurrency: 1 })
      assert.deepStrictEqual([again.moved, again.unverified, again.truncated], [1, [], true])
    })
  )
})

layer(
  AudioStore.layer.pipe(
    Layer.provideMerge(DatabaseMemory),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({})))
  )
)("the configured audio store", (it) => {
  it.effect("is the table when no bucket is configured", () =>
    Effect.gen(function* () {
      const store = yield* AudioStore
      yield* storeInTable([30])
      assert.deepStrictEqual(yield* store.read(key(30)), Option.some(mp3(30)))
      assert.strictEqual(yield* rowsInTable, 1)
    })
  )
})
