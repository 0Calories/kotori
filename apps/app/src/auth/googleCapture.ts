export const capturedReturn = {
  takeQuery: (_predicate: (params: URLSearchParams) => boolean, _keys: ReadonlyArray<string>): URLSearchParams | null =>
    null,
  takeHash: (): URLSearchParams | null => null
}
