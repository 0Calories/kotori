import type { Language, Profile, UpdateProfileRequest } from "@kotori/contracts"
import { useQueryClient } from "@tanstack/react-query"
import { getLocales } from "expo-localization"
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { ApiError, call } from "../api/client.ts"
import { AuthError, managedAuth } from "../auth/client.ts"
import { devCredentials } from "../auth/dev.ts"
import { google } from "../auth/google"
import { authMessage } from "../auth/messages.ts"
import { tokens } from "../auth/tokens.ts"
import { transport } from "../auth/transport"
import { strings, type Strings } from "../i18n/strings.ts"
import { storage } from "./storage"

/**
 * Where the learner is: signed out; signed in but waiting for approval (archived
 * looks the same); approved but yet to pick a language; or in. `offline` is the API
 * or Managed Auth being unreachable, and `unavailable` the API answering with something
 * unexpected (a bug, or a response this build can't read); neither throws credentials away.
 */
type Status = "loading" | "signedOut" | "pending" | "onboarding" | "ready" | "offline" | "unavailable"

export interface SignUp {
  readonly email: string
  readonly password: string
  readonly name: string
  readonly nativeLanguage: Language
}

interface Session {
  readonly status: Status
  readonly profile: Profile | null
  /** Interface copy in the learner's native language. */
  readonly t: Strings
  readonly signIn: (email: string, password: string) => Promise<void>
  readonly signUp: (input: SignUp) => Promise<void>
  /**
   * Signs in with Google, making the account if there isn't one; `nativeLanguage` (from
   * the sign-up screen) is applied to a new account. On the web the page leaves for
   * Google and comes back signed in, cancelled (including bfcache Back), or with `googleError`.
   */
  readonly signInWithGoogle: (nativeLanguage?: Language) => Promise<void>
  /** Why the Google sign-in the web app just came back from didn't work, for the sign-in screens. */
  readonly googleError: AuthError | null
  readonly clearGoogleError: () => void
  readonly signOut: () => Promise<void>
  readonly sendVerificationCode: () => Promise<void>
  readonly verifyEmail: (code: string) => Promise<void>
  /** Changes the password and signs the learner's other devices out; this one stays in. */
  readonly changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  /** Erases the account and everything studied, then lands on the welcome screen. Irreversible. */
  readonly deleteAccount: () => Promise<void>
  /** Re-reads the profile, e.g. while waiting for approval. */
  readonly refresh: () => Promise<void>
  readonly updateProfile: (patch: UpdateProfileRequest) => Promise<void>
  readonly retry: () => void
}

const SessionContext = createContext<Session | null>(null)

const deviceLanguage = (): Language => (getLocales()[0]?.languageCode === "ja" ? "ja" : "en")

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC"

const statusOf = (profile: Profile): Status =>
  profile.status !== "approved" && profile.role !== "admin" ? "pending" : profile.onboarded ? "ready" : "onboarding"

/** A JWT for the session just created, or the reason there isn't one. */
const sessionToken = async () => {
  if ((await tokens.refresh()) === null) throw new AuthError("NO_SESSION", "", 401)
}

/** The sign-up screen's language, kept across the web's round trip to Google. */
const GOOGLE_LANGUAGE = "kotori.googleSignUpLanguage"

/** Applies any pending Google sign-up language (for an un-onboarded account) and current timezone. */
const syncSignInProfile = async (me: Profile): Promise<Profile> => {
  const stored = await storage.get(GOOGLE_LANGUAGE).catch(() => null)
  const nativeLanguage: Language | undefined = stored === "en" || stored === "ja" ? stored : undefined
  // Only a learner who hasn't picked yet: signing up with an existing Google account just signs in.
  const patch: UpdateProfileRequest = {
    ...(nativeLanguage !== undefined && !me.onboarded ? { nativeLanguage } : {}),
    ...(me.timezone !== timeZone() ? { timezone: timeZone() } : {})
  }
  const updated = Object.keys(patch).length > 0 ? await call((api) => api.account.update({ payload: patch })) : me
  if (stored !== null) await storage.remove(GOOGLE_LANGUAGE).catch(() => {})
  return updated
}

/** Whether a session was established as the development account; always false in a release build. */
const signInAsDeveloper = async (): Promise<boolean> => {
  const credentials = devCredentials()
  if (credentials === null) return false
  try {
    await managedAuth.signIn(credentials)
    return (await tokens.refresh()) !== null
  } catch (error) {
    // Usually the account doesn't exist on this branch yet, and the sign-in screen still works.
    console.warn(
      `Could not sign in as ${credentials.email}: ${error instanceof Error ? error.message : String(error)}. ` +
        "Run `pnpm kotori dev-account` to create it."
    )
    return false
  }
}

