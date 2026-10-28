# Voice casting for pronunciation audio

> Agreed direction, 2026-10-28. Design only; nothing here has landed yet. Implement in the
> order under "Implementation order". The monorepo rearchitecture
> (`monorepo-rearchitecture.md`) moves `tts`, `nuance` and `ai` under `packages/ai` and the
> Pronouncer under `apps/backend/src/features/audio/`; this document uses today's paths and
> notes the target location where it matters.

## Goal

Replace the single fixed voice per language with a curated cast of voices, each described
by trait tags, and have the enrichment worker pick the voice that fits each sentence: a
measured middle-aged voice for a news-like formal line, a young friendly voice for banter,
a Kansai-ben speaker for a Kansai sentence. Headwords get several clean pronunciations
rather than one, so a learner hears more than one speaker.

The design is symmetric across languages. Today most register signal exists on the
Japanese side, but the English dictionary is planned to get the same enrichment for
Japanese natives learning English, and the cast, metadata and selector must not assume
otherwise. "Sentence" below means an example in either language.

Selection is cheap and reproducible: deterministic scoring over metadata we already store
decides most cases, and Jev (TypeSafe) breaks ties only when scoring leaves several voices
level. No Claude call is added to the audio path.

Non-goals for this iteration: user-selectable voices per sentence, voice settings
(stability, style) and ElevenLabs v3 audio tags. The data model leaves room for all three.

## Current state

- `packages/tts/src/ElevenLabs.ts` holds one voice id per language, from `KOTORI_VOICE_JA`
  and `KOTORI_VOICE_EN` or hardcoded defaults (Kyoko, Sarah). `synthesize(text, language)`
  sends only text, model and language.
- `packages/tts/src/Pronouncer.ts` voices the headword's kana reading and every example's
  `ja` (and `en` when `KOTORI_AUDIO_LANGUAGES` includes `en`). It never reads sentence or
  sense metadata. The cache key is `sha256(voiceId, model, language, text)`, so a per-clip
  voice already caches correctly once the key is built from the chosen voice.
- `entry_audio` has primary key `entryId`: one headword clip. `example_audio` has primary
  key `(exampleId, language)`: one clip per sentence per language. The first changes, the
  second stays.
- Signals that already exist but never reach TTS:
  - `examples.formality` (vulgar | casual | neutral | polite | formal), set by Claude.
  - `senses.misc[]`, `senses.dialects[]`, `senses.fields[]` raw JMDict codes
    (`ksb`, `osb`, `sl`, `col`, `arch`, `hon`, `hum`, `pol`, `male`, `fem`, `chn`, `vulg`...).
  - `sense_nuance`: formality, medium, keigo, gender, age, currency, connotation, cautions,
    each with confidence and source (`jmdict` or `jev`).

## Design

### 1. Voice tags and the casts

Each curated voice carries **trait tags**. Tags are grouped into dimensions; a voice has
exactly one tag from each single-valued dimension (gender, age, variety) and any number
from the multi-valued ones. Selection works on tags, so adding a voice never changes code,
and two voices can cover overlapping situations.

**Variety** is the regional variety of the language in the linguist's sense. It covers both
Japanese dialects (Kansai-ben differs in grammar and vocabulary) and national varieties of
English (mostly accent and spelling), without calling the latter "dialects". Each language
has its own list of varieties and its own default, which is the variety an unlabelled
sentence is read in: `standard` for Japanese, `american` for English.

