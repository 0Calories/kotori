# Streaming an Ask Kotori answer to iOS, Android and web

Research for [#117](https://github.com/0Calories/kotori/issues/117), part of the map in [#114](https://github.com/0Calories/kotori/issues/114). Researched 2026-11-09 against the versions this repo pins.

Every claim is marked:

- **Documented**: stated in official docs or a spec.
- **Source**: read in the installed package source at the pinned version.
- **Ran**: observed by running it locally (Node 22, loopback only).
- **Inferred**: my reasoning from the above. Not tested.

## Answer

Declare the endpoint in `@kotori/contracts` as a `POST` whose success is `HttpApiSchema.StreamSse(...)`. Effect 4.0.3 then serves it as `text/event-stream` and the existing typed `HttpApiClient` hands the app a `Stream` of decoded events. No new dependency is needed on any platform: on iOS and Android, Expo SDK 57 already installs its streaming `expo/fetch` as the global `fetch` that the app's Effect client uses, and browsers stream `fetch` bodies natively.

Three things are not provided and have to be designed:

1. **Recovery.** Nothing reconnects or resumes for you. The server also cancels the handler when the client disconnects. So the answer must be saved on the server independently of the connection, and the app recovers by reading the saved turn.
2. **A heartbeat.** Effect sends no keep-alive. An agent that is silent while a tool runs needs a small periodic event so that proxies and the app can tell "thinking" from "dead".
3. **A stall timer in the app.** Fly's proxy can drop a connection without the client being told.

Vercel is not in the path. The web deploy is static files and the browser calls the Fly API directly.

## Versions checked

| Package | Version | Where |
| --- | --- | --- |
| `effect`, `@effect/platform-node` | 4.0.3 | `pnpm-workspace.yaml` catalog, `pnpm-lock.yaml` |
| `expo` | 57.0.28 | `apps/app/package.json` |
| `react-native` | 0.86.3 | `apps/app/package.json` |
| `@tanstack/react-query` | 5.104.2 | `apps/app/package.json` |

Source paths below are relative to each package's root in `node_modules`.

## 1. Server: what Effect supports

### A streamed endpoint is a first-class part of the contract

- **Source** (`effect/src/http-api/HttpApiSchema.ts`): two streaming success schemas exist.
  - `HttpApiSchema.StreamSse({ data, error? })` or `StreamSse({ events, error? })`. Content type defaults to `text/event-stream`.
  - `HttpApiSchema.StreamUint8Array({ contentType? })`. Raw bytes, default `application/octet-stream`.
- **Source**: with `data`, handlers and clients see plain decoded values and each one is sent as a JSON `data:` line. With `events`, they see full SSE events (`id`, `event`, `data`), so the server can set an `id` per event.
- **Source** (`HttpApiEndpoint.ts`): the handler's return type becomes `Stream.Stream<Value, Error>`. The client's return type becomes a `Stream` whose error type is the declared error plus `HttpClientError | SchemaError | Sse.Retry | Sse.SseError` (`HttpApiClient.ts`).
- **Source** (`HttpApiEndpoint.ts`, `validateSuccessResponse`): limits on declaring one.
  - One streaming success per endpoint.
  - Not on `HEAD`.
  - Not as an error response.
  - It cannot share a status and content type with a buffered success.
- **Source**: both are marked `@stability unstable` in 4.0.3. The API may change in a minor release.
- **Source** (`OpenApi.ts`): the OpenAPI document describes the stream under the content type with an `x-effect-stream` extension, so `/docs` keeps working.

Shape of the contract (sketch, not code to merge):

```ts
HttpApiEndpoint.post("answer", "/conversations/:id/turns", {
  payload: AskTurnRequest,
  success: HttpApiSchema.StreamSse({ data: AnswerEvent, error: AnswerFailed }),
  error: [AskRefused, AiUnavailable, RateLimited]
})
```

### Two kinds of failure

- **Source + Ran**: errors raised before the handler returns its stream (auth middleware, rate limit, refusal) are ordinary typed HTTP errors with their status code, exactly as today.
- **Source + Ran**: once the `200` is sent, a stream failure is sent in-band as a reserved event, `event: effect/http-api/stream/failure`, carrying the encoded `Cause`. The typed client turns it back into a typed stream failure. An event schema may not use that event name.

### What goes over the wire

**Ran**: a throwaway `HttpApi` with the endpoint above, served by `NodeHttpServer` and called with Node's `fetch`. Events were 300 ms apart on the server and arrived 300 ms apart, so nothing in Effect buffers them.

```text
status 200 | content-type text/event-stream | transfer-encoding chunked | cache-control (none)
+1ms    data: {"_tag":"Text","text":"a!"}
+296ms  data: {"_tag":"Text","text":"b!"}
+610ms  data: {"_tag":"Text","text":"c!"}
        event: effect/http-api/stream/failure
        data: [{"_tag":"Fail","error":{"_tag":"Boom","message":"mid-stream"}}]
```

The typed client received the same events one by one, and the failing run ended with the typed `Boom` error.

- **Ran**: Effect sets no `Cache-Control` header on the stream. Add `Cache-Control: no-cache` if a cache could ever sit in front.
- **Source** (`effect/src/encoding/Sse.ts`): the encoder writes only events and `retry:` lines. It has no comment or keep-alive line. A heartbeat therefore has to be one of the endpoint's own events.
- **Source** (`@effect/platform-node/src/NodeHttpServer.ts`): the server writes each chunk with `nodeResponse.write` and waits for `drain` when the socket is full, so a slow client applies backpressure to the stream.
- **Source** (same file): when the response closes before it has ended, the request fiber is interrupted (`ClientAbort`). **Inferred**: an answer generated inside the response stream is cancelled when the learner's connection drops. To survive a drop, the turn has to run outside the request's lifetime and write its progress to the database.

### Chunked bodies without SSE

- **Source**: `HttpServerResponse.stream(stream, options)` sends any `Stream<Uint8Array>` as a chunked body, and `effect/encoding/Ndjson` can frame JSON lines.
- **Source**: inside `HttpApi` this is `StreamUint8Array`, which types the body only as bytes. The event schema and the typed failure are lost and would be rebuilt by hand on both sides.

## 2. Client: what Expo and React Native support

### `fetch` streaming

- **Documented** ([Expo SDK 57 reference, `expo`](https://docs.expo.dev/versions/v57.0.0/sdk/expo/)): `expo/fetch` "provides a WinterCG-compliant Fetch API" that "works consistently across web and mobile environments". The page's "Streaming fetch" sample reads `resp.body.getReader()`.
- **Documented** (same page): "On Android and iOS, `expo/fetch` is also installed as the global `fetch`." Setting `EXPO_PUBLIC_USE_RN_FETCH=1` restores React Native's own `fetch`.
- **Source** (`expo/src/winter/runtime.native.ts`): confirms the above for 57.0.28. This repo does not set `EXPO_PUBLIC_USE_RN_FETCH`.
- **Source** (`react-native/Libraries/Network/fetch.js`, `whatwg-fetch` 3.6.20): React Native's own `fetch` is the `whatwg-fetch` polyfill, which has no `ReadableStream` body. Turning the flag on would break streaming on native.
- **Source** (`expo/src/winter/fetch/fetch.web.ts`): on web, `expo/fetch` is `globalThis.fetch`, the browser's own.
- **Source** (`effect/src/http/FetchHttpClient.ts`, `HttpClientResponse.ts`): the Effect client the app already uses calls `globalThis.fetch` and builds the response stream from `response.body`. **Inferred**: the typed stream therefore works on all three platforms through `apps/app/src/api/client.ts` with no extra library. Not run on a device or simulator.

### Known limits per platform

- **Documented**: the SDK 57 page lists no limitations for `expo/fetch`. On native, `TextDecoder` is UTF-8 only, which is what SSE uses.
- **Source** (`expo/ios/Fetch/ExpoURLSessionTask.swift`): iOS sets `request.timeoutInterval = 0` on each request. **Inferred**: Expo does not impose its own request timeout on a long stream.
- **Source** (`expo/android/.../TransparentCompressionInterceptor.kt`): Android adds `Accept-Encoding: zstd, br, gzip` unless the caller sets that header. The backend does not compress responses today. **Inferred**: if a compressing layer is ever added in front of the API, exclude `text/event-stream`, because compression can hold events back.
- **Inferred**: when a phone app goes to the background the OS may suspend it and the connection will stall or drop. Treat backgrounding as a dropped connection.
- **Source** (`apps/app/src/api/client.ts`): `call()` turns one Effect into one promise for React Query. A stream needs a second helper that runs the stream inside the same runtime and pushes events into React state. The token refresh and one retry on `Unauthorized` still apply, because a `401` arrives before the stream starts.
- **Source** (`@tanstack/query-core` 5.104.2): `experimental_streamedQuery` exists. It is marked experimental and was not evaluated.

### EventSource

- **Documented** ([WHATWG HTML, server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html)): the constructor takes a URL and one option, `withCredentials`. It cannot send a request body or custom headers, and it always uses `GET`.
- **Source**: the app authenticates with an `Authorization: Bearer` header (`apps/app/src/api/client.ts`). **Inferred**: browser `EventSource` cannot call the API without putting the token in the URL.
- **Source**: React Native 0.86.3 ships no `EventSource`. A native app would need a third-party polyfill.
- **Inferred**: `EventSource` is a poor fit. The only thing it adds is automatic reconnection, and that only helps if the server can replay from `Last-Event-ID`.

## 3. Dropped connections

- **Documented** (WHATWG): SSE's own recovery is a browser `EventSource` feature. It reconnects, sends the `Last-Event-ID` header, and obeys the `retry:` field. Plain `fetch` does none of this.
- **Source** (`effect/src/encoding/Sse.ts`, `HttpApiClient.ts`): Effect's decoder surfaces a server `retry:` line as a `Sse.Retry` stream failure "so callers can reconnect". The `HttpApi` client does not reconnect and never sends `Last-Event-ID`. A dropped connection ends the stream with an `HttpClientError`.
- **Inferred**: recovery is therefore an application design, and re-sending the same `POST` is wrong because it would start a second answer. A workable shape:
  1. The `POST` creates the turn, saves it, and returns its id in the first event.
  2. The turn runs independently of the connection and saves the answer as it grows, or at least when it finishes.
  3. On a drop, the app reads the turn with an ordinary request and shows what is saved.
  4. If the turn is still running, the app either polls that request or opens a second streamed `GET` with "events after number N".

  Step 3 is needed anyway for conversation history. Step 4's streamed variant is optional polish.
- **Inferred**: if resumable streaming is wanted, keep the replay source in Postgres, not in process memory. The API can run on more than one Fly Machine and a reconnect may land on a different one.

## 4. Fly and Vercel

### Fly proxy

- **Documented** ([fly.toml reference](https://docs.fly.io/reference/configuration)): `[http_service.http_options] idle_timeout` exists ("Configure an idle-timeout for connections to your app", example value `600`). The page states no default or maximum. This repo does not set it.
- **Fly staff, community forum, 2021** ([thread](https://community.fly.io/t/60-second-timeout-for-http-server/1243)): "There is a 60 idle timeout. If no data is received or sent within 60 seconds, the connection will be closed", and it "resets when you send any data at all". The same post now begins "Edit: There isn't a idle timeout anymore." The edit is undated. **The current default is unverified.**
- **Fly staff, community forum, October 2026** ([thread](https://community.fly.io/t/fly-proxy-resets-a-stalled-http-stream-after-30s-on-edge-and-flycast-hops-http-options-idle-timeout-has-no-effect/28755)): the proxy sets `TCP_USER_TIMEOUT` to 30 s and it "isn't configurable". A connection whose peer stops reading for about 30 s is closed. The reporter saw the client left hanging with no close signal.
- **Documented** (WHATWG): proxies may drop quiet connections, and authors can send a comment line "every 15 seconds or so".
- **Inferred** from the three points above: send a heartbeat event every 10 to 15 seconds while the agent is silent, and give the app its own stall timer (for example, 30 to 45 s with no event means reconnect or fall back to reading the saved turn).
- **Not found**: any Fly statement that the proxy buffers response bodies. Fly's docs say the HTTP handler "sends HTTP 1.1 requests to the application process" ([services](https://docs.fly.io/networking/services)). Whether Fly compresses or buffers `text/event-stream` is unverified until a stream is run through the deployed API.

### Deploys and limits

- **Documented** (fly.toml reference): on deploy or stop, Fly sends `kill_signal`, waits up to `kill_timeout`, then stops the Machine. These are "best-effort".
- **Source** (`fly.toml`): `kill_signal = 'SIGTERM'`, `kill_timeout = '1m0s'`. **Inferred**: a stream in flight during a deploy is cut within a minute. Merging to `main` deploys, so this will happen in normal use, which is one more reason for the recovery path in section 3.
- **Source** (`fly.toml`): concurrency is `type = 'requests'` with `hard_limit = 250`. **Inferred**: each open stream counts as one in-flight request for its whole duration.

### Vercel

- **Source** (`vercel.json`): the web deploy is a static build with one rewrite to `/index.html`. The app calls the API at `EXPO_PUBLIC_API_URL`. **Inferred**: Vercel never proxies API traffic, so it cannot buffer or time out a stream.
- **Source** (`apps/backend/src/http/cors.ts`): CORS already allows the web origins with credentials. A streamed `POST` response needs nothing more.
- **Documented** ([Vercel limits](https://vercel.com/docs/limits)): if the API were ever put behind a Vercel rewrite, proxied requests have a 120 s timeout on every plan. Avoid that route for streams.

## Options, ranked

1. **SSE over `POST`, declared with `HttpApiSchema.StreamSse`, read with the existing typed client.** Recommended.
   - Typed end to end from one contract, including mid-stream failures.
   - No new dependency. Same code path on iOS, Android and web.
   - Needs: a heartbeat event, a stall timer in the app, the turn saved server-side, and a stream helper beside `call()`.
   - Risk: the Effect API is marked unstable, and device behaviour is unverified.
2. **Same as 1, plus a resumable `GET` stream of a turn's events after a cursor.** Add only if reading the saved turn on reconnect feels too abrupt. It needs events stored per turn in Postgres.
3. **No streaming: create the turn, then poll it.** Works everywhere with what exists today and is the fallback inside option 1. Text appears in steps, not as it is written, and each poll is a request.
4. **Chunked JSON lines with `StreamUint8Array`.** Works, but the contract types only bytes, so the event schema and failure handling are rebuilt by hand. No advantage over 1.
5. **`EventSource` (browser built-in, polyfill on native).** Cannot send the bearer token or a request body, needs a new native dependency, and its automatic reconnect only pays off with option 2's replay.

Not investigated: WebSockets and Effect's `rpc` module. Both can stream, but they sit outside the `HttpApi` contract the app is typed by, and the answer flows one way.

## Not verified

- The stream on a real iOS or Android build, including backgrounding and switching networks. Everything on-device is read from source and docs.
- Fly's live behaviour: the current default idle timeout, and whether the proxy buffers or compresses `text/event-stream`.
- Whether the Effect server lets in-flight streams finish on `SIGTERM`.
- Safari and Firefox. Only Node's `fetch` was run.

The first two are cheap to settle with a throwaway streamed endpoint on a preview Machine and a prototype screen under `apps/app/app/proto`.