export const SessionProvider = ({ children }: { readonly children: ReactNode }) => {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<Status>("loading")
  const [profile, setProfile] = useState<Profile | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [googleError, setGoogleError] = useState<AuthError | null>(null)
  const pendingVerifier = useRef<string | null>(null)

  const clearGoogleError = useCallback(() => setGoogleError(null), [])

  const enter = useCallback((me: Profile) => {
    setGoogleError(null)
    setProfile(me)
    setStatus(statusOf(me))
  }, [])

  const leave = useCallback(() => {
    tokens.clear()
    setGoogleError(null)
    setProfile(null)
    queryClient.clear()
    setStatus("signedOut")
  }, [queryClient])

  // A session that ends elsewhere (sign-out on another device, revocation, deletion) lands here.
  useEffect(() => tokens.onSignedOut(leave), [leave])

  /** Trades Google's verifier for a session, then applies what the sign-up screen chose to a new account. */
  const finishGoogle = useCallback(
    async (verifier: string, onTraded?: () => void, isCancelled?: () => boolean) => {
      try {
        await managedAuth.finishGoogle(verifier)
        await sessionToken()
        onTraded?.()
      } catch (error) {
        // An expired or replayed verifier, or a challenge cookie that didn't survive the trip.
        if (error instanceof AuthError && error.code !== "OFFLINE") {
          onTraded?.()
          await storage.remove(GOOGLE_LANGUAGE).catch(() => {})
          throw new AuthError("GOOGLE_FAILED", error.message, error.status)
        }
        throw error
      }
      const me = await call((api) => api.account.me())
      const updated = await syncSignInProfile(me)
      if (isCancelled?.()) return
      enter(updated)
    },
    [enter]
  )

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      // On the web, the page may be coming back from Google (or retrying a verifier exchange after an offline blip).
      let skipDevSignIn = false
      try {
        const back = google.returned()
        if (back === "cancelled") {
          skipDevSignIn = true
          await storage.remove(GOOGLE_LANGUAGE).catch(() => {})
        } else if (back !== null) {
          pendingVerifier.current = back.verifier
        }
        if (pendingVerifier.current !== null) {
          return await finishGoogle(
            pendingVerifier.current,
            () => {
              pendingVerifier.current = null
            },
            () => cancelled
          )
        }
      } catch (error) {
        if (!(error instanceof AuthError) || error.code === "OFFLINE") throw error
        pendingVerifier.current = null
        skipDevSignIn = true
        await storage.remove(GOOGLE_LANGUAGE).catch(() => {})
        if (!cancelled) setGoogleError(error)
      }
      if ((await tokens.current()) === null && (skipDevSignIn || !(await signInAsDeveloper()))) {
        return cancelled || setStatus("signedOut")
      }
      const me = await call((api) => api.account.me())
      if (cancelled) return
      const storedLanguage = await storage.get(GOOGLE_LANGUAGE).catch(() => null)
      if (storedLanguage !== null) {
        const synced = await syncSignInProfile(me)
        if (!cancelled) enter(synced)
        return
      }
      enter(me)
      // Keep study days aligned with wherever the learner is now.
      if (me.timezone !== timeZone()) {
        call((api) => api.account.update({ payload: { timezone: timeZone() } })).then(setProfile, () => {})
      }
    }
    load().catch((error: unknown) => {
      if (cancelled) return
      if (!(error instanceof ApiError) || error.tag === "Offline") return setStatus("offline")
      setStatus(error.tag === "Unauthorized" ? "signedOut" : "unavailable")
    })
    return () => {
      cancelled = true
    }
  }, [attempt, enter, finishGoogle])

  const refresh = useCallback(async () => enter(await call((api) => api.account.me())), [enter])

  const signIn = useCallback(
    async (email: string, password: string) => {
      setGoogleError(null)
      await managedAuth.signIn({ email: email.trim(), password })
      await sessionToken()
      await refresh()
    },
    [refresh]
  )

  const signUp = useCallback(
    async ({ email, password, name, nativeLanguage }: SignUp) => {
      setGoogleError(null)
      const address = email.trim()
      // Managed Auth wants a name; the address's local part stands in, as in Neon's examples.
      await managedAuth.signUp({ email: address, password, name: name.trim() || address.split("@")[0] || address })
      await sessionToken()
      // The language first, so the verification code, and later the approval email, arrive in it.
      enter(
        await call((api) =>
          api.account.update({ payload: { nativeLanguage, timezone: timeZone(), displayName: name.trim() || null } })
        )
      )
      // The pending screen offers a new code if this one doesn't arrive.
      await managedAuth.sendVerificationCode(address).catch(() => {})
    },
    [enter]
  )

  const signInWithGoogle = useCallback(
    async (nativeLanguage?: Language) => {
      setGoogleError(null)
      if (nativeLanguage === undefined) await storage.remove(GOOGLE_LANGUAGE).catch(() => {})
      else await storage.set(GOOGLE_LANGUAGE, nativeLanguage)
      try {
        const back = await google.start()
        if (back === null || back === "cancelled") {
          await storage.remove(GOOGLE_LANGUAGE).catch(() => {})
          return
        }
        await finishGoogle(back.verifier)
      } catch (error) {
        if (error instanceof AuthError && error.code !== "OFFLINE") {
          await storage.remove(GOOGLE_LANGUAGE).catch(() => {})
        }
        throw error
      }
    },
    [finishGoogle]
  )

  const signOut = useCallback(async () => {
    // Ends the session upstream; this device forgets it either way.
    await managedAuth.signOut().catch(() => {})
    await transport.forget()
    leave()
  }, [leave])

  const sendVerificationCode = useCallback(async () => {
    if (profile !== null) await managedAuth.sendVerificationCode(profile.email)
  }, [profile])

  const verifyEmail = useCallback(
    async (code: string) => {
      if (profile === null) return
      await managedAuth.verifyEmail(profile.email, code.trim())
      // The JWT carries emailVerified, so mint one that knows.
      await sessionToken()
      await refresh()
    },
    [profile, refresh]
  )

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await managedAuth.changePassword(currentPassword, newPassword)
    // The JWT in hand was minted from the old session, so drop it and mint from
    // whatever cookie the response left with the transport.
    tokens.clear()
    await sessionToken()
  }, [])

  const deleteAccount = useCallback(async () => {
    // The API deletes the identity along with the data, so there is no session left to end.
    await call((api) => api.account.delete())
    await transport.forget()
    leave()
  }, [leave])

  const updateProfile = useCallback(
    async (patch: UpdateProfileRequest) => {
      enter(await call((api) => api.account.update({ payload: patch })))
      void queryClient.invalidateQueries()
    },
    [enter, queryClient]
  )

  const value = useMemo<Session>(
    () => ({
      status,
      profile,
      // Until the learner picks a language (onboarding), follow the device rather than the table's `"en"` default.
      t: strings[profile?.onboarded ? profile.nativeLanguage : deviceLanguage()],
      signIn,
      signUp,
      signInWithGoogle,
      googleError,
      clearGoogleError,
      signOut,
      sendVerificationCode,
      verifyEmail,
      changePassword,
      deleteAccount,
      refresh,
      updateProfile,
      retry: () => {
        setStatus("loading")
        setAttempt((n) => n + 1)
      }
    }),
    [
      status,
      profile,
      signIn,
      signUp,
      signInWithGoogle,
      googleError,
      clearGoogleError,
      signOut,
      sendVerificationCode,
      verifyEmail,
      changePassword,
      deleteAccount,
      refresh,
      updateProfile
    ]
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export const useSession = () => {
  const session = useContext(SessionContext)
  if (session === null) throw new Error("useSession must be used inside SessionProvider")
  return session
}

/** Shared button state and error lifecycle for `/sign-in` and `/sign-up` Google flows. */
export const useGoogleSignIn = () => {
  const { t, signInWithGoogle, googleError, clearGoogleError } = useSession()
  const [googleBusy, setGoogleBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => clearGoogleError, [clearGoogleError])

  const continueWithGoogle = useCallback(
    async (nativeLanguage?: Language) => {
      if (googleBusy) return
      setGoogleBusy(true)
      setLocalError(null)
      try {
        await signInWithGoogle(nativeLanguage)
      } catch (e) {
        setLocalError(authMessage(t, e))
      } finally {
        setGoogleBusy(false)
      }
    },
    [googleBusy, signInWithGoogle, t]
  )

  const resetGoogleError = useCallback(() => {
    setLocalError(null)
    clearGoogleError()
  }, [clearGoogleError])

  const googleMessage = localError ?? (googleError === null ? null : authMessage(t, googleError))
  return { googleBusy, continueWithGoogle, googleMessage, resetGoogleError }
}

/** Interface copy for the current learner. */
export const useT = () => useSession().t

/** The language the interface is in; English outside a session. */
export const useInterfaceLanguage = (): Language => {
  const session = useContext(SessionContext)
  return session?.t === strings.ja ? "ja" : "en"
}
