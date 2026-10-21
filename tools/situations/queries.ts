export type QueryKind = "verbatim" | "paraphrase" | "typo" | "japanese" | "lexical" | "uncovered"

export interface LabeledQuery {
  readonly query: string
  readonly kind: QueryKind
  /** Situation that should be retrieved. Null when none is the right answer. */
  readonly situation: string | null
  /** Dictionary headwords that count as correct, besides the situation's linked entries. */
  readonly headwords: readonly string[]
  /** True when the fallback flag should send the query to "How do I say". */
  readonly wantFallback: boolean
}

const intent = (
  query: string,
  kind: QueryKind,
  situation: string,
  headwords: readonly string[] = []
): LabeledQuery => ({ query, kind, situation, headwords, wantFallback: false })

const plain = (query: string, headwords: readonly string[]): LabeledQuery => ({
  query,
  kind: "lexical",
  situation: null,
  headwords,
  wantFallback: true
})

const uncovered = (query: string): LabeledQuery => ({
  query,
  kind: "uncovered",
  situation: null,
  headwords: [],
  wantFallback: true
})

export const queries: readonly LabeledQuery[] = [
  intent("how do I introduce myself", "verbatim", "intro-name"),
  intent("how much is this", "verbatim", "shop-price"),
  intent("where is the station", "verbatim", "transit-station"),
  intent("I'm hungry", "verbatim", "feel-hungry"),
  intent("thank you", "verbatim", "greet-thanks"),
  intent("do you speak English", "verbatim", "req-english"),
  intent("check please", "verbatim", "food-bill"),
  intent("I'm lost", "verbatim", "dir-lost"),

  intent("what's a polite way to tell someone my name the first time we meet", "paraphrase", "intro-name"),
  intent("what should I say to thank the person who cooked, once we finish eating", "paraphrase", "greet-after-meal"),
  intent("how should I greet my boss when I arrive at the office in the morning", "paraphrase", "greet-morning"),
  intent("the clerk asked if I need help but I only want to browse", "paraphrase", "shop-just-looking"),
  intent("I want the drink served without any ice", "paraphrase", "food-no-ice"),
  intent("how do I tell the waiter I can't eat meat", "paraphrase", "food-no-meat"),
  intent("I stayed on the train and missed the station I wanted", "paraphrase", "transit-missed"),
  intent("I can't figure out which way to leave the station", "paraphrase", "dir-exit"),
  intent("my head has been pounding all afternoon", "paraphrase", "health-headache"),
  intent("I need to tell my manager I have a fever and can't come in", "paraphrase", "work-sick-day"),
  intent("someone called and I need them to wait while I grab a pen", "paraphrase", "phone-hold"),
  intent("could you talk a little slower, I'm still learning", "paraphrase", "req-slow"),
  intent("I want to ask a classmate to get dinner if they're free", "paraphrase", "social-invite"),
  intent("it looks like it might rain, how do I say that", "paraphrase", "weather-rain"),
  intent("what do I say at the hotel desk if I have a booking under my name", "paraphrase", "travel-checkin"),
  intent("how do I ask the teacher how this kanji is read", "paraphrase", "school-reading"),
  intent("my phone battery died and I need to plug it in", "paraphrase", "problem-battery"),
  intent("where can I withdraw some cash", "paraphrase", "money-bank"),
  intent("what do people say when they step out of the house in the morning", "paraphrase", "greet-leaving-home"),

  intent("how do i introduse myself", "typo", "intro-name"),
  intent("wheres the bathrooom", "typo", "home-bathroom"),
  intent("how much dos this cost", "typo", "shop-price"),
  intent("excus me", "typo", "greet-excuse"),
  intent("I want to oder food", "typo", "food-order"),
  intent("thankyou very much", "typo", "greet-thanks"),
  intent("can I get the chek", "typo", "food-bill"),
  intent("sorri I'm laet", "typo", "work-late"),
  intent("good mornign", "typo", "greet-morning"),

  intent("自己紹介", "japanese", "intro-name"),
  intent("駅はどこ", "japanese", "transit-station"),
  intent("おはようございます", "japanese", "greet-morning"),
  intent("ありがとう", "japanese", "greet-thanks"),
  intent("お腹が空いた", "japanese", "feel-hungry"),
  intent("トイレはどこ", "japanese", "home-bathroom"),
  intent("すみません", "japanese", "greet-excuse"),
  intent("これをください", "japanese", "food-order"),
  intent("道に迷いました", "japanese", "dir-lost"),

  plain("eat", ["食べる"]),
  plain("cat", ["猫"]),
  plain("water", ["水"]),
  plain("station", ["駅"]),
  plain("run", ["走る"]),
  plain("book", ["本"]),
  plain("hello", ["こんにちは"]),
  plain("thanks", ["ありがとう"]),
  plain("coffee", ["コーヒー"]),
  plain("猫", ["猫"]),
  plain("食べる", ["食べる"]),

  uncovered("how do I break up with someone"),
  uncovered("how do I ask for a raise"),
  uncovered("how do I return a package"),
  uncovered("what's a natural way to complain about the neighbor's noise"),
  uncovered("how do you offer condolences"),
  uncovered("how do I ask someone to stop smoking"),
  uncovered("how do I tell my landlord the sink is broken"),
  uncovered("how do I reschedule a visa appointment"),

  uncovered("how do I ask someone on a date"),
  uncovered("how do I tell the barber to take a little off the sides"),
  uncovered("how do I describe this rash to a pharmacist"),
  uncovered("how do I say I missed my flight"),
  uncovered("how do I tell the waiter they brought the wrong dish"),
  uncovered("how do I say the air conditioner is too cold"),
  uncovered("how do I report a lost passport"),
  uncovered("how do I invite my coworkers to a wedding"),
  uncovered("how do I ask for stamps at the post office"),
  uncovered("how do I say my glasses broke"),
  uncovered("how do I order flowers for a funeral"),
  uncovered("how do I ask if pets are allowed"),
  uncovered("how do I say I forgot my password"),
  uncovered("how do I ask the price of a haircut"),
  uncovered("how do I tell a child to watch out for the cars"),
  uncovered("how do I complain that the soup is cold"),
  uncovered("how do I ask where to buy a sim card"),
  uncovered("how do I say I'll pay you back tomorrow"),
  uncovered("how do I ask the dentist if this will hurt"),
  uncovered("how do I return a library book")
]
