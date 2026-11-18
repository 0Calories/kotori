export const SUBTITLES_URL =
  "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt"

export const parseSubtitles = (lines: Iterable<string>): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>()
  for (const line of lines) {
    const [word, count] = line.trim().split(/\s+/)
    if (word === undefined || count === undefined) continue
    const key = word.toLowerCase()
    if (!counts.has(key)) counts.set(key, Number(count) || 0)
  }
  return counts
}
