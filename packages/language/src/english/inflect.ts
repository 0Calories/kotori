/** What an inflected English form is. The codes are the app's labels: "past" → 過去形. */
export type EnglishInflection =
  | "plural"
  | "third-person"
  | "past"
  | "past-participle"
  | "present-participle"
  | "comparative"
  | "superlative"

/**
 * The words or phrasal expressions an English query could be an inflection of, covering
 * irregular verbs, irregular noun plurals, irregular comparatives/superlatives, regular
 * suffix rules, and inflected multi-word phrasal verbs/idioms ("ran into" → "run into",
 * "skating on thin ice" → "skate on thin ice").
 * Candidates are guesses; the dictionary decides which exist.
 */
export interface Uninflected {
  readonly base: string
  /** What the word would be: "-s" is a plural for nouns and the third person for verbs. */
  readonly tags: ReadonlyArray<EnglishInflection>
}

const S: ReadonlyArray<EnglishInflection> = ["plural", "third-person"]
const PLURAL: ReadonlyArray<EnglishInflection> = ["plural"]
const THIRD: ReadonlyArray<EnglishInflection> = ["third-person"]
const PAST: ReadonlyArray<EnglishInflection> = ["past"]
const PARTICIPLE: ReadonlyArray<EnglishInflection> = ["past-participle"]
const ED: ReadonlyArray<EnglishInflection> = ["past", "past-participle"]
const ING: ReadonlyArray<EnglishInflection> = ["present-participle"]
const ER: ReadonlyArray<EnglishInflection> = ["comparative"]
const EST: ReadonlyArray<EnglishInflection> = ["superlative"]

/** Irregular verbs: `[base, past, pastParticiple]`. Identical past/participle emits both tags. */
const IRREGULAR_VERBS: ReadonlyArray<readonly [string, string, string]> = [
  ["arise", "arose", "arisen"],
  ["awake", "awoke", "awoken"],
  ["bear", "bore", "borne"],
  ["beat", "beat", "beaten"],
  ["become", "became", "become"],
  ["begin", "began", "begun"],
  ["bend", "bent", "bent"],
  ["bet", "bet", "bet"],
  ["bind", "bound", "bound"],
  ["bite", "bit", "bitten"],
  ["bleed", "bled", "bled"],
  ["blow", "blew", "blown"],
  ["break", "broke", "broken"],
  ["breed", "bred", "bred"],
  ["bring", "brought", "brought"],
  ["build", "built", "built"],
  ["burn", "burnt", "burnt"],
  ["buy", "bought", "bought"],
  ["catch", "caught", "caught"],
  ["choose", "chose", "chosen"],
  ["cling", "clung", "clung"],
  ["come", "came", "come"],
  ["creep", "crept", "crept"],
  ["deal", "dealt", "dealt"],
  ["dig", "dug", "dug"],
  ["do", "did", "done"],
  ["draw", "drew", "drawn"],
  ["dream", "dreamt", "dreamt"],
  ["drink", "drank", "drunk"],
  ["drive", "drove", "driven"],
  ["eat", "ate", "eaten"],
  ["fall", "fell", "fallen"],
  ["feed", "fed", "fed"],
  ["feel", "felt", "felt"],
  ["fight", "fought", "fought"],
  ["find", "found", "found"],
  ["flee", "fled", "fled"],
  ["fling", "flung", "flung"],
  ["fly", "flew", "flown"],
  ["forbid", "forbade", "forbidden"],
  ["forget", "forgot", "forgotten"],
  ["forgive", "forgave", "forgiven"],
  ["freeze", "froze", "frozen"],
  ["get", "got", "gotten"],
  ["give", "gave", "given"],
  ["go", "went", "gone"],
  ["grind", "ground", "ground"],
  ["grow", "grew", "grown"],
  ["hang", "hung", "hung"],
  ["have", "had", "had"],
  ["hear", "heard", "heard"],
  ["hide", "hid", "hidden"],
  ["hold", "held", "held"],
  ["keep", "kept", "kept"],
  ["kneel", "knelt", "knelt"],
  ["know", "knew", "known"],
  ["lay", "laid", "laid"],
  ["lead", "led", "led"],
  ["lean", "leant", "leant"],
  ["leap", "leapt", "leapt"],
  ["learn", "learnt", "learnt"],
  ["leave", "left", "left"],
  ["lend", "lent", "lent"],
  ["lie", "lay", "lain"],
  ["light", "lit", "lit"],
  ["lose", "lost", "lost"],
  ["make", "made", "made"],
  ["mean", "meant", "meant"],
  ["meet", "met", "met"],
  ["misunderstand", "misunderstood", "misunderstood"],
  ["outgrow", "outgrew", "outgrown"],
  ["overcome", "overcame", "overcome"],
  ["overtake", "overtook", "overtaken"],
  ["pay", "paid", "paid"],
  ["prove", "proved", "proven"],
  ["ride", "rode", "ridden"],
  ["ring", "rang", "rung"],
  ["rise", "rose", "risen"],
  ["run", "ran", "run"],
  ["say", "said", "said"],
  ["see", "saw", "seen"],
  ["seek", "sought", "sought"],
  ["sell", "sold", "sold"],
  ["send", "sent", "sent"],
  ["sew", "sewed", "sewn"],
  ["shake", "shook", "shaken"],
  ["shine", "shone", "shone"],
  ["shoot", "shot", "shot"],
  ["show", "showed", "shown"],
  ["shrink", "shrank", "shrunk"],
  ["sing", "sang", "sung"],
  ["sink", "sank", "sunk"],
  ["sit", "sat", "sat"],
  ["sleep", "slept", "slept"],
  ["slide", "slid", "slid"],
  ["sling", "slung", "slung"],
  ["sow", "sowed", "sown"],
  ["speak", "spoke", "spoken"],
  ["speed", "sped", "sped"],
  ["spell", "spelt", "spelt"],
  ["spend", "spent", "spent"],
  ["spill", "spilt", "spilt"],
  ["spin", "spun", "spun"],
  ["spit", "spat", "spat"],
  ["spoil", "spoilt", "spoilt"],
  ["spring", "sprang", "sprung"],
  ["stand", "stood", "stood"],
  ["steal", "stole", "stolen"],
  ["stick", "stuck", "stuck"],
  ["sting", "stung", "stung"],
  ["stink", "stank", "stunk"],
  ["stride", "strode", "stridden"],
  ["strike", "struck", "struck"],
  ["string", "strung", "strung"],
  ["strive", "strove", "striven"],
  ["swear", "swore", "sworn"],
  ["sweep", "swept", "swept"],
  ["swell", "swelled", "swollen"],
  ["swim", "swam", "swum"],
  ["swing", "swung", "swung"],
  ["take", "took", "taken"],
  ["teach", "taught", "taught"],
  ["tear", "tore", "torn"],
  ["tell", "told", "told"],
  ["think", "thought", "thought"],
  ["throw", "threw", "thrown"],
  ["tread", "trod", "trodden"],
  ["undergo", "underwent", "undergone"],
  ["understand", "understood", "understood"],
  ["undertake", "undertook", "undertaken"],
  ["undo", "undid", "undone"],
  ["uphold", "upheld", "upheld"],
  ["wake", "woke", "woken"],
  ["wear", "wore", "worn"],
  ["weave", "wove", "woven"],
  ["weep", "wept", "wept"],
  ["win", "won", "won"],
  ["wind", "wound", "wound"],
  ["withdraw", "withdrew", "withdrawn"],
  ["withhold", "withheld", "withheld"],
  ["withstand", "withstood", "withstood"],
  ["wring", "wrung", "wrung"],
  ["write", "wrote", "written"]
]