```ts
// packages/tts/src/voices.ts (target: packages/ai/providers/elevenlabs/voices.ts)
export const VOICE_GENDERS = ["masculine", "feminine", "androgynous"]
export const VOICE_AGES    = ["child", "youth", "adult", "middle-aged", "older"]
export const VOICE_MEDIUMS = ["conversation", "announcement", "narration"]
export const VOICE_TONES   = ["warm", "bright", "calm", "serious", "rough", "gentle"]  // unused by scoring for now
export const VARIETIES = {
  ja: ["standard", "kansai", "tohoku", "kyushu"],
  en: ["american", "british", "australian"]
}
export const DEFAULT_VARIETY = { ja: "standard", en: "american" }

export interface VoiceTags<L extends Language> {
  readonly gender: VoiceGender                 // one
  readonly age: VoiceAge                       // one
  readonly variety: Variety<L>                 // one, typed by the voice's language
  readonly formality: ReadonlyArray<Formality> // registers it sounds right in
  readonly medium: ReadonlyArray<VoiceMedium>
  readonly tone: ReadonlyArray<VoiceTone>
  readonly headword: boolean                   // eligible as a dictionary voice
}

export interface Voice<L extends Language> {
  readonly id: string                 // stable Kotori id, e.g. "ja-kyoko"
  readonly language: L
  readonly providerId: string | null  // ElevenLabs voice id; null until the role is cast
  readonly name: string
  readonly tags: VoiceTags<L>
  /** One line for Jev and for humans: how this voice sounds and when to use it. */
  readonly description: string
}

export const JAPANESE_CAST: ReadonlyArray<Voice<"ja">>
export const ENGLISH_CAST: ReadonlyArray<Voice<"en">>
export const CASTS = { ja: JAPANESE_CAST, en: ENGLISH_CAST }
```

Each language has its own cast, so the two can grow independently and a voice can never be
tagged with another language's variety. Helpers `castVoices(language)` and
`headwordVoices(language)` return the voices that have a provider id.

Initial cast. Provider ids are chosen by auditioning the ElevenLabs library; the tags are
the contract. Each language is cast independently against the same tag vocabulary, so the
selector is one function for both.

Japanese:

| id | Tags | Notes |
|---|---|---|
| ja-kyoko | feminine, adult, standard, neutral, polite, conversation, narration, warm, headword | Today's default |
| ja-announcer | masculine, middle-aged, standard, polite, formal, announcement, narration, serious, headword | News, notices, business mail |
| ja-polite-f | feminine, adult, standard, polite, formal, conversation, gentle | Service counter, teineigo |
| ja-casual-f | feminine, youth, standard, casual, neutral, vulgar, conversation, bright | Banter, feminine speech |
| ja-casual-m | masculine, youth, standard, casual, neutral, vulgar, conversation, rough | Banter, masculine speech (ぜ/ぞ/おれ) |
| ja-casual-f2 | feminine, middle-aged, standard, casual, neutral, conversation, warm | Casual but not young; shows the tag model's reach |
| ja-kansai-m | masculine, adult, kansai, casual, neutral, polite, conversation | Audition community Kansai voices carefully |
| ja-elder-m | masculine, older, standard, neutral, polite, formal, narration, calm, headword | Proverbs, archaic and dated words |

English:

| id | Tags | Notes |
|---|---|---|
| en-sarah | feminine, adult, american, neutral, polite, conversation, narration, warm, headword | Today's default |
| en-announcer | masculine, middle-aged, american, polite, formal, announcement, narration, serious, headword | |
| en-casual-f | feminine, youth, american, casual, neutral, vulgar, conversation, bright | |
| en-casual-m | masculine, youth, american, casual, neutral, vulgar, conversation, rough | |
| en-british-m | masculine, adult, british, neutral, polite, formal, conversation, narration, calm, headword | Variety coverage for the English dictionary |
| en-elder-f | feminine, older, american, neutral, polite, narration, gentle | |

The cast lives in code, not env vars. `KOTORI_VOICE_JA` / `KOTORI_VOICE_EN` are removed;
`.env.example` and `docs/operations.md` are updated. A `KOTORI_VOICE_CAST` JSON override
can come later if a deployment needs a different cast.

### 2. Sentence metadata from Claude

The example prompt (`packages/ai/src/prompts.ts`, `examplesSystem`) already labels
formality. It gains four more fields per sentence, written at generation time for near-zero
marginal cost. They are language-neutral and will apply unchanged to English examples.

```ts
speaker: { gender: "masculine" | "feminine" | "unspecified", age: "child" | "youth" | "adult" | "middle-aged" | "older" | "unspecified" }
medium:  "conversation" | "announcement" | "narration"
variety: string | null     // "kansai", "british"...; null for the default variety
tone:    "neutral" | "cheerful" | "serious" | "gentle" | "rough"
```

Prompt additions:

