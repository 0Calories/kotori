import type {
  AddNoteRequest,
  EntryId,
  HowToSayRequest,
  Language,
  NaturalnessRequest,
  Note,
  NoteId,
  Proposal,
  SpeakRequest
} from "@kotori/contracts"
import { keepPreviousData, useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query"
import type { AskAttempt } from "../lib/ask.ts"
import { onItsWay } from "../lib/entry.ts"
import { call } from "./client.ts"

export const keys = {
  health: ["health"] as const,
  search: (q: string, language: Language) => ["search", language, q] as const,
  asks: ["asks"] as const,
  ask: (language: Language, key: string) => ["ask", language, key] as const,
  entry: (id: number) => ["entry", id] as const,
  notes: ["notes"] as const
}

export const useHealth = () =>
  useQuery({ queryKey: keys.health, queryFn: () => call((api) => api.health()), staleTime: 60_000 })

export const useSearch = (q: string, language: Language) =>
  useQuery({
    queryKey: keys.search(q, language),
    queryFn: () => call((api) => api.dictionary.search({ query: { q, limit: 30 } })),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000
  })

export const useAsks = () =>
  useQuery({ queryKey: keys.asks, queryFn: () => call((api) => api.dictionary.asks()), staleTime: 60_000 })

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

export const useEntry = (id: number) =>
  useQuery({
    queryKey: keys.entry(id),
    queryFn: () => call((api) => api.dictionary.entry({ params: { id: id as EntryId } })),
    enabled: Number.isInteger(id) && id > 0,
    refetchInterval: (query) => {
      const enrichment = query.state.data?.enrichment
      return enrichment && Object.values(enrichment).some(onItsWay) ? 3000 : false
    }
  })

export const useNotes = () => useQuery({ queryKey: keys.notes, queryFn: () => call((api) => api.notebook.notes()) })

export const useAddNote = () => {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (request: AddNoteRequest) => call((api) => api.notebook.addNote({ payload: request })),
    onSuccess: async (note: Note) => {
      await client.cancelQueries({ queryKey: keys.notes })
      client.setQueryData<ReadonlyArray<Note>>(keys.notes, (notes) =>
        notes === undefined ? undefined : [note, ...notes.filter((own) => own.id !== note.id)]
      )
      void client.invalidateQueries({ queryKey: keys.notes })
    }
  })
}

export const useRemoveNote = () => {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: NoteId) => call((api) => api.notebook.removeNote({ params: { id } })),
    onSuccess: async (_result, id) => {
      await client.cancelQueries({ queryKey: keys.notes })
      client.setQueryData<ReadonlyArray<Note>>(keys.notes, (notes) => notes?.filter((note) => note.id !== id))
      void client.invalidateQueries({ queryKey: keys.notes })
    }
  })
}

export const useNaturalness = () =>
  useMutation({
    mutationFn: (request: NaturalnessRequest) => call((api) => api.coach.naturalness({ payload: request }))
  })

export const useHowToSay = () =>
  useMutation({ mutationFn: (request: HowToSayRequest) => call((api) => api.coach.howToSay({ payload: request })) })

export const useEnrich = (id: number) => {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => call((api) => api.dictionary.enrich({ params: { id: id as EntryId } })),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.entry(id) })
  })
}

export const useSpeak = () =>
  useMutation({ mutationFn: (request: SpeakRequest) => call((api) => api.audio.speak({ payload: request })) })
