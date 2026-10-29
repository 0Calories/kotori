import type {
  AddNoteRequest,
  CardId,
  EntryId,
  HowToSayRequest,
  NaturalnessRequest,
  NoteId,
  Rating,
  SpeakRequest
} from "@kotori/domain"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { call } from "./client.ts"

export const keys = {
  health: ["health"] as const,
  search: (q: string) => ["search", q] as const,
  entry: (id: number) => ["entry", id] as const,
  english: (term: string) => ["english", term] as const,
  notes: ["notes"] as const,
  queue: ["queue"] as const,
  stats: ["stats"] as const
}

export const useHealth = () =>
  useQuery({ queryKey: keys.health, queryFn: () => call((api) => api.health()), staleTime: 60_000 })

export const useSearch = (q: string) =>
  useQuery({
    queryKey: keys.search(q),
    queryFn: () => call((api) => api.dictionary.search({ query: { q, limit: 30 } })),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000
  })

export const useEntry = (id: number) =>
  useQuery({
    queryKey: keys.entry(id),
    queryFn: () => call((api) => api.dictionary.entry({ params: { id: id as EntryId } })),
    // While Kotori's worker is still enriching the entry, check back every few seconds.
    refetchInterval: (query) => {
      const enrichment = query.state.data?.enrichment
      return enrichment && Object.values(enrichment).includes("queued") ? 3000 : false
    }
  })

/** An English word for Japanese speakers, checked again while its examples are being written. */
export const useEnglish = (term: string) =>
  useQuery({
    queryKey: keys.english(term),
    queryFn: () => call((api) => api.dictionary.english({ query: { term } })),
    enabled: term.trim().length > 0,
    refetchInterval: (query) => (query.state.data?.waiting ? 3000 : false)
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
  const invalidate = useInvalidateStudy()
  return useMutation({
    mutationFn: (id: NoteId) => call((api) => api.study.removeNote({ params: { id } })),
    onSuccess: invalidate
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
