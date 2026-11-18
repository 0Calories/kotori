/**
 * What "local" means to the development tools: this machine, and nothing else. The local
 * auth server and `pnpm dev:setup` (`tools/dev-setup.ts`, which imports this file) both use
 * it to refuse a database or auth service elsewhere, such as a Neon branch.
 *
 * Not the API's CORS check, which also trusts the local network: a database at a LAN
 * address is still another machine's.
 */
const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)$/

/** Whether a hostname (`URL`'s, so `[::1]` keeps its brackets) is this machine. */
export const isLocalHost = (hostname: string) => LOOPBACK.test(hostname.toLowerCase())

/**
 * Where a Postgres connection string connects, if any of it is not this machine: its host, or
 * the `host` parameter that overrides it, or `PGHOST` when it names neither, as `pg` resolves
 * them. A socket directory such as `/var/run/postgresql` is local, including libpq's
 * percent-encoded form in the host position (`postgres://user@%2Fvar%2Frun%2Fpostgresql/db`),
 * which `URL` leaves encoded for a `postgres:` URL.
 */
export const remoteDatabaseHost = (connectionString: string): string | undefined => {
  const url = new URL(connectionString)
  const hostname = (() => {
    try {
      return decodeURIComponent(url.hostname)
    } catch {
      return url.hostname
    }
  })()
  const hosts = url.searchParams.get("host") || hostname || process.env["PGHOST"] || "localhost"
  return hosts.split(",").find((host) => !host.startsWith("/") && !isLocalHost(host))
}