- "speaker": who would plausibly say this line; unspecified when the sentence gives no hint.
- "medium": conversation (someone talking to someone), announcement (news, notices, public
  address, business mail read aloud) or narration (prose, proverbs, descriptions).
- "variety": the regional variety the sentence is written in, or null for the default one.
- "tone": the dominant feel of the delivery. Stored for later voice settings, not used for
  selection yet.
- **Dialect rule:** the request lists a sense's JMDict dialect tags (Kansai-ben, Osaka-ben,
  Tohoku-ben...) on their own `dialect:` line, apart from the other notes, and the prompt
  says to write every example for that sense *in* that dialect, not in the standard
  language, and to label it. The writer lowercases the label and strips suffixes like
  "-ben" and "dialect" so "Kansai-ben" and "kansai" store the same variety. This fixes dialect at generation, so a Kansai voice never reads a
  Tokyo sentence.

`ExamplesOutput`, `WrittenExample` and the `examples` table gain matching columns:
`speakerGender`, `speakerAge`, `medium`, `variety`, `tone`, nullable so existing rows stay
valid. One migration in `packages/db/migrations/`.

### 3. The selector

Two pure functions, fully unit-tested, no I/O:

```ts
// packages/tts/src/casting.ts (target: features/audio/casting.ts)

/**
 * A casting brief: the kind of speaker a sentence calls for, independent of
 * language. Derived once per sentence and used to cast both its Japanese and
 * its English clip, so the two land on matching speakers.
 */
export interface CastingBrief {
  readonly variety: Variety | null             // hard; null means the language's default
  readonly gender: "masculine" | "feminine" | null
  readonly age: VoiceAge | null
  readonly formality: Formality
  readonly medium: VoiceMedium | null
  readonly slang: boolean
  readonly archaic: boolean
}

export const briefFor = (input: {
  sentence: SentenceSignals    // formality plus the new example columns
  sense: { misc: string[]; dialects: string[]; fields: string[] }
  nuance: Nuance | null
}): CastingBrief

/** Cast voices of `language` ranked by fit against the brief. */
export const rank = (brief: CastingBrief, language: Language, casts = CASTS): ReadonlyArray<{ voice: Voice; score: number }>

/** The top voices scoring could not separate; more than one means Jev decides. */
export const tied = (ranked): ReadonlyArray<{ voice: Voice; score: number }>
```

`briefFor` merges the signals, most specific first:

- variety: sentence `variety` → sense `dialects` (`ksb`/`osb`/`kyb` → kansai, `thb` →
  tohoku, `kyu` → kyushu) → null.
- gender: sentence `speakerGender` → misc `male`/`fem` → nuance gender at confidence ≥ 0.6.
- age: sentence `speakerAge` → misc `chn` → child; nuance age youth/older.
- medium: sentence `medium`; else formality `formal` with nuance medium `written` or a
  non-empty `fields[]` → announcement.
- slang: formality `vulgar`, misc `sl`/`vulg`, or nuance `cautions.slang`.
- archaic: misc `arch`/`dated` or nuance currency archaic/dated.

`rank` scores each cast voice of the language:

1. **Hard filter.** The voice's variety must equal the brief's; when the brief has none, the
   voice must carry the language's default variety, so `british` and `kansai` voices are
   reached only when asked for. A voice whose `formality` tags do not include the sentence
   formality is dropped unless that would drop everyone.
2. **Score.** Start at 0. Gender match +3, mismatch −3 (androgynous counts as a half match,
   +1). Age exact +2, adjacent (youth/adult, adult/middle-aged, middle-aged/older) +1,
   otherwise −1. Medium tag present +2. Slang in the brief and voice has `vulgar` or
   `casual` +1; archaic in the brief and the voice is `older` +1 (narration is already
   rewarded by the medium match). Formality in the voice's tags +1 on top of the filter, so a
   voice that lists it explicitly beats one let through by the fallback.
3. **Result.** Sorted by score. Voices within 1 point of the top form the tie set (`tied`).

Weights are constants at the top of the file with a comment on each; tuning them is the
expected way to adjust behaviour. Because the English and Japanese clips of one sentence
are ranked from the same brief, they land on matching speakers without any cross-language
mapping.

### 4. Jev as the tiebreaker

