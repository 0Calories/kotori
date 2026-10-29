import { Schema } from "effect"

/** This machine: the Docker Postgres from `compose.yaml` is published on localhost. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

/**
 * Why development must not use the database at `url`, or `undefined` when it may. Outside
 * production, only a database on this machine is allowed, unless `KOTORI_ALLOW_REMOTE_DB`
 * names the URL's host. A `.env` left pointing at production once had `pnpm dev:setup`
 * migrate it, and a Neon URL doesn't say which branch it is, so dev branches need the
 * opt-in too. Naming the host, rather than a yes, means a stale opt-in never carries over
 * to a different database. Production (`NODE_ENV=production`, set by the Dockerfile and
 * fly.toml) uses its own `DATABASE_URL`, including Fly's `kotori migrate` release command.
 */
export const remoteDatabaseRefusal = (url: string, env: Record<string, string | undefined>): string | undefined => {
  if (env["NODE_ENV"] === "production") return undefined
  const host = URL.canParse(url) ? new URL(url).hostname : ""
  if (LOCAL_HOSTS.has(host) || (host !== "" && host === env["KOTORI_ALLOW_REMOTE_DB"]?.toLowerCase())) {
    return undefined
  }
  if (host === "") return "DATABASE_URL isn't a postgres:// URL with a host, so it can't be checked for being local."
  return `DATABASE_URL points at ${host}, not this machine, so nothing was done: it could be production.
  Docker Postgres:   use the DATABASE_URL from .env.example (check .env.local too), then pnpm dev:setup
  A Neon dev branch: \`neon checkout <dev-branch>\` writes its URL to .env.local; then allow its host as below
  On purpose:        set KOTORI_ALLOW_REMOTE_DB=${host} for the command, or in .env`
}

/** `DatabaseLive` refused a non-local `DATABASE_URL`; see `remoteDatabaseRefusal`. */
export class RemoteDatabaseError extends Schema.TaggedError<RemoteDatabaseError>()("RemoteDatabaseError", {
  message: Schema.String
}) {}
