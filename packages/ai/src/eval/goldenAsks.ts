import type { Language } from "@kotori/contracts"
import type { AskRoute } from "../asks/triage.ts"

export interface GoldenAsk {
  readonly query: string
  /** The language of the dictionary searched: the asker's target language. */
  readonly language: Language
  readonly expect: AskRoute
}

const a = (query: string, language: Language, expect: AskRoute): GoldenAsk => ({ query, language, expect })

/**
 * Queries with known routes for `kotori eval asks`, in both learning directions: real words
 * and idioms the dictionary lacks (lookups, however new or misspelled), sentences that belong
 * to the Coach, names, the wrong language, and mash. Lookups must be missing from the dictionary
 * (`data/eiwa`, `data/jmdict`): one it answers is never asked about, so never reaches Jev. Some
 * cases are turned away by the free checks before Jev; the eval reports those apart. Seeded from
 * what learners typed; add to it whenever the router sends a real lookup elsewhere.
 */
export const GOLDEN_ASKS: ReadonlyArray<GoldenAsk> = [
  // Lookups a learner of English might type: slang, idioms, variants, misspellings.
  a("bussin", "en", "lookup"),
  a("aura farming", "en", "lookup"),
  a("living rent free", "en", "lookup"),
  a("it be like it be", "en", "lookup"),
  a("let him cook", "en", "lookup"),
  a("understood the assignment", "en", "lookup"),
  a("skill issue", "en", "lookup"),
  a("gyatt", "en", "lookup"),
  a("ate and left no crumbs", "en", "lookup"),
  a("skibidi", "en", "lookup"),
  a("definately", "en", "lookup"),
  a("girl dinner", "en", "lookup"),
  a("bffr", "en", "lookup"),
  a("rage bait", "en", "lookup"),
  a("brainrot", "en", "lookup"),
  a("bang for your buck", "en", "lookup"),
  // Lookups a learner of Japanese might type, in kana, kanji or rōmaji.
  a("てぇてぇ", "ja", "lookup"),
  a("蛙化", "ja", "lookup"),
  a("しか勝たん", "ja", "lookup"),
  a("ぱおん", "ja", "lookup"),
  a("yabatanien", "ja", "lookup"),
  a("ぴえん超えてぱおん", "ja", "lookup"),
  a("はにゃ", "ja", "lookup"),
  a("あーね", "ja", "lookup"),
  a("きゅんです", "ja", "lookup"),
  // Sentences and requests: the Coach's business.
  a("how do i say thank you politely", "en", "sentence"),
  a("is this sentence natural", "en", "sentence"),
  a("i want to eat sushi tonight", "en", "sentence"),
  a("明日は雨が降りますか", "ja", "sentence"),
  a("これを英語で何と言いますか", "ja", "sentence"),
  a("what does bussin mean", "en", "sentence"),
  // Names.
  a("Taylor Swift", "en", "name"),
  a("Nintendo", "en", "name"),
  a("Shibuya", "ja", "name"),
  a("ジブリ", "ja", "name"),
  a("Elon Musk", "en", "name"),
  // The wrong dictionary.
  a("ありがとう", "en", "other_language"),
  a("umbrella", "ja", "other_language"),
  a("merci beaucoup", "en", "other_language"),
  a("美味しい", "en", "other_language"),
  // Mash and non-language.
  a("asdkjhqwe", "en", "garbage"),
  a("xqzvy", "en", "garbage"),
  a("12345", "en", "garbage"),
  a("qwertyuiop", "ja", "garbage"),
  a("ｱｱｱｱｱｱ", "ja", "garbage"),
  a("fjdkslfjdk", "en", "garbage")
]
