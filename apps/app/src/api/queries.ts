import type {
  AddNoteRequest,
  Enrichment,
  EntryId,
  HowToSayRequest,
  Language,
  NaturalnessRequest,
  DueNotes,
  Note,
  NoteId,
  Proposal,
  Rating,
  SpeakRequest,
  StudyStats
} from "@kotori/contracts"
import { keepPreviousData, useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef } from "react"
import type { AskAttempt } from "../lib/ask.ts"
import { dueWithoutNote, statsWithoutNote, withoutNote } from "../lib/deck.ts"
import {
  enrichmentPhase,
  POLL_MS,
  pollInterval,
  progressKey,
  shouldAsk,
  shouldRefresh,
  writingExamples
} from "../lib/enrichment.ts"
import { call } from "./client.ts"

export const keys = {
  health: ["health"] as const,
  search: (q: string, language: Language) => ["search", language, q] as const,
  asks: ["asks"] as const,
  /** Asks of one query, by the key the server keeps its answer under (`normalizeAsk`). */
  ask: (language: Language, key: string) => ["ask", language, key] as const,
  entry: (id: number) => ["entry", id] as const,
  /**
   * How an entry's enrichment is coming along. Its own root, not under `entry`: refetching the
   * entry doesn't refetch progress, and polling progress doesn't refetch the entry.
   */
  enrichment: (id: number) => ["enrichment", id] as const,
  notes: ["notes"] as const,
  due: ["due"] as const,
  stats: ["stats"] as const
}

export const useHealth = () =>
  useQuery({ queryKey: keys.health, queryFn: () => call((api) => api.health()), staleTime: 60_000 })

/** Searches the dictionary of the language being learned, which the server reads from the profile. */
export const useSearch = (q: string, language: Language) =>
  useQuery({
    queryKey: keys.search(q, language),
    queryFn: () => call((api) => api.dictionary.search({ query: { q, limit: 30 } })),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000
  })

/** The learner's own Ask Kotori answers, so a past ask shows again without asking again. */
export const useAsks = () =>
  useQuery({ queryKey: keys.asks, queryFn: () => call((api) => api.dictionary.asks()), staleTime: 60_000 })

/**
 * Asks Kotori about a search the dictionary couldn't answer. The answer joins the learner's asks
 * before the ask settles, so it shows from there whether or not the asking screen is still up.
 */
export const useAsk = (language: Language, key: string) => {
  const client = useQueryClient()
  return useMutation({
    mutationKey: keys.ask(language, key),
    mutationFn: (q: string) => call((api) => api.dictionary.ask({ payload: { q } })),
    onSuccess: (proposal: Proposal) => {
      client.setQueryData<ReadonlyArray<Proposal>>(keys.asks, (asks = []) => [
        proposal,
        ...asks.filter((past) => past.id !== proposal.id)
      ])
    }
  })
}

/**
 * The latest ask of a query, wherever it was sent from: a screen that remounts, or a search
 * typed away from and back to, still finds the ask in flight or how it ended.
 */
export const useLatestAsk = (language: Language, key: string): AskAttempt | undefined =>
  useMutationState({
    filters: { mutationKey: keys.ask(language, key), exact: true },
    select: (mutation): AskAttempt => ({
      status: mutation.state.status,
      error: mutation.state.error,
      data: mutation.state.data as Proposal | undefined,
      submittedAt: mutation.state.submittedAt
    })
  }).at(-1)

/** An entry as last fetched. It doesn't poll: `useEntryEnrichment` waits for its examples and audio. */
export const useEntry = (id: number) =>
  useQuery({
    queryKey: keys.entry(id),
    queryFn: () => call((api) => api.dictionary.entry({ params: { id: id as EntryId } })),
    enabled: Number.isInteger(id) && id > 0
  })

export const useNotes = () => useQuery({ queryKey: keys.notes, queryFn: () => call((api) => api.study.notes()) })

const useInvalidateStudy = () => {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: keys.notes })
    void client.invalidateQueries({ queryKey: keys.due })
    void client.invalidateQueries({ queryKey: keys.stats })
  }
}

export const useAddNote = () => {
  const invalidate = useInvalidateStudy()
  return useMutation({
    mutationFn: (request: AddNoteRequest) => call((api) => api.study.addNote({ payload: request })),
    onSuccess: invalidate
  })
}

