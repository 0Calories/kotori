import type {
  AddNoteRequest,
  CardId,
  EntryId,
  HowToSayRequest,
  Language,
  NaturalnessRequest,
  Note,
  NoteId,
  Rating,
  ReviewQueue,
  SpeakRequest,
  StudyStats
} from "@kotori/contracts"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queueWithoutNote, statsWithoutNote, withoutNote } from "../lib/collection.ts"
import { call } from "./client.ts"

export const keys = {
  health: ["health"] as const,
  search: (q: string, language: Language) => ["search", language, q] as const,
  entry: (id: number) => ["entry", id] as const,
  notes: ["notes"] as const,
  queue: ["queue"] as const,
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

export const useEntry = (id: number) =>
  useQuery({
    queryKey: keys.entry(id),
    queryFn: () => call((api) => api.dictionary.entry({ params: { id: id as EntryId } })),
    enabled: Number.isInteger(id) && id > 0,
    // While Kotori's worker is still enriching the entry, check back every few seconds.
    refetchInterval: (query) => {
      const enrichment = query.state.data?.enrichment
      return enrichment && Object.values(enrichment).includes("queued") ? 3000 : false
    }
  })

export const useNotes = () => useQuery({ queryKey: keys.notes, queryFn: () => call((api) => api.study.notes()) })

const useInvalidateStudy = () => {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: keys.notes })
    void client.invalidateQueries({ queryKey: keys.queue })
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
      // Drop the note before the refetch returns, so the collection, the queue
      // and the due counts move together. Cancel in-flight reads first: one that
      // started before the delete would put the note back.
      await Promise.all([
        client.cancelQueries({ queryKey: keys.notes }),
        client.cancelQueries({ queryKey: keys.queue }),
        client.cancelQueries({ queryKey: keys.stats })
      ])
      const notes = client.getQueryData<ReadonlyArray<Note>>(keys.notes)
      const note = notes?.find((row) => row.id === id)
      const queue = client.getQueryData<ReviewQueue>(keys.queue)
      if (notes !== undefined) client.setQueryData(keys.notes, withoutNote(notes, id))
      if (queue !== undefined) client.setQueryData(keys.queue, queueWithoutNote(queue, id))
      if (note !== undefined) {
        const stats = client.getQueryData<StudyStats>(keys.stats)
        if (stats !== undefined) client.setQueryData(keys.stats, statsWithoutNote(stats, note, queue))
      }
      invalidate()
    }
  })
}

export const useQueue = () =>
  useQuery({ queryKey: keys.queue, queryFn: () => call((api) => api.study.queue({ query: { limit: 100 } })) })

export const useStats = () => useQuery({ queryKey: keys.stats, queryFn: () => call((api) => api.study.stats()) })

export const useAnswer = () =>
  useMutation({
    mutationFn: (input: { readonly id: CardId; readonly rating: Rating; readonly durationMs: number }) =>
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

/** Asks the worker to add nuance, examples and audio to an entry that has none yet. */
export const useEnrich = (id: number) => {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => call((api) => api.dictionary.enrich({ params: { id: id as EntryId } })),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.entry(id) })
  })
}

export const useSpeak = () =>
  useMutation({ mutationFn: (request: SpeakRequest) => call((api) => api.audio.speak({ payload: request })) })
