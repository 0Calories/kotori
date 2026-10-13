/** Small key-value storage: localStorage on the web. */
export const storage = {
  get: async (key: string) => (typeof localStorage === "undefined" ? null : localStorage.getItem(key)),
  set: async (key: string, value: string) => localStorage.setItem(key, value),
  remove: async (key: string) => localStorage.removeItem(key)
}
