/**
 * Where the console's commands land, read from the environment for the header and for every
 * confirmation. Only a URL's host and port are ever shown: `DATABASE_URL` carries the password.
 */
export interface Target {
  /** What to call it on screen: `localhost:5432`, or a Neon endpoint's id. */
  readonly label: string
  /** The host and port, for confirmations. */
  readonly host: string
  /** A database on this machine, where a slip costs nothing. Anything else is treated as live. */
  readonly local: boolean
  /** Set in the environment, or Kotori's default (`Database.ts`) because it isn't. */
  readonly configured: boolean
  /** The URL couldn't be read, so nothing about it is shown. */
  readonly unreadable: boolean
}

/** Where `DATABASE_URL` points when unset, as in `Database.ts`. */
const DEFAULT_DATABASE = "postgres://localhost:5432/kotori"

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0", "host.docker.internal"])

const isLocal = (hostname: string) =>
  LOCAL_HOSTS.has(hostname) || hostname.endsWith(".localhost") || hostname.endsWith(".local")

/** `.env` values may arrive quoted; a quoted URL doesn't parse. */
const unquote = (value: string) => value.trim().replace(/^(['"])(.*)\1$/u, "$2")

/** A Neon endpoint as its id (`ep-…`), the name Neon's console shows; the pooler suffix dropped. */
const neonLabel = (hostname: string) => {
  const endpoint = hostname.split(".")[0] ?? hostname
  return `${endpoint.replace(/-pooler$/u, "")} (Neon)`
}

/** Describes a connection URL without exposing anything but its host. */
export const describeUrl = (value: string | undefined, fallback: string): Target => {
  const configured = value !== undefined && value.trim().length > 0
  let url: URL
  try {
    url = new URL(configured ? unquote(value) : fallback)
  } catch {
    // Never echo the value: it is the whole credential.
    return { label: "an unreadable URL", host: "unknown", local: false, configured, unreadable: true }
  }
  const hostname = url.hostname
  const host = url.port.length > 0 ? `${hostname}:${url.port}` : hostname
  const local = isLocal(hostname)
  return {
    label: local ? host : hostname.endsWith(".neon.tech") ? neonLabel(hostname) : hostname,
    host,
    local,
    configured,
    unreadable: false
  }
}

/** The database at `DATABASE_URL`, which every command and view reads and writes. */
export const databaseTarget = (env: Readonly<Record<string, string | undefined>>) =>
  describeUrl(env["DATABASE_URL"], DEFAULT_DATABASE)