/** Irregular noun plurals: `[plural, singular]`. */
const IRREGULAR_PLURALS: ReadonlyArray<readonly [string, string]> = [
  ["alumni", "alumnus"],
  ["analyses", "analysis"],
  ["antennae", "antenna"],
  ["appendices", "appendix"],
  ["axes", "axis"],
  ["bacteria", "bacterium"],
  ["bases", "basis"],
  ["brethren", "brother"],
  ["businessmen", "businessman"],
  ["businesswomen", "businesswoman"],
  ["cacti", "cactus"],
  ["calves", "calf"],
  ["chairmen", "chairman"],
  ["chairwomen", "chairwoman"],
  ["children", "child"],
  ["crises", "crisis"],
  ["criteria", "criterion"],
  ["curricula", "curriculum"],
  ["data", "datum"],
  ["diagnoses", "diagnosis"],
  ["dice", "die"],
  ["dwarves", "dwarf"],
  ["elves", "elf"],
  ["feet", "foot"],
  ["firemen", "fireman"],
  ["fishermen", "fisherman"],
  ["formulae", "formula"],
  ["freshmen", "freshman"],
  ["fungi", "fungus"],
  ["geese", "goose"],
  ["gentlemen", "gentleman"],
  ["grandchildren", "grandchild"],
  ["halves", "half"],
  ["hooves", "hoof"],
  ["hypotheses", "hypothesis"],
  ["indices", "index"],
  ["knives", "knife"],
  ["larvae", "larva"],
  ["leaves", "leaf"],
  ["lice", "louse"],
  ["lives", "life"],
  ["loaves", "loaf"],
  ["matrices", "matrix"],
  ["media", "medium"],
  ["memoranda", "memorandum"],
  ["men", "man"],
  ["mice", "mouse"],
  ["nuclei", "nucleus"],
  ["oases", "oasis"],
  ["oxen", "ox"],
  ["parentheses", "parenthesis"],
  ["people", "person"],
  ["phenomena", "phenomenon"],
  ["policemen", "policeman"],
  ["radii", "radius"],
  ["salesmen", "salesman"],
  ["scarves", "scarf"],
  ["selves", "self"],
  ["sheaves", "sheaf"],
  ["shelves", "shelf"],
  ["spokesmen", "spokesman"],
  ["stimuli", "stimulus"],
  ["strata", "stratum"],
  ["syllabi", "syllabus"],
  ["synopses", "synopsis"],
  ["teeth", "tooth"],
  ["theses", "thesis"],
  ["thieves", "thief"],
  ["vertebrae", "vertebra"],
  ["vertices", "vertex"],
  ["wharves", "wharf"],
  ["wives", "wife"],
  ["wolves", "wolf"],
  ["women", "woman"],
  ["workmen", "workman"]
]

