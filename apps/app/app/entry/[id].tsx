// PROTOTYPE: the entry page drawn as the Perch design (`src/proto/EntryPerch.tsx`); `/proto/entry`
// shows the same page on sample words without the API.
import type { Language, Sense } from "@kotori/contracts"
import { Link, useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import { Platform, Share } from "react-native"
import { useAddNote, useEnrich, useEntry, useNotes, useRemoveNote } from "../../src/api/queries.ts"
import { Notice } from "../../src/components/Notice.tsx"
import { PressableScale } from "../../src/components/PressableScale.tsx"
import { removalErrorText, RemoveNoteDialog } from "../../src/components/RemoveNote.tsx"
import { Header, Screen } from "../../src/components/Screen.tsx"
import { ErrorState, MascotMessage } from "../../src/components/States.tsx"
import { hasKotoriContent, saveDetails } from "../../src/lib/entry.ts"
import { wordNote } from "../../src/lib/notes.ts"
import { entryIdFromParam, entrySourcesHref } from "../../src/lib/sources.ts"
import { PerchEntry, SourcesLine } from "../../src/proto/EntryPerch.tsx"
import { useSession } from "../../src/session/SessionProvider.tsx"

/** Web browsers without the Web Share API can't share, so the button is left out there. */
const canShare = Platform.OS !== "web" || (typeof navigator !== "undefined" && "share" in navigator)

/** Glosses run together as their language lists them: "to eat; to dine", "食べる、食事をする". */
const glossSeparator = (language: Language) => (language === "ja" ? "; " : "、")

export default function EntryScreen() {
  const { t } = useSession()
  const router = useRouter()
  const { id: rawId } = useLocalSearchParams<{ id?: string | string[] }>()
  const id = entryIdFromParam(rawId)
  const entry = useEntry(id ?? 0)
  const notes = useNotes()
  const addNote = useAddNote()
  const removeNote = useRemoveNote()
  const enrich = useEnrich(id ?? 0)
  const [removingSense, setRemovingSense] = useState<number | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const back = () => (router.canGoBack() ? router.back() : router.replace("/"))

  // A failed refetch (one of the polls while the entry is being enriched, say) keeps the entry
  // already loaded, with a notice until a later one succeeds. Only a failed first load has nothing to show.
  if (id === null || entry.isLoadingError) {
    return (
      <Screen bottomInset={40} header={<Header onBack={back} />}>
        <ErrorState error={entry.error} onRetry={id === null ? undefined : () => entry.refetch()} />
      </Screen>
    )
  }
  if (!entry.data) {
    return (
      <Screen bottomInset={40} header={<Header onBack={back} />}>
        <MascotMessage mood="thinking" />
      </Screen>
    )
  }

  const data = entry.data
  const language = data.language
  const savedSenses = new Set(
    (notes.data ?? []).flatMap((note) =>
      note.content.kind === "word" && note.content.entryId === data.id ? [note.content.senseIndex] : []
    )
  )
  const savedNote = (senseIndex: number) =>
    (notes.data ?? []).find(
      (note) =>
        note.content.kind === "word" && note.content.entryId === data.id && note.content.senseIndex === senseIndex
    )
  const beginRemove = (senseIndex: number) => {
    setRemoveError(null)
    setRemovingSense(senseIndex)
  }
  const confirmRemove = async () => {
    if (removingSense === null || removeNote.isPending) return
    const note = savedNote(removingSense)
    if (note === undefined) {
      setRemovingSense(null)
      return
    }
    setRemoveError(null)
    try {
      await removeNote.mutateAsync(note.id)
      setRemovingSense(null)
    } catch (error) {
      setRemoveError(removalErrorText(t, error))
    }
  }
  const save = (sense: Sense) =>
    addNote.mutate({
      content: wordNote({
        entryId: data.id,
        language,
        sense: sense.index,
        headword: data.headword,
        reading: data.reading,
        glosses: sense.glosses,
        ...saveDetails(t, data, sense),
        example: sense.examples[0],
        audioUrl: data.audioUrl
      })
    })
  const reading = data.reading.length > 0 && data.reading !== data.headword ? data.reading : null
  const share = () =>
    Share.share({
      message: `${data.headword}${reading === null ? "" : language === "ja" ? `（${reading}）` : ` ${reading}`} ${
        data.senses[0]?.glosses.slice(0, 3).join(glossSeparator(language)) ?? ""
      }`
    }).catch(() => {})
  const waiting = data.enrichment.examples === "queued"

  return (
    <PerchEntry
      data={data}
      savedSenses={savedSenses}
      onToggleSave={(sense) => (savedSenses.has(sense.index) ? beginRemove(sense.index) : save(sense))}
      saveBusy={addNote.isPending || removeNote.isPending}
      onBack={back}
      onShare={canShare ? share : undefined}
      onOpen={(target) => router.push({ pathname: "/entry/[id]", params: { id: String(target) } })}
      waiting={waiting}
      plain={!hasKotoriContent(data) && !waiting}
      ask={{ pending: enrich.isPending, done: enrich.isSuccess, onPress: () => enrich.mutate() }}
      sources={
        <Link href={entrySourcesHref(data.id)} asChild>
          <PressableScale accessibilityRole="link" hitSlop={8} style={{ alignSelf: "flex-start" }}>
            <SourcesLine data={data} />
          </PressableScale>
        </Link>
      }
      notices={
        entry.isRefetchError ? (
          <Notice
            message={t.common.notRefreshed}
            action={{ label: t.common.retry, onPress: () => void entry.refetch() }}
          />
        ) : null
      }
      overlay={
        <RemoveNoteDialog
          note={removingSense === null ? undefined : savedNote(removingSense)}
          busy={removeNote.isPending}
          error={removeError}
          onConfirm={() => void confirmRemove()}
          onCancel={() => {
            setRemovingSense(null)
            setRemoveError(null)
          }}
        />
      }
    />
  )
}
