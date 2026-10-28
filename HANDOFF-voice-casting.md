# Handoff: voice casting — remaining work (steps 6–8)

> Temporary note, 2026-10-28. Delete once the work lands. The authoritative design is
> `docs/voice-casting.md`; this records where the backend implementation stopped and the
> details the remaining steps need.

## State of the branch

Steps 1–5 of `docs/voice-casting.md` are implemented and committed on
`hfi/a194c488-0c52-44f2-a353-1bc41c88b3d9/oak` (commits `881f213..728622b`). Backend is
complete: tag vocabulary and casts (`packages/tts/src/voices.ts`), pure selector
(`casting.ts`: `briefFor` → `rank` → `tied`), Claude writes casting signals per example,
Jev tiebreaker (`packages/nuance/src/casting.ts`, `castVoice`), and the Pronouncer casts
per sentence, voices headwords with every dictionary voice (capped by
`KOTORI_HEADWORD_VOICES`, default 3), and records `castBy`/`score` on `example_audio`.
Migration `20261028181415_voice_casting` has NOT been applied anywhere yet; `kotori
migrate` runs it.

All tests pass (`pnpm test`), typecheck and lint are clean. No audio has been generated
under the new system; Kotori is not live, so nothing needs regenerating wholesale.

## Remaining: step 6 — app plays one of several headword clips

- The entry payload already returns `audio: Array<{ url, voice, voiceName }>`
  (`packages/domain/src/Dictionary.ts`, `EntryAudio`), assembled in
  `apps/api/src/services/Dictionary.ts`. `audioUrl` still carries the first clip for
  compatibility — remove it (from `Entry`, the assembly, and the app) once the app reads
  `audio`.
- Change `apps/app/src/components/AudioButton.tsx` to accept a list of clips and pick one
  at random per tap. Entry screen: `apps/app/app/entry/[id].tsx` (headword button around
  line 466). Example and review usages keep passing a single clip.
- `voice`/`voiceName` are in the payload for a later "show the speaker / pin a voice" UI;
  nothing to do with them in step 6.
- Note: `voiceName` resolution in `Dictionary.ts` looks up `CASTS.ja` only — fine while
  headwords are Japanese; generalize when English headword audio exists.

## Remaining: step 7 — `kotori audio` CLI

New command group, spec in `docs/voice-casting.md` section 8. Implementation notes:

- Register next to `enrich` in `apps/worker/src/commands/` (pattern: `enrich.ts`, wired in
  the worker CLI; `pnpm kotori …` runs it).
- `regen` must run the same path as the worker: build the brief exactly as
  `Pronouncer.enrichEntry` does, call `rank`/`tied`/`castVoice`. The decide logic lives
  inside `Pronouncer.layer` (`decide` closure in `packages/tts/src/Pronouncer.ts`) — either
  export a `regenExample`/`regenHeadwords` method on the Pronouncer service (preferred;
  keeps `decide` private) or extract `decide` to a shared module.
- `--voice <kotori-id>` resolves from `CASTS`; `--provider-voice <elevenlabs-id>` builds an
  ad-hoc `Voice` with `voice: null` recorded on the `audio` row (for auditioning
  candidates). Both record `castBy: "manual"` via `linkExampleAudio`'s casting argument.
- "Always synthesises fresh": delete the old `audio` row when no other `entry_audio` /
  `example_audio` row references it (cascade removes `audio_files`); needs a small
  EnrichmentRepo method (`deleteOrphanAudio(key)` or similar) — none exists yet.
- `--dry-run` should print the brief, the ranking with scores, and Jev's pick without
  writes; budget checks still apply to real runs (reuse `Pronouncer.speak`'s quota path).
- `kotori status` (apps/worker/src/commands/status.ts) gains clip counts per `audio.voice`.

## Remaining: step 8 — cast the voices

- Every voice except `ja-kyoko` and `en-sarah` has `providerId: null` in
  `packages/tts/src/voices.ts`. Casting = audition on ElevenLabs, paste the id, done; the
  selector skips uncast voices (`rank` filters `providerId !== null`) and `rank` falls back
  to standard-variety voices when a wanted variety has no cast voice, so partial casting is
  safe at every point.
- Audition flow once step 7 exists: `kotori audio regen --example N --provider-voice <id>`.
- Kansai quality is the flagged risk; see "Open points" in the design doc.

## Watch-outs discovered during implementation

- `entry_audio` ordering ties: clips created in the same millisecond order by key, not
  insertion — don't assume Kyoko is first in the `audio` array.
- The casts are read through the `VoiceCasts` context reference
  (`packages/tts/src/Pronouncer.ts`), defaulting to `CASTS`; tests override it with a
  fully-cast lineup (see `packages/tts/test/pronouncer.test.ts`). The CLI should read the
  same reference so `--dry-run` matches the worker.
- `castVoice` self-guards: 1 candidate → returned without a Jev call; 0 → defect.
- The monorepo rearchitecture (`docs/monorepo-rearchitecture.md`) will move these files;
  target locations are noted inline in `docs/voice-casting.md`.
