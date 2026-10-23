import type { Language, Profile, UpdateProfileRequest } from "@kotori/domain"
import { useQueryClient } from "@tanstack/react-query"
import { getLocales } from "expo-localization"
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { ApiError, call, setToken } from "../api/client.ts"
import { strings, type Strings } from "../i18n/strings.ts"
import { storage } from "./storage"

const TOKEN_KEY = "kotori.token"

type Status = "loading" | "anonymous" | "ready" | "offline"

interface Session {
  readonly status: Status
  readonly profile: Profile | null
  /** Interface copy in the learner's native language. */
  readonly t: Strings
  updateProfile(patch: UpdateProfileRequest): Promise<void>
  signOut(): Promise<void>
  retry(): void
}

const SessionContext = createContext<Session | null>(null)

const deviceLanguage = (): Language => (getLocales()[0]?.languageCode === "ja" ? "ja" : "en")

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC"

export const SessionProvider = ({ children }: { readonly children: ReactNode }) => {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<Status>("loading")
  const [profile, setProfile] = useState<Profile | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const saved = await storage.get(TOKEN_KEY)
      if (saved === null) return cancelled || setStatus("anonymous")
      setToken(saved)
      try {
        const me = await call((api) => api.account.me())
        if (cancelled) return
        setProfile(me)
        setStatus("ready")
        // Keep study days aligned with wherever the learner is now.
        if (me.timezone !== timeZone()) {
          call((api) => api.account.update({ payload: { timezone: timeZone() } })).then(setProfile, () => {})
        }
      } catch (error) {
        if (cancelled) return
        if (error instanceof ApiError && error.tag === "Unauthorized") {
          await storage.remove(TOKEN_KEY)
          setToken(null)
          setStatus("anonymous")
        } else {
          setStatus("offline")
        }
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [attempt])

  // Sign-up and sign-in screens are not built yet: the app only loads an existing
  // session (a managed JWT from `GET /api/auth/token`, sent as a bearer token).
  const updateProfile = useCallback(
    async (patch: UpdateProfileRequest) => {
      const updated = await call((api) => api.account.update({ payload: patch }))
      setProfile(updated)
      queryClient.invalidateQueries()
    },
    [queryClient]
  )

  const signOut = useCallback(async () => {
    await storage.remove(TOKEN_KEY)
    setToken(null)
    setProfile(null)
    queryClient.clear()
    setStatus("anonymous")
  }, [queryClient])

  const value = useMemo<Session>(
    () => ({
      status,
      profile,
      t: strings[profile?.nativeLanguage ?? deviceLanguage()],
      updateProfile,
      signOut,
      retry: () => {
        setStatus("loading")
        setAttempt((n) => n + 1)
      }
    }),
    [status, profile, updateProfile, signOut]
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export const useSession = () => {
  const session = useContext(SessionContext)
  if (session === null) throw new Error("useSession must be used inside SessionProvider")
  return session
}

/** Interface copy for the current learner. */
export const useT = () => useSession().t

/** The language the interface is in; English outside a session. */
export const useInterfaceLanguage = (): Language => {
  const session = useContext(SessionContext)
  return session?.t === strings.ja ? "ja" : "en"
}