When the tie set has two or more voices, one Jev call picks among them. This is cheap (Jev
is already called several times per sense for nuance) and fits better than chance. It is
only reached when scoring is undecided; the selector logs how often, so weights can be
tightened if the ratio is high.

```ts
// packages/nuance/src/casting.ts
export interface VoiceCandidate { id: string; description: string }  // no dependency on the voice domain

export const castVoice = (
  jev: Jev["Service"],
  input: { sentence: string; meaning: string; candidates: ReadonlyArray<VoiceCandidate> }
): Effect.Effect<{ voiceId: string; confidence: number }, JevError>
// One choice question: "Which voice should read `sentence` aloud (translation in `meaning`)
// so it sounds like the person who would really say it?" — one criterion per candidate,
// keyed by voice id, described by the cast's description line.
```

Fallbacks, in order: Jev not configured → highest-scored voice, then cast order. Jev
error → warning and the same fallback; an audio job never fails over a tiebreak. Below `CAST_CONFIDENCE_FLOOR`
(0.4) → still take Jev's answer, but log it, so weak calls are visible in
the regen workflow.

### 5. Headwords: several voices

Headwords are short, so extra clips are nearly free against the character budget, and
hearing a word from more than one speaker is better for learners than one canonical voice.

- `entry_audio` becomes `(entryId, audioKey)` primary key, so an entry links to several
  clips. The voice comes from the joined `audio` row rather than a duplicate column.
- `enrichEntry` voices the kana reading (ja) with every cast voice tagged `headword` for the
  entry's language. The initial casts above give 3 per language. `KOTORI_HEADWORD_VOICES`
  (default 3) caps the count, taking cast order.
- The API's entry payload gains `audio: Array<{ url, voice, voiceName }>`. `audioUrl` stays
  as the first clip until the app plays from the list (step 6), then goes. The client plays a
  random one on each tap for now; a long-press or settings option to pin a voice is a
  follow-up, which is why name and id are in the payload.
- Readings with reading-specific JMDict info (`ok`, `ik`, `sk`) keep today's behaviour of
  voicing only the primary reading.

### 6. Storing the casting

- `audio.voiceId` already records the concrete provider id for every clip. It now also gets
  a `voice` column with the Kotori voice id (`ja-casual-m`), so recasting a provider voice
  keeps history readable.
- `example_audio` gains `castBy: "rules" | "jev" | "manual"` and `score`, nullable, for
  debugging and `regen --dry-run` comparisons.
- The cache key stays `sha256(providerVoiceId, model, language, text)` with the chosen
  voice. Existing Kyoko and Sarah keys are unchanged, so the migration re-synthesises
  nothing.

### 7. Pronouncer changes

`packages/tts/src/ElevenLabs.ts`

- `synthesize(text, language, providerVoiceId)`; `voiceFor(language)` is removed. Retry,
  error mapping and output format are unchanged.

`packages/tts/src/Pronouncer.ts`

- `speak(text, language, voice: Voice)` builds the key from `voice.providerId`, checks the
  cache and budget, synthesises and saves `voiceId` and `voice`.
- `speakDefault(text, language)` keeps Coaching's `/speak` working: it uses the first
  `headword` voice of the language. Coaching can pass a `CastingBrief` later if it wants cast
  phrases.
- `enrichEntry` loads senses (`misc`, `dialects`, `fields`), nuance via `nuanceFor`, and
  examples with the new columns, once per entry. For each example it computes the brief,
  ranks each configured language, calls Jev on ties, voices and links with
  `linkExampleAudio(id, language, key, { castBy, score })`. Headwords follow section 5.
- `EnrichmentRepo`: `examplesFor` returns the new columns; `linkExampleAudio` takes the
  casting record; `linkEntryAudio` appends rather than replaces.

Existing audio is left as it is. New enrichment (API-triggered or `kotori enrich audio`)
uses casting from the day it lands. The regen command below covers anything we want to
redo.

### 8. CLI: `kotori audio`

A new command group in `apps/worker/src/commands/audio.ts` (target: `apps/backend/src/cli/`),
registered next to `enrich`.

