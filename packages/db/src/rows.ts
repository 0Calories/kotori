/**
 * Conversions at the repository boundary. Tables store `timestamptz` and Drizzle reads
 * them as `Date`; the domain and the SRS code work in millisecond epochs.
 */
export const millis = (date: Date): number => date.getTime()
export const millisOrNull = (date: Date | null): number | null => (date === null ? null : date.getTime())
export const at = (ms: number): Date => new Date(ms)
export const atOrNull = (ms: number | null): Date | null => (ms === null ? null : new Date(ms))

/** Splits bulk inserts so a statement never exceeds Postgres's parameter limit. */
export const chunks = <A>(items: ReadonlyArray<A>, size: number): Array<ReadonlyArray<A>> => {
  const out: Array<ReadonlyArray<A>> = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
