/**
 * Requests to `/api/auth/*` on the web: the browser keeps the HttpOnly session cookie
 * itself (scripts can't read it) and sends it because of `credentials: "include"`,
 * which the API allows for its configured web origins (`KOTORI_WEB_ORIGINS`).
 */
export const transport = {
  /** Unknown to scripts; minting a JWT finds out. */
  hasCredential: async () => true,
  fetch: (url: string, init: RequestInit): Promise<Response> => fetch(url, { ...init, credentials: "include" }),
  /** Sign-out clears the cookie server-side. */
  forget: async () => {}
}
