import type { Language, Profile, UpdateProfileRequest } from "@kotori/domain"
import { useQueryClient } from "@tanstack/react-query"
import { getLocales } from "expo-localization"
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { ApiError, call } from "../api/client.ts"
import { AuthError, managedAuth } from "../auth/client.ts"
import { devCredentials } from "../auth/dev.ts"
import { tokens } from "../auth/tokens.ts"
import { transport } from "../auth/transport"
import { strings, type Strings } from "../i18n/strings.ts"

/**
 * Where the learner is: signed out; signed in but waiting for approval (archived
 * looks the same); approved but yet to pick a language; or in. `offline` is the API
 * or Managed Auth being unreachable, which never throws credentials away.
 */
type Status = "loading" | "signedOut" | "pending" | "onboarding" | "ready" | "offline"

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

/**
 * In development, starts signed in as the account `kotori dev-account` creates,
 * rather than making every run go through sign-up and a confirmation code. Returns
 * whether a session was established; in a release build it is always false.
 */
const signInAsDeveloper = async (): Promise<boolean> => {
  const credentials = devCredentials()
  if (credentials === null) return false
  try {
    await managedAuth.signIn(credentials)
    return (await tokens.refresh()) !== null
  } catch (error) {
    // Most likely the account doesn't exist on this branch yet; the sign-in screen
    // still works, so say what to run and carry on rather than failing the launch.
    console.warn(
      `Could not sign in as ${credentials.email}: ${error instanceof Error ? error.message : String(error)}. ` +
        "Run `pnpm kotori dev-account` to create the development account."
    )
    return false
  }
}

export const SessionProvider = ({ children }: { readonly children: ReactNode }) => {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<Status>("loading")
  const [profile, setProfile] = useState<Profile | null>(null)
  const [attempt, setAttempt] = useState(0)

  const enter = useCallback((me: Profile) => {
    setProfile(me)
    setStatus(statusOf(me))
  }, [])

  const leave = useCallback(() => {
    tokens.clear()
    setProfile(null)
    queryClient.clear()
    setStatus("signedOut")
  }, [queryClient])

  // A session that ends elsewhere (sign-out on another device, revocation, deletion) lands here.
  useEffect(() => tokens.onSignedOut(leave), [leave])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if ((await tokens.current()) === null && !(await signInAsDeveloper())) {
        return cancelled || setStatus("signedOut")
      }
      const me = await call((api) => api.account.me())
      if (cancelled) return
      enter(me)
      // Keep study days aligned with wherever the learner is now.
      if (me.timezone !== timeZone()) {
        call((api) => api.account.update({ payload: { timezone: timeZone() } })).then(setProfile, () => {})
      }
    }
    load().catch((error: unknown) => {
      if (cancelled) return
      setStatus(error instanceof ApiError && error.tag === "Unauthorized" ? "signedOut" : "offline")
    })
    return () => {
      cancelled = true
    }
  }, [attempt, enter])

  const refresh = useCallback(async () => enter(await call((api) => api.account.me())), [enter])

  const signIn = useCallback(
    async (email: string, password: string) => {
      await managedAuth.signIn({ email: email.trim(), password })
      await sessionToken()
      await refresh()
    },
    [refresh]
  )

  const signUp = useCallback(
    async ({ email, password, name, nativeLanguage }: SignUp) => {
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
    // Revoking the other sessions rotates this one's cookie too; the JWT in hand was
    // minted from the old one, so drop it and mint from the cookie the transport just kept.
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
      t: strings[profile?.nativeLanguage ?? deviceLanguage()],
      signIn,
      signUp,
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

/** Interface copy for the current learner. */
export const useT = () => useSession().t

/** The language the interface is in; English outside a session. */
export const useInterfaceLanguage = (): Language => {
  const session = useContext(SessionContext)
  return session?.t === strings.ja ? "ja" : "en"
}