```
kotori audio regen --example 123 [--example 456 ...]   re-voice these examples
kotori audio regen --entry 1234567                     every example and the headword clips of an entry
kotori audio regen --headword 1234567                  only the headword clips
kotori audio regen ... --voice ja-casual-m             force a cast voice by Kotori id
kotori audio regen ... --provider-voice <elevenlabs id> force any ElevenLabs voice, cast or not (auditioning)
kotori audio regen ... --language ja|en                one side only (default: all configured)
kotori audio regen ... --dry-run                       print the brief, ranking, Jev's pick and cost; change nothing
kotori audio show --example 123 | --entry 1234567      current clips: voice, provider id, key, castBy, score, created at
kotori audio voices [--language ja]                    list the cast with tags
```

Behaviour:

- Runs the same `briefFor` → `rank` → Jev path as the worker, so `--dry-run` shows exactly what
  enrichment would do. `--voice` and `--provider-voice` bypass both and record
  `castBy = manual`. `--provider-voice` is for auditioning candidates before adding them to
  the cast; the clip is stored with `voice = null`.
- Always synthesises fresh: the old link is replaced, and the old `audio` row is deleted when
  nothing else references it. Deleting the row cascades to `audio_files`.
- Charges the monthly budget like any other clip and refuses with the usual quota error when
  over.
- Output is one line per clip: target, language, voice, provider id, characters, `cached` or
  `synthesised`.

`kotori status` gains clip counts per voice, so an uneven cast is visible.

### 9. UI

`AudioButton` accepts a list of clips and plays a random one on tap. Example audio still
passes one. No other change this iteration; a later change can show the voice name or let
the learner pin or reroll a voice, which is why `voice` is stored and returned.

## Testing

- `casting.test.ts`: table-driven. `briefFor`: Kansai from sentence label, Kansai from `ksb`
  with no label, `fem` misc pins feminine, `chn` → child, fields + formal → announcement,
  slang and archaic flags. `rank`: variety filter never relaxed, formality filter relaxed
  only when it would empty the list, gender and age weights produce the intended winner for
  a formal announcement, a vulgar banter line, a proverb, and a Kansai sentence; ja and en
  ranked from one brief pick matching-trait voices; tie set uses the 1-point window.
- Jev tiebreak: stub Jev returning each candidate; failing Jev falls back to the top score.
- `pronouncer.test.ts`: key uses the chosen provider id; headword gets N clips capped by
  `KOTORI_HEADWORD_VOICES`; `castBy`/`score` persisted; existing Kyoko and Sarah keys stable.
- Prompt: snapshot of the new `examplesSystem`; `ExamplesOutput` decodes with and without the
  new fields.
- CLI: `--dry-run` makes no writes; `--voice` and `--provider-voice` skip Jev and record
  manual; regen replaces links and removes orphaned clips.

## Implementation order

1. Tag vocabulary, cast and selector as pure code (`voices.ts`, `casting.ts`) with tests.
   No behaviour change yet.
2. Migration: new `examples` columns, `audio.voice`, `example_audio` casting columns,
   `entry_audio` composite key. Schema, repo, codecs, API entry payload.
3. Prompt and `ExamplesOutput` changes, including the write-in-dialect rule.
4. Jev `castVoice` question and the tiebreak path.
5. `ElevenLabs.synthesize` with a provider voice id, Pronouncer wiring, multi-voice
   headwords, env cleanup, docs.
6. `AudioButton` random pick over several clips.
7. `kotori audio regen | show | voices`; `status` per-voice counts.
8. Cast the remaining voices on ElevenLabs with `regen --provider-voice`, fill in ids and
   tags, and audition each with a handful of sentences.

## Open points

- Kansai voice quality on ElevenLabs is the main unknown. If no voice convinces, drop the
  `kansai` voice from the Japanese cast and the hard filter falls back to standard voices while
  sentences stay labelled; adding a voice later is a data change.
- A `child` voice is deferred until `status` shows how often `chn` and
  `speakerAge = child` occur.
- `tone` is stored but unused. Mapping it to ElevenLabs `voice_settings` or v3 audio tags
  changes the cache key, so it should land as its own decision.
- Scoring weights are a first guess. Expect to tune them from `--dry-run` output over the
  first few hundred entries.