/** Irregular comparatives, superlatives, and verb forms that don't fit `[base, past, participle]`. */
const IRREGULAR_OTHER: ReadonlyArray<readonly [string, string, ReadonlyArray<EnglishInflection>]> = [
  ["was", "be", PAST],
  ["were", "be", PAST],
  ["been", "be", PARTICIPLE],
  ["being", "be", ING],
  ["has", "have", THIRD],
  ["does", "do", THIRD],
  ["goes", "go", THIRD],
  ["born", "bear", PARTICIPLE],
  ["got", "get", ED],
  ["better", "good", ER],
  ["better", "well", ER],
  ["best", "good", EST],
  ["best", "well", EST],
  ["worse", "bad", ER],
  ["worse", "badly", ER],
  ["worst", "bad", EST],
  ["worst", "badly", EST],
  ["farther", "far", ER],
  ["further", "far", ER],
  ["farthest", "far", EST],
  ["furthest", "far", EST],
  ["less", "little", ER],
  ["lesser", "little", ER],
  ["least", "little", EST],
  ["more", "much", ER],
  ["more", "many", ER],
  ["most", "much", EST],
  ["most", "many", EST],
  ["elder", "old", ER],
  ["eldest", "old", EST]
]

const buildIrregulars = (): ReadonlyMap<string, ReadonlyArray<Uninflected>> => {
  const map = new Map<string, Array<Uninflected>>()
  const add = (form: string, base: string, tags: ReadonlyArray<EnglishInflection>) => {
    if (form === base) return
    const list = map.get(form) ?? []
    if (!list.some((item) => item.base === base)) list.push({ base, tags })
    map.set(form, list)
  }
  for (const [form, base, tags] of IRREGULAR_OTHER) add(form, base, tags)
  for (const [base, past, participle] of IRREGULAR_VERBS) {
    if (past === participle) {
      add(past, base, ED)
    } else {
      add(past, base, PAST)
      add(participle, base, PARTICIPLE)
    }
  }
  for (const [plural, singular] of IRREGULAR_PLURALS) add(plural, singular, PLURAL)
  return map
}

const IRREGULARS = buildIrregulars()

/** Suffix, what replaces it, and what the suffix makes. */
const RULES: ReadonlyArray<readonly [string, string, ReadonlyArray<EnglishInflection>]> = [
  ["ies", "y", S],
  ["es", "", S],
  ["s", "", S],
  ["ied", "y", ED],
  ["ed", "", ED],
  ["ed", "e", ED],
  ["ying", "ie", ING],
  ["ing", "", ING],
  ["ing", "e", ING],
  ["ier", "y", ER],
  ["er", "", ER],
  ["er", "e", ER],
  ["iest", "y", EST],
  ["est", "", EST],
  ["est", "e", EST]
]

const uninflectWord = (lower: string): Array<Uninflected> => {
  const candidates: Array<Uninflected> = [...(IRREGULARS.get(lower) ?? [])]
  for (const [suffix, replacement, tags] of RULES) {
    if (!lower.endsWith(suffix) || lower.length <= suffix.length) continue
    const stem = lower.slice(0, -suffix.length)
    // "glass" is not the plural of "glas".
    if (suffix === "s" && stem.endsWith("s")) continue
    candidates.push({ base: stem + replacement, tags })
    // "stopped", "running", "bigger": the consonant doubled before the suffix.
    if (replacement === "" && /([b-df-hj-np-tv-z])\1$/.test(stem)) candidates.push({ base: stem.slice(0, -1), tags })
  }
  const bases = new Map<string, Uninflected>()
  for (const candidate of candidates) {
    if (candidate.base.length > 1 && !bases.has(candidate.base)) bases.set(candidate.base, candidate)
  }
  return [...bases.values()]
}

export const uninflect = (word: string): Array<Uninflected> => {
  const lower = word.trim().toLowerCase()
  if (lower.length === 0) return []
  const parts = lower.split(/\s+/)
  if (parts.length === 1) return uninflectWord(parts[0]!)

  const bases = new Map<string, Uninflected>()
  const add = (base: string, tags: ReadonlyArray<EnglishInflection>) => {
    if (base.length > 1 && !bases.has(base)) bases.set(base, { base, tags })
  }
  // Phrasal verbs and idioms inflect their head verb ("ran into" → "run into", "skating on thin ice" → "skate on thin ice").
  const tail = parts.slice(1).join(" ")
  for (const candidate of uninflectWord(parts[0]!)) add(`${candidate.base} ${tail}`, candidate.tags)
  // Compound nouns inflect their final word ("credit cards" → "credit card", "field mice" → "field mouse").
  const head = parts.slice(0, -1).join(" ")
  for (const candidate of uninflectWord(parts[parts.length - 1]!)) add(`${head} ${candidate.base}`, candidate.tags)
  return [...bases.values()]
}
