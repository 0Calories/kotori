export const transport = {
  // HttpOnly session cookies are invisible to scripts, so minting a JWT is the only way to check.
  hasCredential: async () => true,
  fetch: (url: string, init: RequestInit): Promise<Response> => fetch(url, { ...init, credentials: "include" }),
  clearChallenge: async () => {},
  forget: async () => {}
}
