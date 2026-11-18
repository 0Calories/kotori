/**
 * Only a web page load carries Google's answer in its URL; see `googleCapture.web.ts`.
 * iOS and Android get theirs from the sign-in sheet, so there is never anything to take.
 */
export const capturedReturn = {
  takeQuery: (_predicate: (params: URLSearchParams) => boolean, _keys: ReadonlyArray<string>): URLSearchParams | null =>
    null,
  takeHash: (): URLSearchParams | null => null
}
