const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)$/

export const isLocalHost = (hostname: string) => LOOPBACK.test(hostname.toLowerCase())

export const remoteDatabaseHost = (connectionString: string): string | undefined => {
  const url = new URL(connectionString)
  const hostname = (() => {
    try {
      // WHATWG `URL` leaves percent-encoded Unix socket paths (`%2Fvar%2Frun%2Fpostgresql`) encoded on `postgres:` URLs.
      return decodeURIComponent(url.hostname)
    } catch {
      return url.hostname
    }
  })()
  const hosts = url.searchParams.get("host") || hostname || process.env["PGHOST"] || "localhost"
  return hosts.split(",").find((host) => !host.startsWith("/") && !isLocalHost(host))
}
