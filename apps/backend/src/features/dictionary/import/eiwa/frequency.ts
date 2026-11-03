/**
 * How often English words are used, from FrequencyWords' count of OpenSubtitles (2018):
 * the 50,000 most frequent words in subtitles, one per line as `word count`. Licensed
 * CC BY-SA 4.0. Subtitles are speech, which is what Kotori teaches.
 */
export const FREQUENCY_URL =
  "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt"

/** Occurrences by lowercased word. */
export const parseFrequency = (lines: Iterable<string>): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>()
  for (const line of lines) {
    const [word, count] = line.trim().split(/\s+/)
    if (word === undefined || count === undefined) continue
    const key = word.toLowerCase()
    if (!counts.has(key)) counts.set(key, Number(count) || 0)
  }
  return counts
}