export const useRemoveNote = () => {
  const client = useQueryClient()
  const invalidate = useInvalidateStudy()
  return useMutation({
    mutationFn: (id: NoteId) => call((api) => api.study.removeNote({ params: { id } })),
    onSuccess: async (_result, id) => {
      // Drop the note before the refetch returns, so the deck, the due notes
      // and the due counts move together. Cancel in-flight reads first: one that
      // started before the delete would put the note back.
      await Promise.all([
        client.cancelQueries({ queryKey: keys.notes }),
        client.cancelQueries({ queryKey: keys.due }),
        client.cancelQueries({ queryKey: keys.stats })
      ])
      const notes = client.getQueryData<ReadonlyArray<Note>>(keys.notes)
      const note = notes?.find((row) => row.id === id)
      const due = client.getQueryData<DueNotes>(keys.due)
      if (notes !== undefined) client.setQueryData(keys.notes, withoutNote(notes, id))
      if (due !== undefined) client.setQueryData(keys.due, dueWithoutNote(due, id))
      if (note !== undefined) {
        const stats = client.getQueryData<StudyStats>(keys.stats)
        if (stats !== undefined) client.setQueryData(keys.stats, statsWithoutNote(stats, note, due))
      }
      invalidate()
    }
  })
}

export const useDueNotes = () =>
  useQuery({ queryKey: keys.due, queryFn: () => call((api) => api.study.due({ query: { limit: 100 } })) })

export const useStats = () => useQuery({ queryKey: keys.stats, queryFn: () => call((api) => api.study.stats()) })

export const useAnswer = () =>
  useMutation({
    mutationFn: (input: { readonly id: NoteId; readonly rating: Rating; readonly durationMs: number }) =>
      call((api) =>
        api.study.answer({ params: { id: input.id }, payload: { rating: input.rating, durationMs: input.durationMs } })
      )
  })

export const useNaturalness = () =>
  useMutation({
    mutationFn: (request: NaturalnessRequest) => call((api) => api.coach.naturalness({ payload: request }))
  })

export const useHowToSay = () =>
  useMutation({ mutationFn: (request: HowToSayRequest) => call((api) => api.coach.howToSay({ payload: request })) })

/**
 * Asks Kotori to add example sentences and audio to an entry. Its answer is the latest progress,
 * so polling starts from it rather than with a read of its own.
 */
const useEnrich = (id: number) => {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => call((api) => api.dictionary.enrich({ params: { id: id as EntryId } })),
    onSuccess: (enrichment: Enrichment) => client.setQueryData(keys.enrichment(id), enrichment)
  })
}

/**
 * Waits for an open entry's examples and audio. When the entry shows something on its way, this
 * opening asks for it once (asking may be charged to the learner). Once the ask goes through, the
 * small progress read is polled rather than the entry, and the entry is fetched once more each
 * time progress moves past what it shows. A refused or failed ask stops there: nothing is polled.
 *
 * `onScreen` is the enrichment the entry on screen carries. `settled` is whether the entry is not
 * being fetched, so a stale copy cached from an earlier visit doesn't decide whether to ask.
 */
export const useEntryEnrichment = (id: number, onScreen: Enrichment | undefined, settled: boolean) => {
  const client = useQueryClient()
  const enrich = useEnrich(id)
  const { mutate } = enrich
  // Refs outlive re-renders and StrictMode's second run of an effect, so the ask goes once.
  const askedFor = useRef<number | null>(null)
  const refreshedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!shouldAsk({ id, onScreen, settled, askedFor: askedFor.current })) return
    askedFor.current = id
    mutate()
  }, [id, onScreen, settled, mutate])

  const progress = useQuery({
    queryKey: keys.enrichment(id),
    queryFn: () => call((api) => api.dictionary.enrichment({ params: { id: id as EntryId } })),
    enabled: enrich.isSuccess,
    // The ask's answer is the first reading, so the first poll is due one interval after it.
    staleTime: POLL_MS,
    // A failed poll keeps the last reading, and the next interval is its retry.
    retry: false,
    refetchInterval: (query) => pollInterval(query.state.data ?? onScreen)
  })
  // A reading cached from an earlier visit says nothing about this one.
  const latest = enrich.isSuccess ? progress.data : undefined

  useEffect(() => {
    if (onScreen === undefined || !shouldRefresh(onScreen, latest, refreshedFor.current)) return
    refreshedFor.current = latest === undefined ? null : progressKey(latest)
    void client.invalidateQueries({ queryKey: keys.entry(id), exact: true })
  }, [client, id, onScreen, latest])

  const phase = onScreen === undefined ? "settled" : enrichmentPhase(onScreen, latest, enrich)
  return {
    phase,
    /** Whether the page says Kotori is writing example sentences. */
    writing: onScreen !== undefined && writingExamples(phase, onScreen, latest),
    /** Asks again: the entry's ask button, and the retry after a failed ask. */
    ask: () => mutate(),
    asking: enrich.isPending,
    asked: enrich.isSuccess,
    error: enrich.error,
    /** A poll failed: the last reading stands, and the next interval tries again. */
    pollFailed: enrich.isSuccess && progress.isError,
    retryPoll: () => void progress.refetch()
  }
}

export const useSpeak = () =>
  useMutation({ mutationFn: (request: SpeakRequest) => call((api) => api.audio.speak({ payload: request })) })
