import type { SituationDraft } from "./schema.ts"

type Formality = SituationDraft["phrases"][number]["formality"]

const s = (
  id: string,
  title: string,
  category: string,
  aliases: readonly string[],
  note: string,
  phrases: ReadonlyArray<readonly [string, string, string, Formality]>,
  words: ReadonlyArray<readonly [string, string]>
): SituationDraft => ({
  id,
  title,
  category,
  aliases: [...aliases],
  note,
  phrases: phrases.map(([ja, reading, en, formality]) => ({ ja, reading, en, formality })),
  words: words.map(([word, reading]) => ({ word, reading }))
})

/** Everyday situations for the prototype index. Entry ids are resolved at index time, not stored here. */
export const corpus: readonly SituationDraft[] = [
  s("greet-morning", "Saying good morning", "greetings", [
    "good morning",
    "how do I say good morning",
    "morning greeting",
    "ohayou gozaimasu",
    "おはよう"
  ], "おはようございます is the safe morning greeting; おはよう is for friends and family.", [
    ["おはようございます。", "おはようございます。", "Good morning.", "polite"],
    ["おはよう。", "おはよう。", "Morning.", "casual"]
  ], [["おはよう", "おはよう"]]),
  s("greet-afternoon", "Saying hello in the afternoon", "greetings", [
    "good afternoon",
    "hello during the day",
    "how do I say hello",
    "konnichiwa",
    "こんにちは"
  ], "こんにちは covers late morning through late afternoon, not the evening.", [
    ["こんにちは。", "こんにちは。", "Hello.", "polite"],
    ["やあ、こんにちは。", "やあ、こんにちは。", "Hey, hello.", "casual"]
  ], [["こんにちは", "こんにちは"]]),
  s("greet-evening", "Saying good evening", "greetings", [
    "good evening",
    "hello at night",
    "evening greeting",
    "konbanwa",
    "こんばんは"
  ], "こんばんは starts around dusk. It is a greeting, not a goodbye.", [
    ["こんばんは。", "こんばんは。", "Good evening.", "polite"],
    ["こんばんは、お邪魔します。", "こんばんは、おじゃまします。", "Good evening, thanks for having me.", "polite"]
  ], [["こんばんは", "こんばんは"]]),
  s("greet-hello", "A casual hey", "greetings", [
    "hey",
    "what's up",
    "casual hello",
    "how do friends say hi",
    "やあ"
  ], "やあ and よう are casual. With anyone you don't know well, use こんにちは.", [
    ["やあ。", "やあ。", "Hey.", "casual"],
    ["よう、元気？", "よう、げんき？", "Hey, you good?", "casual"]
  ], [["元気", "げんき"]]),
  s("greet-long-time", "Long time no see", "greetings", [
    "long time no see",
    "it's been a while",
    "haven't seen you in ages",
    "久しぶり",
    "hisashiburi"
  ], "お久しぶりです is the polite form. 久しぶり is what friends say.", [
    ["お久しぶりです。", "おひさしぶりです。", "It's been a long time.", "polite"],
    ["久しぶり！", "ひさしぶり！", "Long time no see!", "casual"]
  ], [["久しぶり", "ひさしぶり"]]),
  s("greet-goodbye", "Saying goodbye", "greetings", [
    "goodbye",
    "how do I say bye",
    "farewell",
    "sayonara",
    "さようなら"
  ], "さようなら can sound final. Friends usually say じゃあね or またね.", [
    ["さようなら。", "さようなら。", "Goodbye.", "polite"],
    ["じゃあね。", "じゃあね。", "See you.", "casual"]
  ], [["さようなら", "さようなら"]]),
  s("greet-see-you", "See you tomorrow", "greetings", [
    "see you tomorrow",
    "see you later",
    "talk to you later",
    "mata ashita",
    "また明日"
  ], "また is the usual 'again'. Add the time: また明日, また来週, また後で.", [
    ["また明日。", "またあした。", "See you tomorrow.", "casual"],
    ["また明日、よろしくお願いします。", "またあした、よろしくおねがいします。", "See you tomorrow.", "polite"]
  ], [["明日", "あした"]]),
  s("greet-leaving-home", "I'm heading out", "greetings", [
    "I'm heading out",
    "I'm leaving the house",
    "what do you say when you leave home",
    "ittekimasu",
    "いってきます"
  ], "The person staying answers いってらっしゃい. Don't use this when leaving the office.", [
    ["行ってきます。", "いってきます。", "I'm heading out.", "polite"],
    ["行ってらっしゃい。", "いってらっしゃい。", "Have a good time, take care.", "polite"]
  ], [["行ってきます", "いってきます"]]),
  s("greet-welcome-back", "Welcome home", "greetings", [
    "welcome home",
    "I'm back",
    "what to say when you get home",
    "tadaima",
    "おかえり"
  ], "ただいま is what you say as you come in. おかえりなさい is the reply.", [
    ["ただいま。", "ただいま。", "I'm home.", "casual"],
    ["お帰りなさい。", "おかえりなさい。", "Welcome home.", "polite"]
  ], [["ただいま", "ただいま"], ["お帰り", "おかえり"]]),
  s("greet-good-night", "Saying good night", "greetings", [
    "good night",
    "how do I say good night",
    "sleep well",
    "oyasumi",
    "おやすみ"
  ], "おやすみなさい is polite. おやすみ is for family and friends.", [
    ["おやすみなさい。", "おやすみなさい。", "Good night.", "polite"],
    ["おやすみ。", "おやすみ。", "Night.", "casual"]
  ], [["おやすみ", "おやすみ"]]),
  s("greet-before-meal", "Before you eat", "greetings", [
    "what do you say before eating",
    "let's eat",
    "bon appetit in japanese",
    "itadakimasu",
    "いただきます"
  ], "Say いただきます just before you start, including at a restaurant.", [
    ["いただきます。", "いただきます。", "Thanks for the meal, let's eat.", "polite"],
    ["じゃあ、いただくね。", "じゃあ、いただくね。", "Alright, I'll dig in.", "casual"]
  ], [["いただきます", "いただきます"]]),
  s("greet-after-meal", "After you eat", "greetings", [
    "what do you say after eating",
    "thanks for the meal",
    "that was delicious thanks",
    "gochisousama",
    "ごちそうさま"
  ], "ごちそうさまです thanks the person who cooked or paid. Use it as you finish.", [
    ["ごちそうさまでした。", "ごちそうさまでした。", "Thank you for the meal.", "polite"],
    ["ごちそうさま。", "ごちそうさま。", "Thanks for the food.", "casual"]
  ], [["ごちそうさま", "ごちそうさま"]]),
  s("greet-thanks", "Saying thank you", "greetings", [
    "thank you",
    "thanks so much",
    "how do I thank someone",
    "arigatou",
    "ありがとう"
  ], "ありがとうございます is the default. どうも alone is lighter. 感謝します is stiff and written.", [
    ["ありがとうございます。", "ありがとうございます。", "Thank you.", "polite"],
    ["ありがとう。", "ありがとう。", "Thanks.", "casual"]
  ], [["ありがとう", "ありがとう"]]),
  s("greet-thanks-past", "Thanks for the other day", "greetings", [
    "thanks for the other day",
    "thanks for last time",
    "what to say when you see someone again",
    "senjitsu wa",
    "この間はありがとう"
  ], "先日はどうも is the set phrase the next time you meet after a favor or a meal.", [
    ["先日はありがとうございました。", "せんじつはありがとうございました。", "Thank you for the other day.", "polite"],
    ["この間はありがとう。", "このあいだはありがとう。", "Thanks for the other day.", "casual"]
  ], [["先日", "せんじつ"], ["ありがとう", "ありがとう"]]),
  s("greet-excuse", "Excuse me or sorry", "greetings", [
    "excuse me",
    "sorry to bother you",
    "how do I get someone's attention",
    "sumimasen",
    "すみません"
  ], "すみません covers sorry, excuse me, and thank you. ごめんなさい is a real apology.", [
    ["すみません。", "すみません。", "Excuse me.", "polite"],
    ["ごめん。", "ごめん。", "Sorry.", "casual"]
  ], [["すみません", "すみません"], ["ごめん", "ごめん"]]),
  s("greet-deep-apology", "A serious apology", "greetings", [
    "I'm truly sorry",
    "how do I apologize formally",
    "sorry I messed up",
    "moushiwake arimasen",
    "申し訳ない"
  ], "申し訳ございません is for a real mistake with a customer or a boss. It is too heavy for bumping into someone.", [
    ["申し訳ございません。", "もうしわけございません。", "I'm very sorry.", "formal"],
    ["本当にごめんなさい。", "ほんとうにごめんなさい。", "I'm really sorry.", "polite"]
  ], [["申し訳", "もうしわけ"], ["ごめん", "ごめん"]]),
  s("intro-name", "Saying your name", "introductions", [
    "my name is",
    "how do I introduce myself",
    "let me introduce myself",
    "how to say my name",
    "自己紹介",
    "名前を言う"
  ], "First meetings start with はじめまして, then your name, then よろしくお願いします. と申します is humbler than です.", [
    ["はじめまして、田中と申します。", "はじめまして、たなかともうします。", "How do you do? My name is Tanaka.", "polite"],
    ["田中です。よろしくお願いします。", "たなかです。よろしくおねがいします。", "I'm Tanaka. Nice to meet you.", "polite"]
  ], [["自己紹介", "じこしょうかい"], ["名乗る", "なのる"], ["名前", "なまえ"]]),
  s("intro-origin", "Saying where you're from", "introductions", [
    "I'm from",
    "where are you from",
    "how do I say my country",
    "I come from Canada",
    "出身"
  ], "〜から来ました is the simple pattern. 出身です is 'I'm from' in the hometown sense.", [
    ["カナダから来ました。", "カナダからきました。", "I'm from Canada.", "polite"],
    ["出身はどこですか。", "しゅっしんはどこですか。", "Where are you from?", "polite"]
  ], [["出身", "しゅっしん"], ["来る", "くる"]]),
  s("intro-job", "Saying what you do", "introductions", [
    "what do you do",
    "I work as",
    "how do I say my job",
    "I'm an office worker",
    "仕事は何"
  ], "会社員です covers a generic office job. Name the actual job when you have a common word for it.", [
    ["会社員をしています。", "かいしゃいんをしています。", "I work as an office employee.", "polite"],
    ["お仕事は何をされていますか。", "おしごとはなにをされていますか。", "What do you do?", "polite"]
  ], [["会社員", "かいしゃいん"], ["仕事", "しごと"]]),
  s("intro-student", "Saying you're a student", "introductions", [
    "I'm a student",
    "I study at",
    "how do I say I'm in college",
    "大学で勉強しています",
    "学生です"
  ], "学生です is enough. Add the school or subject only if they ask.", [
    ["学生です。", "がくせいです。", "I'm a student.", "polite"],
    ["大学で日本語を勉強しています。", "だいがくでにほんごをべんきょうしています。", "I study Japanese at university.", "polite"]
  ], [["学生", "がくせい"], ["勉強", "べんきょう"]]),
  s("intro-hobby", "Talking about a hobby", "introductions", [
    "my hobby is",
    "what do you do for fun",
    "how do I say I like movies",
    "趣味は何",
    "hobbies"
  ], "趣味は〜です is the textbook frame and still natural. Friends say 〜が好き.", [
    ["趣味は映画を見ることです。", "しゅみはえいがをみることです。", "My hobby is watching movies.", "polite"],
    ["休みの日は何をしてるの？", "やすみのひはなにをしてるの？", "What do you do on your days off?", "casual"]
  ], [["趣味", "しゅみ"], ["映画", "えいが"]]),
  s("intro-yoroshiku", "Please treat me well", "introductions", [
    "nice to meet you",
    "please be kind to me",
    "how do I end an introduction",
    "yoroshiku onegaishimasu",
    "よろしく"
  ], "よろしくお願いします closes an introduction, a request, and the start of working together. There is no tidy English equivalent.", [
    ["よろしくお願いします。", "よろしくおねがいします。", "I look forward to working with you.", "polite"],
    ["よろしく。", "よろしく。", "Nice to meet you.", "casual"]
  ], [["よろしく", "よろしく"]]),
  s("intro-age", "Saying your age", "introductions", [
    "how old are you",
    "I'm 25 years old",
    "how do I say my age",
    "歳です",
    "年齢"
  ], "〜歳です is normal. Asking a stranger their age is less casual than in some English contexts.", [
    ["二十五歳です。", "にじゅうごさいです。", "I'm 25.", "polite"],
    ["何歳ですか。", "なんさいですか。", "How old are you?", "polite"]
  ], [["年齢", "ねんれい"], ["歳", "さい"]]),
  s("intro-live", "Saying where you live", "introductions", [
    "I live in Tokyo",
    "where do you live",
    "how do I say my neighborhood",
    "住んでいます",
    "どこに住んでる"
  ], "〜に住んでいます is the pattern. どちらにお住まいですか is the polite question.", [
    ["東京に住んでいます。", "とうきょうにすんでいます。", "I live in Tokyo.", "polite"],
    ["今どこに住んでるの？", "いまどこにすんでるの？", "Where are you living now?", "casual"]
  ], [["住む", "すむ"], ["東京", "とうきょう"]]),
  s("intro-friend", "Introducing a friend", "introductions", [
    "this is my friend",
    "how do I introduce someone else",
    "let me introduce my friend",
    "友達を紹介",
    "こちらは"
  ], "こちらは is the polite 'this is'. Pointing with この人 is rougher.", [
    ["こちらは友達の田中さんです。", "こちらはともだちのたなかさんです。", "This is my friend Tanaka.", "polite"],
    ["友達の田中。", "ともだちのたなか。", "This is my friend Tanaka.", "casual"]
  ], [["友達", "ともだち"], ["紹介", "しょうかい"]]),
  s("intro-ask-origin", "Asking where someone is from", "introductions", [
    "where are you from",
    "ask someone their hometown",
    "どちらから",
    "where did you come from"
  ], "どちらからいらっしゃいましたか is polite. 出身は？ is the short version.", [
    ["どちらからいらっしゃいましたか。", "どちらからいらっしゃいましたか。", "Where are you from?", "polite"],
    ["出身、どこ？", "しゅっしん、どこ？", "Where are you from?", "casual"]
  ], [["出身", "しゅっしん"], ["どちら", "どちら"]]),
  s("shop-price", "Asking the price", "shopping", [
    "how much is this",
    "what's the price",
    "how much does this cost",
    "いくらですか",
    "asking the price"
  ], "これ、いくらですか is the normal question. Point if これ isn't clear.", [
    ["これ、いくらですか。", "これ、いくらですか。", "How much is this?", "polite"],
    ["いくら？", "いくら？", "How much?", "casual"]
  ], [["いくら", "いくら"]]),
  s("shop-looking", "I'm looking for something", "shopping", [
    "I'm looking for",
    "do you have",
    "where can I find",
    "探しています",
    "ありますか"
  ], "〜を探しているんですが is a soft way to start. Staff then ask what kind.", [
    ["これを探しているんですが。", "これをさがしているんですが。", "I'm looking for this.", "polite"],
    ["これ、ありますか。", "これ、ありますか。", "Do you have this?", "polite"]
  ], [["探す", "さがす"], ["ある", "ある"]]),
  s("shop-try-on", "Asking to try something on", "shopping", [
    "can I try this on",
    "where is the fitting room",
    "try on clothes",
    "試着してもいい",
    "fitting room"
  ], "試着してもいいですか is the request. They'll point you to the room.", [
    ["試着してもいいですか。", "しちゃくしてもいいですか。", "May I try this on?", "polite"],
    ["試着室はどこですか。", "しちゃくしつはどこですか。", "Where is the fitting room?", "polite"]
  ], [["試着", "しちゃく"]]),
  s("shop-card", "Paying by card", "shopping", [
    "can I pay by card",
    "do you take credit cards",
    "card payment",
    "カードで払えますか",
    "credit card"
  ], "カードで払えますか covers credit and debit. Some small shops are cash only.", [
    ["カードで払えますか。", "カードではらえますか。", "Can I pay by card?", "polite"],
    ["現金だけですか。", "げんきんだけですか。", "Is it cash only?", "polite"]
  ], [["払う", "はらう"], ["現金", "げんきん"]]),
  s("shop-cash", "Paying with cash", "shopping", [
    "I'll pay cash",
    "cash please",
    "paying with cash",
    "現金で",
    "genkin"
  ], "現金でお願いします is enough at the register. No need to explain.", [
    ["現金でお願いします。", "げんきんをおねがいします。", "Cash, please.", "polite"],
    ["現金で払います。", "げんきんではらいます。", "I'll pay cash.", "polite"]
  ], [["現金", "げんきん"], ["払う", "はらう"]]),
  s("shop-no-bag", "I don't need a bag", "shopping", [
    "I don't need a bag",
    "no bag please",
    "袋はいらない",
    "skip the plastic bag"
  ], "袋はいりません is the set line. Shops often charge for bags.", [
    ["袋はいりません。", "ふくろはいりません。", "I don't need a bag.", "polite"],
    ["袋、大丈夫です。", "ふくろ、だいじょうぶです。", "No bag, thanks.", "polite"]
  ], [["袋", "ふくろ"], ["要る", "いる"]]),
  s("shop-bag", "I'd like a bag", "shopping", [
    "can I have a bag",
    "I need a bag",
    "袋をください",
    "plastic bag please"
  ], "袋をください is direct and fine. They may ask you to pay for it.", [
    ["袋をください。", "ふくろをください。", "A bag, please.", "polite"],
    ["袋、もらってもいいですか。", "ふくろ、もらってもいいですか。", "Could I have a bag?", "polite"]
  ], [["袋", "ふくろ"]]),
  s("shop-receipt", "Asking for a receipt", "shopping", [
    "receipt please",
    "can I have a receipt",
    "I need a receipt for expenses",
    "レシートください",
    "領収書"
  ], "レシート is the register slip. 領収書 is the formal receipt with the shop's stamp, for expenses.", [
    ["レシートをお願いします。", "レシートをおねがいします。", "A receipt, please.", "polite"],
    ["領収書をいただけますか。", "りょうしゅうしょをいただけますか。", "Could I have a formal receipt?", "polite"]
  ], [["レシート", "レシート"], ["領収書", "りょうしゅうしょ"]]),
  s("shop-just-looking", "Just looking", "shopping", [
    "I'm just looking",
    "just browsing",
    "no thanks I'm looking",
    "見ているだけ",
    "just looking around"
  ], "見ているだけです is the answer when staff ask if they can help.", [
    ["見ているだけです。", "みているだけです。", "I'm just looking.", "polite"],
    ["ちょっと見てるだけ。", "ちょっとみてるだけ。", "Just having a look.", "casual"]
  ], [["見る", "みる"]]),
  s("shop-cheaper", "Asking for something cheaper", "shopping", [
    "do you have anything cheaper",
    "something less expensive",
    "a cheaper one",
    "もう少し安い",
    "cheaper please"
  ], "もう少し安いのはありますか is polite. Don't say 高いですね about their goods.", [
    ["もう少し安いのはありますか。", "もうすこしやすいのはありますか。", "Do you have anything a bit cheaper?", "polite"],
    ["予算は三千円くらいです。", "よさんはさんぜんえんくらいです。", "My budget is about 3,000 yen.", "polite"]
  ], [["安い", "やすい"], ["予算", "よさん"]]),
  s("shop-sold-out", "Asking if it's sold out", "shopping", [
    "is this sold out",
    "do you have any left",
    "when will you have more",
    "売り切れ",
    "sold out"
  ], "売り切れですか is the question. 入荷 is when new stock arrives.", [
    ["これ、売り切れですか。", "これ、うりきれですか。", "Is this sold out?", "polite"],
    ["次はいつ入ってきますか。", "つぎはいつはいってきますか。", "When will you get more?", "polite"]
  ], [["売り切れ", "うりきれ"], ["入る", "はいる"]]),
  s("shop-gift-wrap", "Asking for gift wrap", "shopping", [
    "gift wrap please",
    "can you wrap this",
    "it's a present",
    "ギフト包装",
    "wrapping"
  ], "ギフト包装をお願いします is understood everywhere. Some shops only wrap at a service counter.", [
    ["ギフト包装をお願いします。", "ギフトほうそうをおねがいします。", "Gift wrap, please.", "polite"],
    ["プレゼントなので包んでもらえますか。", "プレゼントなのでつつんでもらえますか。", "It's a present. Could you wrap it?", "polite"]
  ], [["包装", "ほうそう"], ["包む", "つつむ"]]),
  s("shop-open", "Asking if a shop is open", "shopping", [
    "are you open",
    "what time do you open",
    "are you still open",
    "営業していますか",
    "opening hours"
  ], "今開いていますか works on the phone or at a shutter. 営業時間は？ asks for the hours.", [
    ["今、開いていますか。", "いま、あいていますか。", "Are you open now?", "polite"],
    ["何時までやっていますか。", "なんじまでやっていますか。", "What time do you stay open until?", "polite"]
  ], [["開く", "あく"], ["営業", "えいぎょう"]]),
  s("food-order", "Ordering food", "food", [
    "I'd like to order",
    "I'll have this",
    "how do I order",
    "これください",
    "ordering at a restaurant"
  ], "Point and say これをください. Calling the staff with すみません is normal.", [
    ["これをください。", "これをください。", "This one, please.", "polite"],
    ["注文いいですか。", "ちゅうもんいいですか。", "Can I order?", "casual"]
  ], [["注文", "ちゅうもん"], ["ください", "ください"]]),
  s("food-recommend", "Asking for a recommendation", "food", [
    "what do you recommend",
    "what's good here",
    "any recommendations",
    "おすすめは何",
    "osusume"
  ], "おすすめは何ですか is the standard question. おすすめで is 'I'll have whatever you recommend'.", [
    ["おすすめは何ですか。", "おすすめはなんですか。", "What do you recommend?", "polite"],
    ["おすすめでお願いします。", "おすすめでおねがいします。", "I'll have the recommendation.", "polite"]
  ], [["勧める", "すすめる"], ["おすすめ", "おすすめ"]]),
  s("food-water", "Asking for water", "food", [
    "water please",
    "can I get some water",
    "a glass of water",
    "お水ください",
    "mizu"
  ], "お水をください is enough. Free water is common; you still ask.", [
    ["お水をください。", "おみずをください。", "Water, please.", "polite"],
    ["お冷をください。", "おひやをください。", "Cold water, please.", "polite"]
  ], [["水", "みず"]]),
  s("food-bill", "Asking for the check", "food", [
    "check please",
    "the bill please",
    "can I pay",
    "お会計",
    "how do I ask for the bill"
  ], "お会計お願いします is the normal call. Many places you pay at the register, not at the table.", [
    ["お会計お願いします。", "おかいけいおねがいします。", "The check, please.", "polite"],
    ["お会計、向こうで。", "おかいけい、むこうで。", "You pay over there.", "casual"]
  ], [["会計", "かいけい"]]),
  s("food-delicious", "Saying the food is good", "food", [
    "this is delicious",
    "it tastes great",
    "how do I compliment the food",
    "おいしい",
    "oishii"
  ], "おいしいです is the safe compliment. 美味しいですね invites agreement.", [
    ["おいしいです。", "おいしいです。", "This is delicious.", "polite"],
    ["すごくおいしい。", "すごくおいしい。", "This is really good.", "casual"]
  ], [["おいしい", "おいしい"]]),
  s("food-allergy", "Saying you have an allergy", "food", [
    "I have an allergy",
    "I'm allergic to peanuts",
    "does this contain",
    "アレルギー",
    "food allergy"
  ], "Name the ingredient: 卵アレルギーがあります. Staff take アレルギー more seriously than 苦手.", [
    ["卵アレルギーがあります。", "たまごアレルギーがあります。", "I have an egg allergy.", "polite"],
    ["これにナッツは入っていますか。", "これにナッツははいっていますか。", "Does this contain nuts?", "polite"]
  ], [["アレルギー", "アレルギー"], ["卵", "たまご"]]),
  s("food-no-ice", "No ice please", "food", [
    "no ice please",
    "without ice",
    "hold the ice",
    "氷なし",
    "koori nashi"
  ], "氷なしで is the short order. Say it when you order the drink, not after.", [
    ["氷なしでお願いします。", "こおりなしでおねがいします。", "No ice, please.", "polite"],
    ["氷、少なめで。", "こおり、すくなめで。", "Just a little ice.", "casual"]
  ], [["氷", "こおり"]]),
  s("food-takeout", "Ordering to go", "food", [
    "to go please",
    "takeout",
    "for takeaway",
    "持ち帰り",
    "take away"
  ], "持ち帰りでお願いします is the phrase. Some shops say テイクアウト.", [
    ["持ち帰りでお願いします。", "もちかえりでおねがいします。", "To go, please.", "polite"],
    ["こちらで食べます。", "こちらでたべます。", "For here.", "polite"]
  ], [["持ち帰り", "もちかえり"], ["食べる", "たべる"]]),
  s("food-here", "Eating in", "food", [
    "for here",
    "I'll eat here",
    "eat in please",
    "店内で",
    "for here or to go"
  ], "The staff often ask 店内でお持ち帰りで？ Answer 店内で.", [
    ["店内でお願いします。", "てんないでおねがいします。", "For here, please.", "polite"],
    ["ここで食べます。", "ここでたべます。", "I'll eat here.", "polite"]
  ], [["店", "みせ"], ["食べる", "たべる"]]),
  s("food-no-meat", "Saying you don't eat meat", "food", [
    "I don't eat meat",
    "I'm vegetarian",
    "no meat please",
    "肉は食べません",
    "vegetarian"
  ], "肉は食べません is clear. 野菜料理はありますか asks what you can actually order.", [
    ["肉は食べられません。", "にくはたべられません。", "I can't eat meat.", "polite"],
    ["野菜の料理はありますか。", "やさいのりょうりはありますか。", "Do you have a vegetable dish?", "polite"]
  ], [["肉", "にく"], ["野菜", "やさい"]]),
  s("food-reservation", "Saying you have a reservation", "food", [
    "I have a reservation",
    "reservation under the name",
    "table booked for Tanaka",
    "予約しています",
    "yoyaku"
  ], "予約した田中です is the line at the door. Have the time ready.", [
    ["田中で予約しています。", "たなかでよやくしています。", "I have a reservation under Tanaka.", "polite"],
    ["七時に予約したんですが。", "しちじによやくしたんですが。", "I booked for seven.", "polite"]
  ], [["予約", "よやく"]]),
  s("food-party-size", "Saying how many people", "food", [
    "table for two",
    "we are three",
    "how many in your party",
    "二人です",
    "party of four"
  ], "二人です is the answer when they ask 何名様ですか. Use 名様 only about other people, not yourself.", [
    ["二名です。", "にめいです。", "Two, please.", "polite"],
    ["三人なんだけど、入れる？", "さんにんなんだけど、はいる？", "There's three of us. Can you fit us?", "casual"]
  ], [["二人", "ふたり"], ["三人", "さんにん"]]),
  s("food-menu", "Asking for the menu", "food", [
    "can I see the menu",
    "menu please",
    "do you have an English menu",
    "メニューを見せて",
    "english menu"
  ], "メニューをください is normal. 英語のメニューはありますか is worth asking.", [
    ["メニューを見せてください。", "メニューをみせてください。", "Could I see the menu?", "polite"],
    ["英語のメニューはありますか。", "えいごのメニューはありますか。", "Do you have an English menu?", "polite"]
  ], [["メニュー", "メニュー"], ["英語", "えいご"]]),
  s("food-spicy", "Asking if it's spicy", "food", [
    "is this spicy",
    "how spicy is it",
    "I can't handle spice",
    "辛いですか",
    "not too spicy"
  ], "辛いですか is the question. 苦手です is softer than 食べられません.", [
    ["これ、辛いですか。", "これ、からいですか。", "Is this spicy?", "polite"],
    ["辛いのはちょっと苦手です。", "からいのはちょっとにがてです。", "I'm not great with spicy food.", "polite"]
  ], [["辛い", "からい"], ["苦手", "にがて"]]),
  s("food-separate", "Separate checks", "food", [
    "separate checks",
    "can we split the bill",
    "pay separately",
    "別々で",
    "separate bills"
  ], "別々でお願いします at the end. Some small shops can't split cards.", [
    ["別々でお願いします。", "べつべつでおねがいします。", "Separate checks, please.", "polite"],
    ["割り勘で。", "わりかんで。", "Let's split it.", "casual"]
  ], [["別々", "べつべつ"], ["割り勘", "わりかん"]]),
  s("transit-station", "Finding the station", "transport", [
    "where is the station",
    "how do I get to the station",
    "nearest station",
    "駅はどこ",
    "which way to the station"
  ], "駅はどこですか is the question. Add the line name if there are several.", [
    ["駅はどこですか。", "えきはどこですか。", "Where is the station?", "polite"],
    ["一番近い駅はどこですか。", "いちばんちかいえきはどこですか。", "Which station is closest?", "polite"]
  ], [["駅", "えき"], ["近い", "ちかい"]]),
  s("transit-ticket", "Buying a ticket", "transport", [
    "one ticket to",
    "how do I buy a train ticket",
    "a ticket to Shinjuku",
    "切符をください",
    "train ticket"
  ], "新宿まで一枚 is the pattern at a counter. Machines are usual in cities.", [
    ["新宿まで一枚ください。", "しんじゅくまでいちまいください。", "One ticket to Shinjuku, please.", "polite"],
    ["往復でお願いします。", "おうふくでおねがいします。", "A round trip, please.", "polite"]
  ], [["切符", "きっぷ"], ["往復", "おうふく"]]),
  s("transit-last", "Asking about the last train", "transport", [
    "when is the last train",
    "what time is the last train",
    "did I miss the last train",
    "終電",
    "last train home"
  ], "終電は何時ですか is the question. Staff and station screens both answer it.", [
    ["終電は何時ですか。", "しゅうでんはなんじですか。", "What time is the last train?", "polite"],
    ["終電、逃したかも。", "しゅうでん、のがしたかも。", "I might have missed the last train.", "casual"]
  ], [["終電", "しゅうでん"], ["逃す", "のがす"]]),
  s("transit-transfer", "Asking where to transfer", "transport", [
    "where do I transfer",
    "which station do I change at",
    "how do I change trains",
    "乗り換え",
    "transfer"
  ], "どこで乗り換えますか is the question. Follow the colored 乗り換え signs.", [
    ["どこで乗り換えますか。", "どこでのりかえますか。", "Where do I transfer?", "polite"],
    ["この電車、渋谷で乗り換え？", "このでんしゃ、しぶやでのりかえ？", "Do I change at Shibuya?", "casual"]
  ], [["乗り換え", "のりかえ"], ["電車", "でんしゃ"]]),
  s("transit-taxi", "Giving a taxi driver an address", "transport", [
    "to this address please",
    "take me to the station",
    "how do I tell a taxi driver",
    "この住所まで",
    "taxi please"
  ], "Show the map and say ここまでお願いします. Naming a station is the backup.", [
    ["この住所までお願いします。", "このじゅうしょまでおねがいします。", "To this address, please.", "polite"],
    ["駅までお願いします。", "えきまでおねがいします。", "To the station, please.", "polite"]
  ], [["住所", "じゅうしょ"], ["タクシー", "タクシー"]]),
  s("transit-stop", "Asking the taxi to stop", "transport", [
    "stop here please",
    "pull over here",
    "you can drop me here",
    "ここで止めて",
    "stop the taxi"
  ], "ここで止めてください is clear. この先の角で is 'at the next corner'.", [
    ["ここで止めてください。", "ここでとめてください。", "Please stop here.", "polite"],
    ["そこで大丈夫です。", "そこでだいじょうぶです。", "Here is fine.", "polite"]
  ], [["止める", "とめる"], ["大丈夫", "だいじょうぶ"]]),
  s("transit-card", "Asking if a transit card works", "transport", [
    "does this take Suica",
    "can I use my IC card",
    "transit card",
    "スイカ使えますか",
    "ic card"
  ], "このカードは使えますか works for Suica, Pasmo, and other IC cards.", [
    ["このカードは使えますか。", "このカードはつかえますか。", "Can I use this card?", "polite"],
    ["チャージはどこでできますか。", "チャージはどこでできますか。", "Where can I add money to this?", "polite"]
  ], [["カード", "カード"], ["使う", "つかう"]]),
  s("transit-missed", "I missed my stop", "transport", [
    "I missed my stop",
    "I stayed on too long",
    "how do I say I missed the station",
    "乗り過ごしました",
    "went past my stop"
  ], "乗り過ごしました tells the conductor or a passenger. Then ask how to get back.", [
    ["乗り過ごしました。", "のりすごしました。", "I missed my stop.", "polite"],
    ["次で降りた方がいいですか。", "つぎでおりたほうがいいですか。", "Should I get off at the next one?", "polite"]
  ], [["乗り過ごす", "のりすごす"], ["降りる", "おりる"]]),
  s("transit-platform", "Asking which platform", "transport", [
    "which platform",
    "what platform is the train on",
    "where do I board",
    "何番線",
    "platform number"
  ], "何番線ですか is the question. The answer is a number plus 番線.", [
    ["何番線ですか。", "なんばんせんですか。", "Which platform is it?", "polite"],
    ["３番線から出ます。", "さんばんせんからでます。", "It leaves from platform 3.", "polite"]
  ], [["番線", "ばんせん"], ["出る", "でる"]]),
  s("transit-airport", "Getting to the airport", "transport", [
    "bus to the airport",
    "how do I get to the airport",
    "train to Narita",
    "空港へのバス",
    "airport bus"
  ], "空港行きのバスはどこから出ますか is the question at a station. Name the airport if there are two.", [
    ["空港行きのバスはどこから出ますか。", "くうこういきのバスはどこからでますか。", "Where does the airport bus leave from?", "polite"],
    ["成田までどうやって行きますか。", "なりたまでどうやっていきますか。", "How do I get to Narita?", "polite"]
  ], [["空港", "くうこう"], ["バス", "バス"]]),
  s("dir-lost", "Saying you're lost", "directions", [
    "I'm lost",
    "I don't know where I am",
    "can you help me I'm lost",
    "道に迷いました",
    "lost"
  ], "道に迷いました is the line. Then show a map pin.", [
    ["道に迷いました。", "みちにまよいました。", "I'm lost.", "polite"],
    ["ここはどこですか。", "ここはどこですか。", "Where is this?", "polite"]
  ], [["迷う", "まよう"], ["道", "みち"]]),
  s("dir-how", "Asking how to get somewhere", "directions", [
    "how do I get to",
    "what's the way to",
    "how do I get there",
    "どうやって行きますか",
    "directions to"
  ], "〜までどうやって行きますか is the pattern. Show the name on your phone.", [
    ["市役所までどうやって行きますか。", "しやくしょまでどうやっていきますか。", "How do I get to city hall?", "polite"],
    ["この辺で合ってますか。", "このへんであってますか。", "Am I in the right area?", "polite"]
  ], [["行く", "いく"], ["市役所", "しやくしょ"]]),
  s("dir-left", "Telling someone to turn", "directions", [
    "turn left",
    "turn right",
    "take a left",
    "左に曲がって",
    "turn right at the corner"
  ], "左に曲がってください is the instruction. 信号を渡って is 'cross at the light'.", [
    ["左に曲がってください。", "ひだりにまがってください。", "Please turn left.", "polite"],
    ["右の角を曲がると着きます。", "みぎのかどをまがるとつきます。", "Turn the right corner and you're there.", "polite"]
  ], [["左", "ひだり"], ["右", "みぎ"], ["曲がる", "まがる"]]),
  s("dir-straight", "Go straight", "directions", [
    "go straight",
    "keep going straight",
    "straight ahead",
    "まっすぐ",
    "massugu"
  ], "まっすぐ行ってください is the instruction. Add a landmark so it isn't vague.", [
    ["まっすぐ行ってください。", "まっすぐいってください。", "Go straight.", "polite"],
    ["この道をまっすぐです。", "このみちをまっすぐです。", "Straight down this street.", "polite"]
  ], [["まっすぐ", "まっすぐ"], ["道", "みち"]]),
  s("dir-nearby", "Asking what's nearby", "directions", [
    "is there a convenience store nearby",
    "anything nearby",
    "is there a konbini around here",
    "近くにコンビニ",
    "near here"
  ], "近くにコンビニはありますか is the pattern. Swap in the place: 郵便局, 薬局, 銀行.", [
    ["近くにコンビニはありますか。", "ちかくにコンビニはありますか。", "Is there a convenience store nearby?", "polite"],
    ["この辺に郵便局ありますか。", "このへんにゆうびんきょくありますか。", "Is there a post office around here?", "casual"]
  ], [["近い", "ちかい"], ["コンビニ", "コンビニ"]]),
  s("dir-map", "Asking someone to show a map", "directions", [
    "can you show me on the map",
    "could you point to it",
    "show me where",
    "地図で教えて",
    "on the map"
  ], "地図で示してもらえますか lets them point. Hand them your phone already open.", [
    ["地図で示してもらえますか。", "ちずでしめしてもらえますか。", "Could you show me on the map?", "polite"],
    ["この辺ですか。", "このへんですか。", "Is it around here?", "polite"]
  ], [["地図", "ちず"], ["示す", "しめす"]]),
  s("dir-exit", "Finding the exit", "directions", [
    "where is the exit",
    "which exit",
    "how do I get out of the station",
    "出口はどこ",
    "station exit"
  ], "出口はどこですか is the question. Station exits are numbered: 東口, ３番出口.", [
    ["出口はどこですか。", "でぐちはどこですか。", "Where is the exit?", "polite"],
    ["東口から出たいんですが。", "ひがしぐちからでたいんですが。", "I want to leave from the east exit.", "polite"]
  ], [["出口", "でぐち"], ["出る", "でる"]]),
  s("health-sick", "Saying you feel sick", "health", [
    "I feel sick",
    "I don't feel well",
    "I'm not feeling great",
    "具合が悪い",
    "feel ill"
  ], "具合が悪いです is the general line. Then say where it hurts if you know.", [
    ["具合が悪いです。", "ぐあいがわるいです。", "I don't feel well.", "polite"],
    ["気持ち悪いです。", "きもちわるいです。", "I feel nauseous.", "polite"]
  ], [["具合", "ぐあい"], ["悪い", "わるい"]]),
  s("health-headache", "Saying you have a headache", "health", [
    "I have a headache",
    "my head hurts",
    "headache",
    "頭が痛い",
    "zutsuu"
  ], "頭が痛いです is what you tell a person. 頭痛がします is a bit more clinical.", [
    ["頭が痛いです。", "あたまがいたいです。", "I have a headache.", "polite"],
    ["頭痛がします。", "ずつうがします。", "I have a headache.", "polite"]
  ], [["頭", "あたま"], ["痛い", "いたい"]]),
  s("health-pharmacy", "Finding a pharmacy", "health", [
    "where is a pharmacy",
    "I need a drugstore",
    "pharmacy nearby",
    "薬局はどこ",
    "drugstore"
  ], "薬局はどこですか is the question. ドラッグストア is the larger shop.", [
    ["薬局はどこですか。", "やっきょくはどこですか。", "Where is a pharmacy?", "polite"],
    ["風邪薬はどこにありますか。", "かぜぐすりはどこにありますか。", "Where is the cold medicine?", "polite"]
  ], [["薬局", "やっきょく"], ["薬", "くすり"]]),
  s("health-doctor", "Asking to see a doctor", "health", [
    "I need a doctor",
    "I'd like to see a doctor",
    "can I get an appointment",
    "医者にかかりたい",
    "see a doctor"
  ], "診察をお願いしたいです is the line at reception. Bring your insurance card if you have one.", [
    ["診察をお願いしたいです。", "しんさつをおねがいしたいです。", "I'd like to see a doctor.", "polite"],
    ["今日、診てもらえますか。", "きょう、みてもらえますか。", "Can someone see me today?", "polite"]
  ], [["診察", "しんさつ"], ["医者", "いしゃ"]]),
  s("health-cold", "Saying you have a cold", "health", [
    "I have a cold",
    "I caught a cold",
    "I'm sick with a cold",
    "風邪をひいた",
    "kaze"
  ], "風邪をひきました is the usual line. Stay home is the expected follow-through.", [
    ["風邪をひきました。", "かぜをひきました。", "I caught a cold.", "polite"],
    ["ちょっと風邪気味です。", "ちょっとかぜぎみです。", "I feel a cold coming on.", "polite"]
  ], [["風邪", "かぜ"], ["熱", "ねつ"]]),
  s("health-hurt", "Showing where it hurts", "health", [
    "it hurts here",
    "this is where it hurts",
    "my stomach hurts",
    "ここが痛い",
    "pain"
  ], "Point and say ここが痛いです. お腹 is the belly, 胃 is the stomach.", [
    ["ここが痛いです。", "ここがいたいです。", "It hurts here.", "polite"],
    ["お腹が痛いです。", "おなかがいたいです。", "My stomach hurts.", "polite"]
  ], [["痛い", "いたい"], ["お腹", "おなか"]]),
  s("work-late", "Apologizing for being late", "work", [
    "sorry I'm late",
    "I apologize for being late",
    "running late to work",
    "遅れてすみません",
    "late for a meeting"
  ], "遅れてすみません is the arrival line. Add a short reason only if it's useful.", [
    ["遅れてすみません。", "おくれてすみません。", "Sorry I'm late.", "polite"],
    ["遅れて申し訳ございません。", "おくれてもうしわけございません。", "I'm sorry for arriving late.", "formal"]
  ], [["遅れる", "おくれる"], ["すみません", "すみません"]]),
  s("work-day-off", "Asking for a day off", "work", [
    "I'd like to take the day off",
    "can I have tomorrow off",
    "request a day off",
    "休みをいただきたい",
    "day off"
  ], "明日、休ませていただいてもいいですか is the careful request. Don't just announce 休みます to a boss.", [
    ["明日、休ませていただけますか。", "あした、やすませていただけますか。", "May I take tomorrow off?", "polite"],
    ["午後から休ませてください。", "ごごからやすませてください。", "Please let me leave this afternoon.", "polite"]
  ], [["休む", "やすむ"], ["休み", "やすみ"]]),
  s("work-sick-day", "Calling in sick", "work", [
    "I can't come in today",
    "calling in sick",
    "I'm too sick to work",
    "体調が悪くて",
    "not coming to work"
  ], "体調が悪くて、今日は休みます reports it. For a boss, add 申し訳ございません.", [
    ["体調が悪くて、今日は休ませてください。", "たいちょうがわるくて、きょうはやすませてください。", "I don't feel well. May I take today off?", "polite"],
    ["熱があるので、今日は休みます。", "ねつがあるので、きょうはやすみます。", "I have a fever, so I'm taking today off.", "polite"]
  ], [["体調", "たいちょう"], ["熱", "ねつ"]]),
  s("work-meeting", "Setting up a meeting", "work", [
    "let's schedule a meeting",
    "can we meet tomorrow",
    "are you free at three",
    "会議を入れたい",
    "set a meeting"
  ], "明日の三時はご都合いかがですか is the polite proposal. 空いていますか asks if a slot is free.", [
    ["明日の三時はご都合いかがですか。", "あしたのさんじはごつごういかがですか。", "Would three tomorrow work for you?", "polite"],
    ["ちょっと話せる？", "ちょっとはなせる？", "Got a minute to talk?", "casual"]
  ], [["会議", "かいぎ"], ["都合", "つごう"]]),
  s("work-email", "Saying you'll email", "work", [
    "I'll send an email",
    "I'll email you",
    "let me send that by email",
    "メールします",
    "send an email"
  ], "メールで送ります is the promise. 件名 is the subject line if you need the word.", [
    ["後でメールします。", "あとでメールします。", "I'll email you later.", "polite"],
    ["資料をメールで送ります。", "しりょうをメールでおくります。", "I'll send the document by email.", "polite"]
  ], [["メール", "メール"], ["送る", "おくる"]]),
  s("work-understood", "Saying you understand", "work", [
    "I understand",
    "got it",
    "understood",
    "承知しました",
    "wakarimashita"
  ], "承知しました is the workplace default to a boss. わかりました is fine with peers. 了解です is a bit casual for a client.", [
    ["承知しました。", "しょうちしました。", "Understood.", "polite"],
    ["わかった。", "わかった。", "Got it.", "casual"]
  ], [["承知", "しょうち"], ["分かる", "わかる"]]),
  s("work-confirm", "Asking someone to confirm", "work", [
    "please confirm",
    "could you check this",
    "let me know if this is right",
    "確認お願いします",
    "please review"
  ], "ご確認お願いします is the email line. In person, 見ていただけますか.", [
    ["ご確認お願いします。", "ごかくにんおねがいします。", "Could you confirm this?", "polite"],
    ["これで合っていますか。", "これであってますか。", "Is this correct?", "polite"]
  ], [["確認", "かくにん"], ["見る", "みる"]]),
  s("work-otsukare", "Thanks for your hard work", "work", [
    "good work today",
    "thanks for your hard work",
    "what do coworkers say",
    "お疲れ様",
    "otsukaresama"
  ], "お疲れ様です is the all-day workplace greeting: arriving, passing in the hall, and leaving.", [
    ["お疲れ様です。", "おつかれさまです。", "Thanks for your work.", "polite"],
    ["お疲れ。", "おつかれ。", "Good work.", "casual"]
  ], [["お疲れ様", "おつかれさま"]]),
  s("work-leaving", "Leaving the office", "work", [
    "I'm heading out",
    "I'm leaving for the day",
    "leaving before others",
    "お先に失礼します",
    "osaki ni"
  ], "お先に失礼します is what you say when you leave and others are still there.", [
    ["お先に失礼します。", "おさきにしつれいします。", "I'm leaving for the day.", "polite"],
    ["お先です。", "おさきです。", "Heading out.", "casual"]
  ], [["失礼", "しつれい"], ["先", "さき"]]),
  s("work-callback", "Saying you'll call back", "work", [
    "I'll call you back",
    "let me call you later",
    "I'll return your call",
    "折り返し電話",
    "call you back"
  ], "折り返しお電話します is the business line. Give a time if you can.", [
    ["折り返しお電話します。", "おりかえしおでんわします。", "I'll call you back.", "polite"],
    ["後で電話するね。", "あとででんわするね。", "I'll call you later.", "casual"]
  ], [["電話", "でんわ"], ["折り返す", "おりかえす"]]),
  s("phone-hello", "Answering the phone", "phone", [
    "hello on the phone",
    "how do you answer the phone",
    "moshi moshi",
    "もしもし",
    "this is Tanaka"
  ], "もしもし is the phone hello. Businesses answer with the company name, not もしもし.", [
    ["もしもし、田中です。", "もしもし、たなかです。", "Hello, this is Tanaka.", "polite"],
    ["はい、田中です。", "はい、たなかです。", "Yes, Tanaka speaking.", "polite"]
  ], [["もしもし", "もしもし"], ["電話", "でんわ"]]),
  s("phone-wrong", "Wrong number", "phone", [
    "wrong number",
    "I think you have the wrong number",
    "sorry wrong number",
    "番号を間違えました",
    "wrong person"
  ], "番号をお間違えではないですか is the polite check. Then 失礼します and hang up.", [
    ["番号を間違えました。", "ばんごうをまちがえました。", "I have the wrong number.", "polite"],
    ["こちらは田中ではありません。", "こちらはたなかではありません。", "There's no Tanaka here.", "polite"]
  ], [["番号", "ばんごう"], ["間違える", "まちがえる"]]),
  s("phone-hold", "Asking someone to hold", "phone", [
    "please hold",
    "one moment please",
    "could you wait a second",
    "少々お待ちください",
    "hold the line"
  ], "少々お待ちください is the business line. ちょっと待って is for friends.", [
    ["少々お待ちください。", "しょうしょうおまちください。", "Please hold for a moment.", "formal"],
    ["ちょっと待って。", "ちょっとまって。", "Hang on a second.", "casual"]
  ], [["待つ", "まつ"], ["少々", "しょうしょう"]]),
  s("phone-speak-to", "Asking to speak to someone", "phone", [
    "may I speak to",
    "is Tanaka there",
    "can I talk to",
    "いらっしゃいますか",
    "put me through"
  ], "田中さんはいらっしゃいますか is the polite request. Give your name when they ask.", [
    ["田中さんはいらっしゃいますか。", "たなかさんはいらっしゃいますか。", "May I speak with Tanaka?", "polite"],
    ["田中いる？", "たなかいる？", "Is Tanaka there?", "casual"]
  ], [["いらっしゃる", "いらっしゃる"], ["電話", "でんわ"]]),
  s("phone-message", "Leaving a message", "phone", [
    "can I leave a message",
    "please tell them I called",
    "take a message",
    "伝言",
    "leave a message"
  ], "伝言をお願いできますか starts it. Then your name and number, slowly.", [
    ["伝言をお願いできますか。", "でんごんをおねがいできますか。", "May I leave a message?", "polite"],
    ["田中から電話があったと伝えてください。", "たなかからでんわがあったとつたえてください。", "Please tell them Tanaka called.", "polite"]
  ], [["伝言", "でんごん"], ["伝える", "つたえる"]]),
  s("phone-hear", "I can't hear you", "phone", [
    "I can't hear you",
    "bad connection",
    "you're breaking up",
    "聞こえません",
    "poor signal"
  ], "電波が悪くて聞こえません explains a bad line. もう一度お願いします asks for a repeat.", [
    ["電波が悪くて、よく聞こえません。", "でんぱがわるくて、よくきこえません。", "The signal is bad and I can't hear you.", "polite"],
    ["もう一度お願いできますか。", "もういちどおねがいできますか。", "Could you say that again?", "polite"]
  ], [["電波", "でんぱ"], ["聞こえる", "きこえる"]]),
  s("phone-text", "Saying you'll text", "phone", [
    "I'll text you",
    "I'll message you later",
    "let me send a message",
    "メッセージする",
    "text you later"
  ], "ラインします is what people say for LINE. メッセージします is app-neutral.", [
    ["後でメッセージします。", "あとでメッセージします。", "I'll message you later.", "polite"],
    ["ラインするね。", "ラインするね。", "I'll LINE you.", "casual"]
  ], [["メッセージ", "メッセージ"], ["ライン", "ライン"]]),
  s("req-help", "Asking for help", "requests", [
    "can you help me",
    "I need help",
    "could you give me a hand",
    "手伝ってください",
    "help me"
  ], "手伝っていただけますか is the polite request. 助けて is for real trouble.", [
    ["手伝っていただけますか。", "てつだっていただけますか。", "Could you help me?", "polite"],
    ["ちょっと助けて。", "ちょっとたすけて。", "Give me a hand.", "casual"]
  ], [["手伝う", "てつだう"], ["助ける", "たすける"]]),
  s("req-slow", "Asking someone to speak slowly", "requests", [
    "please speak more slowly",
    "could you slow down",
    "slower please",
    "ゆっくり話して",
    "speak slowly"
  ], "もう少しゆっくりお願いできますか is polite and specific. People usually will.", [
    ["もう少しゆっくり話していただけますか。", "もうすこしゆっくりはなしていただけますか。", "Could you speak a little more slowly?", "polite"],
    ["ゆっくりお願い。", "ゆっくりおねがい。", "Slowly, please.", "casual"]
  ], [["ゆっくり", "ゆっくり"], ["話す", "はなす"]]),
  s("req-again", "Asking for a repeat", "requests", [
    "could you say that again",
    "one more time please",
    "I didn't catch that",
    "もう一度",
    "repeat that"
  ], "もう一度お願いできますか is the line. どういう意味ですか asks for the meaning instead.", [
    ["もう一度言っていただけますか。", "もういちどいっていただけますか。", "Could you say that once more?", "polite"],
    ["今の、もう一回。", "いまの、もういっかい。", "That again?", "casual"]
  ], [["言う", "いう"], ["もう", "もう"]]),
  s("req-english", "Asking if they speak English", "requests", [
    "do you speak English",
    "is there someone who speaks English",
    "English please",
    "英語話せますか",
    "speak english"
  ], "英語は話せますか is fine. Follow it with a Japanese attempt if you can.", [
    ["英語は話せますか。", "えいごははなせますか。", "Do you speak English?", "polite"],
    ["英語が話せる人はいますか。", "えいごがはなせるひとはいますか。", "Is there someone who speaks English?", "polite"]
  ], [["英語", "えいご"], ["話す", "はなす"]]),
  s("req-write", "Asking someone to write it down", "requests", [
    "please write it down",
    "can you write that",
    "write it for me",
    "書いてください",
    "write it down"
  ], "書いていただけますか saves a word you can't hear. Offer your phone notes app.", [
    ["書いていただけますか。", "かいていただけますか。", "Could you write it down?", "polite"],
    ["漢字で書いてもらえる？", "かんじでかいてもらえる？", "Can you write it in kanji?", "casual"]
  ], [["書く", "かく"], ["漢字", "かんじ"]]),
  s("req-photo", "Asking for a photo", "requests", [
    "can you take a photo",
    "could you take our picture",
    "photo please",
    "写真を撮って",
    "take a picture"
  ], "写真を撮っていただけますか with a small bow. Show them the shutter button.", [
    ["写真を撮っていただけますか。", "しゃしんをとっていただけますか。", "Could you take a photo?", "polite"],
    ["一緒に写真撮ろう。", "いっしょにしゃしんとろう。", "Let's take a photo together.", "casual"]
  ], [["写真", "しゃしん"], ["撮る", "とる"]]),
  s("req-wait", "Asking someone to wait", "requests", [
    "please wait a moment",
    "one second",
    "could you wait",
    "ちょっと待って",
    "wait a moment"
  ], "ちょっと待ってください is everyday. 少々お待ちください is the service version.", [
    ["ちょっと待ってください。", "ちょっとまってください。", "Please wait a moment.", "polite"],
    ["すぐ行くね。", "すぐいくね。", "I'll be right there.", "casual"]
  ], [["待つ", "まつ"], ["すぐ", "すぐ"]]),
  s("req-no", "Declining politely", "requests", [
    "no thank you",
    "I'm fine thanks",
    "how do I refuse",
    "結構です",
    "no thanks"
  ], "結構です declines an offer. 大丈夫です also works and is softer. Both can be misread as 'yes' if you nod.", [
    ["結構です。", "けっこうです。", "No thank you.", "polite"],
    ["大丈夫です、ありがとう。", "だいじょうぶです、ありがとう。", "I'm fine, thanks.", "polite"]
  ], [["結構", "けっこう"], ["大丈夫", "だいじょうぶ"]]),
  s("req-ok", "Agreeing", "requests", [
    "that's fine",
    "sounds good",
    "okay with me",
    "大丈夫です",
    "that works"
  ], "大丈夫です agrees when the plan is acceptable. いいですよ is warmer.", [
    ["大丈夫です。", "だいじょうぶです。", "That's fine.", "polite"],
    ["いいですよ。", "いいですよ。", "Sure, that's fine.", "casual"]
  ], [["大丈夫", "だいじょうぶ"], ["いい", "いい"]]),
  s("req-japanese", "Saying you'll try in Japanese", "requests", [
    "I'll try in Japanese",
    "let me say it in Japanese",
    "I want to practice Japanese",
    "日本語で言ってみます",
    "speak japanese"
  ], "日本語で言ってみます warns them before a slow sentence. People usually slow down.", [
    ["日本語で言ってみます。", "にほんごでいってみます。", "I'll try to say it in Japanese.", "polite"],
    ["日本語、まだ下手なんです。", "にほんご、まだへたなんです。", "My Japanese is still poor.", "polite"]
  ], [["日本語", "にほんご"], ["下手", "へた"]]),
  s("social-invite", "Inviting someone out", "social", [
    "would you like to get dinner",
    "want to grab a meal",
    "are you free this weekend",
    "夕食でもどう",
    "invite someone"
  ], "よかったら夕食でもどうですか leaves them room to decline. 空いてる？ is the casual check.", [
    ["よかったら夕食でもどうですか。", "よかったらゆうしょくでもどうですか。", "If you'd like, how about dinner?", "polite"],
    ["今度ごはん行かない？", "こんどごはんいかない？", "Want to get food sometime?", "casual"]
  ], [["夕食", "ゆうしょく"], ["行く", "いく"]]),
  s("social-accept", "Accepting an invitation", "social", [
    "I'd love to",
    "that sounds great",
    "yes let's do it",
    "ぜひ",
    "accept an invite"
  ], "ぜひ is the enthusiastic yes. Repeat the plan so the time is clear.", [
    ["ぜひ。楽しみにしています。", "ぜひ。たのしみにしています。", "I'd love to. I'm looking forward to it.", "polite"],
    ["行く行く。", "いくいく。", "I'm in.", "casual"]
  ], [["ぜひ", "ぜひ"], ["楽しみ", "たのしみ"]]),
  s("social-decline", "Turning down a plan", "social", [
    "I can't that day",
    "something came up",
    "how do I decline an invitation",
    "その日は難しくて",
    "can't make it"
  ], "その日はちょっと難しくて is the soft no. Offer another day if you mean it.", [
    ["その日はちょっと難しくて。", "そのひはちょっとむずかしくて。", "That day is a bit difficult.", "polite"],
    ["ごめん、その日は無理。", "ごめん、そのひはむり。", "Sorry, I can't that day.", "casual"]
  ], [["難しい", "むずかしい"], ["無理", "むり"]]),
  s("social-weekend", "Asking about the weekend", "social", [
    "what are you doing this weekend",
    "any plans this weekend",
    "weekend plans",
    "週末は何する",
    "plans for saturday"
  ], "週末は何か予定ありますか is the polite question. Friends drop か.", [
    ["週末は何か予定がありますか。", "しゅうまつはなにかよていがありますか。", "Do you have plans this weekend?", "polite"],
    ["今週末、空いてる？", "こんしゅうまつ、あいてる？", "Are you free this weekend?", "casual"]
  ], [["週末", "しゅうまつ"], ["予定", "よてい"]]),
  s("social-hobby-ask", "Asking about hobbies", "social", [
    "what do you do for fun",
    "do you have hobbies",
    "what are you into",
    "趣味は何",
    "hobbies question"
  ], "趣味は何ですか is textbook and still fine. 最近はまってるものは？ is more current.", [
    ["趣味は何ですか。", "しゅみはなんですか。", "What are your hobbies?", "polite"],
    ["最近何にはまってるの？", "さいきんなににはまってるの？", "What are you into lately?", "casual"]
  ], [["趣味", "しゅみ"], ["最近", "さいきん"]]),
  s("social-contact", "Asking for contact info", "social", [
    "what's your LINE",
    "can I get your number",
    "how can I contact you",
    "連絡先を教えて",
    "exchange contacts"
  ], "ラインを交換しませんか is the usual ask. 連絡先を教えてください is more general.", [
    ["連絡先を教えてもらえますか。", "れんらくさきをおしえてもらえますか。", "Could I have your contact info?", "polite"],
    ["ライン交換しない？", "ラインこうかんしない？", "Want to swap LINE?", "casual"]
  ], [["連絡", "れんらく"], ["ライン", "ライン"]]),
  s("social-compliment", "Complimenting someone", "social", [
    "that looks nice on you",
    "I like your bag",
    "nice shirt",
    "よく似合います",
    "compliment"
  ], "よくお似合いです is for clothes. 素敵ですね works for almost any thing you can point at.", [
    ["よくお似合いですよ。", "よくおにあいですよ。", "That looks great on you.", "polite"],
    ["その鞄、素敵ですね。", "そのかばん、すてきですね。", "That bag is lovely.", "polite"]
  ], [["似合う", "にあう"], ["素敵", "すてき"]]),
  s("social-congrats", "Saying congratulations", "social", [
    "congratulations",
    "congrats",
    "well done",
    "おめでとう",
    "omedetou"
  ], "おめでとうございます is the safe form. Add the reason: ご結婚おめでとうございます.", [
    ["おめでとうございます。", "おめでとうございます。", "Congratulations.", "polite"],
    ["おめでとう！", "おめでとう！", "Congrats!", "casual"]
  ], [["祝う", "いわう"], ["おめでとう", "おめでとう"]]),
  s("social-cheers", "Making a toast", "social", [
    "cheers",
    "a toast",
    "how do you say cheers",
    "乾杯",
    "kanpai"
  ], "乾杯 is the word. Wait until everyone has a drink, then say it together.", [
    ["乾杯。", "かんぱい。", "Cheers.", "casual"],
    ["ご健康を祝して、乾杯。", "ごけんこうをしょくして、かんぱい。", "To your health. Cheers.", "formal"]
  ], [["乾杯", "かんぱい"]]),
  s("social-drinks", "Inviting someone for a drink", "social", [
    "want to get a drink",
    "let's grab a beer",
    "drinks after work",
    "飲みに行かない",
    "go for drinks"
  ], "飲みに行きませんか is the invite. 軽く is 'just a quick one' and lowers the pressure.", [
    ["この後、軽く飲みに行きませんか。", "このあと、かるくのみにいきませんか。", "Want to grab a quick drink after this?", "polite"],
    ["飲みに行こう。", "のみにいこう。", "Let's go for a drink.", "casual"]
  ], [["飲む", "のむ"], ["行く", "いく"]]),
  s("social-no-alcohol", "Saying you don't drink", "social", [
    "I don't drink",
    "I can't drink alcohol",
    "no alcohol for me",
    "お酒は飲めません",
    "don't drink"
  ], "お酒は飲めません is clear and doesn't need a reason. Order a soft drink with it.", [
    ["お酒は飲めません。", "おさけはのめません。", "I can't drink alcohol.", "polite"],
    ["今日はソフトドリンクで。", "きょうはソフトドリンクで。", "A soft drink for me today.", "polite"]
  ], [["酒", "さけ"], ["飲む", "のむ"]]),
  s("social-luck", "Wishing someone luck", "social", [
    "good luck",
    "you'll do great",
    "break a leg",
    "頑張って",
    "ganbatte"
  ], "頑張ってください is the encouragement. 応援しています is 'I'm rooting for you'.", [
    ["頑張ってください。", "がんばってください。", "Good luck.", "polite"],
    ["応援してるよ。", "おうえんしてるよ。", "I'm rooting for you.", "casual"]
  ], [["頑張る", "がんばる"], ["応援", "おうえん"]]),
  s("feel-happy", "Saying you're happy", "feelings", [
    "I'm happy",
    "I'm glad",
    "that makes me happy",
    "嬉しい",
    "ureshii"
  ], "嬉しいです is the feeling. よかったです is relief, 'I'm glad that happened'.", [
    ["嬉しいです。", "うれしいです。", "I'm happy.", "polite"],
    ["聞いてよかったです。", "きいてよかったです。", "I'm glad to hear that.", "polite"]
  ], [["嬉しい", "うれしい"], ["良い", "よい"]]),
  s("feel-tired", "Saying you're tired", "feelings", [
    "I'm tired",
    "I'm exhausted",
    "so tired today",
    "疲れた",
    "tsukareta"
  ], "疲れました is the polite past. 眠い is sleepy, which is different.", [
    ["今日は疲れました。", "きょうはつかれました。", "I'm tired today.", "polite"],
    ["眠くなってきた。", "ねむくなってきた。", "I'm getting sleepy.", "casual"]
  ], [["疲れる", "つかれる"], ["眠い", "ねむい"]]),
  s("feel-hungry", "Saying you're hungry", "feelings", [
    "I'm hungry",
    "I want to eat",
    "let's get food I'm starving",
    "お腹が空いた",
    "hungry"
  ], "お腹が空きました is the normal line. 腹減った is rougher and mostly male casual.", [
    ["お腹が空きました。", "おなかがすきました。", "I'm hungry.", "polite"],
    ["何か食べない？", "なにかたべない？", "Want to eat something?", "casual"]
  ], [["お腹", "おなか"], ["空く", "すく"]]),
  s("feel-like", "Saying you like something", "feelings", [
    "I like this",
    "I like it",
    "this is my favorite",
    "好きです",
    "I really like"
  ], "これが好きです is the pattern. 大好きです is stronger. Don't use 好きです alone about a person unless you mean it.", [
    ["これが好きです。", "これがすきです。", "I like this.", "polite"],
    ["コーヒーが一番好き。", "コーヒーがいちばんすき。", "Coffee is my favorite.", "casual"]
  ], [["好き", "すき"], ["一番", "いちばん"]]),
  s("feel-dislike", "Saying you don't really like it", "feelings", [
    "I don't really like it",
    "not a fan",
    "I don't like this much",
    "あんまり好きじゃない",
    "not my thing"
  ], "あんまり好きじゃないです is softer than 嫌いです. 苦手です is the useful middle.", [
    ["あんまり好きじゃないです。", "あんまりすきじゃないです。", "I don't really like it.", "polite"],
    ["苦手なんです。", "にがてなんです。", "I'm not good with that.", "polite"]
  ], [["好き", "すき"], ["苦手", "にがて"]]),
  s("feel-think", "Giving an opinion", "feelings", [
    "I think that",
    "in my opinion",
    "I feel like",
    "と思います",
    "I think so"
  ], "〜と思います softens an opinion. 〜だと思います is the same with a noun or na-adjective.", [
    ["その方がいいと思います。", "そのほうがいいとおもいます。", "I think that way is better.", "polite"],
    ["私はそう思いません。", "わたしはそうおもいません。", "I don't think so.", "polite"]
  ], [["思う", "おもう"], ["私", "わたし"]]),
  s("feel-agree", "Agreeing", "feelings", [
    "I agree",
    "same here",
    "you're right",
    "賛成",
    "I think so too"
  ], "そうですね agrees gently. 賛成です is a clearer 'I agree', a bit meeting-like.", [
    ["賛成です。", "さんせいです。", "I agree.", "polite"],
    ["確かに。", "たしかに。", "True.", "casual"]
  ], [["賛成", "さんせい"], ["確か", "たしか"]]),
  s("feel-disagree", "Disagreeing gently", "feelings", [
    "I don't think so",
    "I disagree",
    "I'm not sure about that",
    "そうは思わない",
    "disagree"
  ], "そうとは限らないと思います disagrees without a flat no. Save 違う for when a fact is wrong.", [
    ["それは少し違うと思います。", "それはすこしかがうとおもいます。", "I think that's a bit off.", "polite"],
    ["うーん、そうかな。", "うーん、そうかな。", "Hmm, I don't know about that.", "casual"]
  ], [["違う", "ちがう"], ["思う", "おもう"]]),
  s("feel-unsure", "Saying you're not sure", "feelings", [
    "I'm not sure",
    "I don't know",
    "maybe",
    "わかりません",
    "not sure"
  ], "わかりません is 'I don't know'. たぶん is 'probably' when you want to guess.", [
    ["よくわかりません。", "よくわかりません。", "I'm not sure.", "polite"],
    ["たぶん大丈夫だと思います。", "たぶんだいじょうぶだとおもいます。", "I think it's probably fine.", "polite"]
  ], [["分かる", "わかる"], ["多分", "たぶん"]]),
  s("feel-nervous", "Saying you're nervous", "feelings", [
    "I'm nervous",
    "I'm anxious",
    "I've got butterflies",
    "緊張しています",
    "nervous"
  ], "緊張しています is the word. 落ち着いて is what someone says back: calm down.", [
    ["緊張しています。", "きんちょうしています。", "I'm nervous.", "polite"],
    ["ちょっと上がってる。", "ちょっとあがってる。", "I'm a bit keyed up.", "casual"]
  ], [["緊張", "きんちょう"]]),
  s("feel-want", "Saying you want to", "feelings", [
    "I want to",
    "I'd like to",
    "I want to go",
    "したい",
    "want to try"
  ], "〜したいです is the want. 〜してみたいです is 'I'd like to try', which is softer.", [
    ["日本に行ってみたいです。", "にほんにいってみたいです。", "I'd like to go to Japan.", "polite"],
    ["それ、やってみたい。", "それ、やってみたい。", "I want to try that.", "casual"]
  ], [["行く", "いく"], ["見る", "みる"]]),
  s("home-bathroom", "Finding the bathroom", "home", [
    "where is the bathroom",
    "where's the restroom",
    "toilet please",
    "トイレはどこ",
    "bathroom"
  ], "トイレはどこですか is what everyone says. お手洗い is a notch politer.", [
    ["トイレはどこですか。", "トイレはどこですか。", "Where is the bathroom?", "polite"],
    ["お手洗いを借りてもいいですか。", "おてあらいをかりてもいいですか。", "May I use the restroom?", "polite"]
  ], [["トイレ", "トイレ"], ["借りる", "かりる"]]),
  s("home-wifi", "Asking for the wifi password", "home", [
    "what's the wifi password",
    "wifi please",
    "internet password",
    "パスワードは何",
    "wi-fi"
  ], "ワイファイのパスワードを教えてください is the question. They may point at a card.", [
    ["ワイファイのパスワードを教えてください。", "ワイファイのパスワードをおしえてください。", "What's the wifi password?", "polite"],
    ["ネット、使ってもいいですか。", "ネット、つかってもいいですか。", "May I use the internet?", "polite"]
  ], [["パスワード", "パスワード"], ["ワイファイ", "ワイファイ"]]),
  s("home-trash", "Asking where to throw something away", "home", [
    "where is the trash",
    "where do I throw this away",
    "which bin",
    "ゴミ箱はどこ",
    "garbage"
  ], "ゴミ箱はどこですか is the question. Sorting rules differ; ask これはどれですか if unsure.", [
    ["ゴミ箱はどこですか。", "ごみばこはどこですか。", "Where is the trash?", "polite"],
    ["これは燃えるゴミですか。", "これはもえるゴミですか。", "Is this burnable trash?", "polite"]
  ], [["ゴミ箱", "ごみばこ"], ["ごみ", "ごみ"]]),
  s("home-key", "Saying you lost your key", "home", [
    "I lost my key",
    "I locked myself out",
    "can't find my key",
    "鍵をなくした",
    "lost the key"
  ], "鍵をなくしました is the report. 閉め出されました is locked out.", [
    ["鍵をなくしました。", "かぎをなくしました。", "I lost my key.", "polite"],
    ["家に入れません。", "いえにはいれません。", "I can't get into the house.", "polite"]
  ], [["鍵", "かぎ"], ["無くす", "なくす"]]),
  s("home-shower", "Asking to use the shower", "home", [
    "can I take a shower",
    "may I use the shower",
    "where is the shower",
    "シャワーを浴びてもいい",
    "shower"
  ], "シャワーを浴びてもいいですか asks permission. Ask where the towels are in the same breath.", [
    ["シャワーを浴びてもいいですか。", "シャワーをあびてもいいですか。", "May I take a shower?", "polite"],
    ["タオルはどこですか。", "タオルはどこですか。", "Where are the towels?", "polite"]
  ], [["シャワー", "シャワー"], ["浴びる", "あびる"]]),
  s("seat-free", "Asking if a seat is free", "home", [
    "is this seat taken",
    "can I sit here",
    "is this seat free",
    "この席空いてますか",
    "sit here"
  ], "ここ、空いていますか is the question in a cafe or on a train.", [
    ["ここ、空いていますか。", "ここ、あいていますか。", "Is this seat free?", "polite"],
    ["隣、いいですか。", "となり、いいですか。", "May I sit next to you?", "polite"]
  ], [["席", "せき"], ["空く", "あく"]]),
  s("weather-today", "Talking about the weather", "weather", [
    "how's the weather",
    "nice weather",
    "weather today",
    "今日の天気",
    "talking about weather"
  ], "いい天気ですね is the small-talk opener. It expects そうですね, not a forecast.", [
    ["いい天気ですね。", "いいてんきですね。", "Nice weather, isn't it?", "polite"],
    ["今日の天気、どうかな。", "きょうのてんき、どうかな。", "I wonder about the weather today.", "casual"]
  ], [["天気", "てんき"], ["今日", "きょう"]]),
  s("weather-hot", "Saying it's hot", "weather", [
    "it's hot today",
    "so hot outside",
    "it's boiling",
    "暑いですね",
    "hot day"
  ], "暑いですね invites agreement. 蒸し暑い is humid heat, which is the usual summer complaint.", [
    ["今日は暑いですね。", "きょうはあついですね。", "It's hot today, isn't it?", "polite"],
    ["蒸し暑い。", "むしあつい。", "It's humid.", "casual"]
  ], [["暑い", "あつい"], ["今日", "きょう"]]),
  s("weather-rain", "Saying it looks like rain", "weather", [
    "it looks like rain",
    "I think it'll rain",
    "do I need an umbrella",
    "雨が降りそう",
    "going to rain"
  ], "雨が降りそうですね is the observation. 傘 is the umbrella you'll want.", [
    ["雨が降りそうですね。", "あめがふりそうですね。", "It looks like rain.", "polite"],
    ["傘、持って行った方がいいよ。", "かさ、もっていったほうがいいよ。", "You should take an umbrella.", "casual"]
  ], [["雨", "あめ"], ["降る", "ふる"]]),
  s("time-now", "Asking the time", "time", [
    "what time is it",
    "do you have the time",
    "what time is it now",
    "今何時",
    "ask the time"
  ], "今何時ですか is the question. 〜時〜分です is the answer shape.", [
    ["今何時ですか。", "いまなんじですか。", "What time is it?", "polite"],
    ["三時十分です。", "さんじじゅっぷんです。", "It's 3:10.", "polite"]
  ], [["今", "いま"], ["何時", "なんじ"]]),
  s("time-open", "Asking opening hours", "time", [
    "what time do you open",
    "when do you close",
    "opening hours",
    "何時に開きますか",
    "what time until"
  ], "何時に開きますか and 何時までですか cover open and close. 定休日 is the regular day off.", [
    ["何時に開きますか。", "なんじにあきますか。", "What time do you open?", "polite"],
    ["定休日はいつですか。", "ていきゅうびはいつですか。", "Which day are you closed?", "polite"]
  ], [["開く", "あく"], ["休み", "やすみ"]]),
  s("time-date", "Asking the date", "time", [
    "what's today's date",
    "what day is it",
    "what's the date",
    "今日は何日",
    "today's date"
  ], "今日は何日ですか asks the date. 何曜日ですか asks the day of the week.", [
    ["今日は何日ですか。", "きょうはなんにちですか。", "What's today's date?", "polite"],
    ["今日は何曜日ですか。", "きょうはなんようびですか。", "What day of the week is it?", "polite"]
  ], [["今日", "きょう"], ["何日", "なんにち"]]),
  s("money-bank", "Finding a bank or ATM", "money", [
    "where is an ATM",
    "where can I get cash",
    "nearest bank",
    "銀行はどこ",
    "atm nearby"
  ], "ATMはどこですか is understood. 銀行はどこですか is the branch. 引き出す is withdrawing.", [
    ["この近くに銀行はありますか。", "このちかくにぎんこうはありますか。", "Is there a bank near here?", "polite"],
    ["お金を下ろしたいんですが。", "おかねをおろしたいんですが。", "I'd like to withdraw some money.", "polite"]
  ], [["銀行", "ぎんこう"], ["お金", "おかね"]]),
  s("money-split", "Splitting the bill", "money", [
    "let's split the bill",
    "let's go halves",
    "split it evenly",
    "割り勘",
    "warikan"
  ], "割り勘にしましょう is the proposal. Say it before anyone reaches for the whole check.", [
    ["割り勘にしましょう。", "わりかんにしましょう。", "Let's split the bill.", "polite"],
    ["今日は僕が出すよ。", "きょうはぼくがだすよ。", "I'll get it today.", "casual"]
  ], [["割り勘", "わりかん"], ["出す", "だす"]]),
  s("problem-wallet", "Saying you lost your wallet", "problems", [
    "I lost my wallet",
    "my wallet is missing",
    "I can't find my wallet",
    "財布をなくした",
    "lost wallet"
  ], "財布をなくしました is the report at a station office or a police box. Say when you last had it.", [
    ["財布をなくしました。", "さいふをなくしました。", "I lost my wallet.", "polite"],
    ["この辺に落としたと思います。", "このへんにおとしたとおもいます。", "I think I dropped it around here.", "polite"]
  ], [["財布", "さいふ"], ["無くす", "なくす"]]),
  s("problem-stolen", "Saying something was stolen", "problems", [
    "my bag was stolen",
    "someone stole my phone",
    "I've been robbed",
    "盗まれました",
    "stolen"
  ], "鞄を盗まれました is the report. Ask for the police with 警察を呼んでください if it just happened.", [
    ["鞄を盗まれました。", "かばんをぬすまれました。", "My bag was stolen.", "polite"],
    ["今、取られました。", "いま、とられました。", "It was just taken.", "polite"]
  ], [["盗む", "ぬすむ"], ["鞄", "かばん"]]),
  s("problem-police", "Asking someone to call the police", "problems", [
    "please call the police",
    "I need the police",
    "where's a police box",
    "警察を呼んで",
    "koban"
  ], "警察を呼んでください is the emergency ask. 交番はどこですか finds the neighborhood police box.", [
    ["警察を呼んでください。", "けいさつをよんでください。", "Please call the police.", "polite"],
    ["交番はどこですか。", "こうばんはどこですか。", "Where is the police box?", "polite"]
  ], [["警察", "けいさつ"], ["呼ぶ", "よぶ"]]),
  s("problem-understand", "Saying you don't understand", "problems", [
    "I don't understand",
    "I don't get it",
    "what does that mean",
    "わかりません",
    "don't understand"
  ], "わかりません is honest and useful. 意味がわかりません is specifically the meaning.", [
    ["すみません、わかりません。", "すみません、わかりません。", "I'm sorry, I don't understand.", "polite"],
    ["意味がわかりません。", "いみがわかりません。", "I don't know what that means.", "polite"]
  ], [["分かる", "わかる"], ["意味", "いみ"]]),
  s("problem-mistake", "Saying you made a mistake", "problems", [
    "I made a mistake",
    "that was my fault",
    "I got it wrong",
    "間違えました",
    "my mistake"
  ], "間違えました owns it. 申し訳ありません follows when the mistake affected someone.", [
    ["間違えました。", "まちがえました。", "I made a mistake.", "polite"],
    ["こちらのミスです。", "こちらのみすです。", "That was our mistake.", "polite"]
  ], [["間違える", "まちがえる"], ["ミス", "ミス"]]),
  s("problem-battery", "Saying your phone died", "problems", [
    "my phone died",
    "my battery is dead",
    "phone ran out of battery",
    "電池が切れた",
    "out of battery"
  ], "電池が切れました or 充電が切れました. Then ask to borrow a charger: 充電器を借りられますか.", [
    ["電池が切れました。", "でんちがきれました。", "My battery died.", "polite"],
    ["充電してもいいですか。", "じゅうでんしてもいいですか。", "May I charge my phone?", "polite"]
  ], [["電池", "でんち"], ["充電", "じゅうでん"]]),
  s("problem-phone", "Saying you lost your phone", "problems", [
    "I lost my phone",
    "I can't find my phone",
    "my phone is missing",
    "スマホをなくした",
    "lost my phone"
  ], "スマホをなくしました is the report. 電源 is worth mentioning if it was off.", [
    ["スマホをなくしました。", "スマホをなくしました。", "I lost my phone.", "polite"],
    ["電源は切ってありました。", "でんげんはきってありました。", "It was turned off.", "polite"]
  ], [["スマホ", "スマホ"], ["無くす", "なくす"]]),
  s("travel-checkin", "Checking into a hotel", "travel", [
    "I'd like to check in",
    "reservation under Tanaka",
    "checking into a hotel",
    "チェックイン",
    "hotel check in"
  ], "田中で予約しています starts check-in. Have the confirmation ready.", [
    ["チェックインをお願いします。", "チェックインをおねがいします。", "I'd like to check in.", "polite"],
    ["田中で予約しています。", "たなかでよやくしています。", "The reservation is under Tanaka.", "polite"]
  ], [["予約", "よやく"], ["泊まる", "とまる"]]),
  s("travel-checkout", "Checking out", "travel", [
    "check out please",
    "I'd like to check out",
    "we're leaving the hotel",
    "チェックアウト",
    "hotel checkout"
  ], "チェックアウトをお願いします at the desk. Ask for 領収書 if you need a receipt.", [
    ["チェックアウトをお願いします。", "チェックアウトをおねがいします。", "I'd like to check out.", "polite"],
    ["もう少し荷物を置いてもいいですか。", "もうすこしにもつをおいてもいいですか。", "May I leave my bags a little longer?", "polite"]
  ], [["荷物", "にもつ"], ["置く", "おく"]]),
  s("travel-breakfast", "Asking if breakfast is included", "travel", [
    "is breakfast included",
    "what time is breakfast",
    "where is breakfast served",
    "朝食は含まれていますか",
    "breakfast included"
  ], "朝食はついていますか is the question at check-in. Then ask 何時から.", [
    ["朝食はついていますか。", "ちょうしょくはついていますか。", "Is breakfast included?", "polite"],
    ["朝食は何時からですか。", "ちょうしょくはなんじからですか。", "What time does breakfast start?", "polite"]
  ], [["朝食", "ちょうしょく"], ["時間", "じかん"]]),
  s("travel-how-long", "Asking how long it takes", "travel", [
    "how long does it take",
    "how far is the station",
    "how many minutes",
    "どのくらい時間がかかる",
    "how long to get there"
  ], "どのくらいかかりますか is the question. The answer comes in 分 or 時間.", [
    ["駅までどのくらいかかりますか。", "えきまでどのくらいかかりますか。", "How long does it take to the station?", "polite"],
    ["歩いて十分くらいです。", "あるいてじゅっぷんくらいです。", "About a ten-minute walk.", "polite"]
  ], [["時間", "じかん"], ["歩く", "あるく"]]),
  s("school-question", "Saying you have a question", "school", [
    "I have a question",
    "can I ask something",
    "excuse me I have a question",
    "質問があります",
    "ask a question"
  ], "質問があります gets the teacher's attention. ちょっと聞いてもいいですか is softer.", [
    ["質問があります。", "しつもんがあります。", "I have a question.", "polite"],
    ["ちょっと聞いてもいいですか。", "ちょっときいてもいいですか。", "Can I ask you something?", "polite"]
  ], [["質問", "しつもん"], ["聞く", "きく"]]),
  s("school-homework", "Saying you forgot your homework", "school", [
    "I forgot my homework",
    "I left my homework at home",
    "I didn't bring the assignment",
    "宿題を忘れた",
    "forgot homework"
  ], "宿題を忘れました owns it. 家に置いてきました means you left it at home.", [
    ["宿題を忘れました。", "しゅくだいをわすれました。", "I forgot my homework.", "polite"],
    ["家に置いてきてしまいました。", "いえにおいてきてしまいました。", "I left it at home.", "polite"]
  ], [["宿題", "しゅくだい"], ["忘れる", "わすれる"]]),
  s("school-meaning", "Asking what a word means", "school", [
    "what does this word mean",
    "what does this mean",
    "define this word",
    "この言葉の意味",
    "what does it mean"
  ], "この言葉の意味は何ですか is the question. Point at the word.", [
    ["この言葉の意味は何ですか。", "このことばのいみはなんですか。", "What does this word mean?", "polite"],
    ["これ、どういう意味？", "これ、どういういみ？", "What does this mean?", "casual"]
  ], [["意味", "いみ"], ["言葉", "ことば"]]),
  s("school-reading", "Asking how to read a kanji", "school", [
    "how do you read this kanji",
    "what's the reading",
    "how is this pronounced",
    "この漢字の読み方",
    "kanji reading"
  ], "この漢字はどう読みますか is the question. 送り仮名 helps if you can see it.", [
    ["この漢字はどう読みますか。", "このかんじはどうよみますか。", "How do you read this kanji?", "polite"],
    ["読み方を教えてください。", "よみかたをおしえてください。", "Please tell me the reading.", "polite"]
  ], [["漢字", "かんじ"], ["読む", "よむ"]]),
  s("apo-waiting", "Sorry I kept you waiting", "apologies", [
    "sorry to keep you waiting",
    "sorry I'm late I kept you waiting",
    "thanks for waiting",
    "お待たせしました",
    "kept you waiting"
  ], "お待たせしました is what you say as you arrive. They answer いいえ.", [
    ["お待たせしました。", "おまたせしました。", "Sorry to keep you waiting.", "polite"],
    ["待った？ごめん。", "まった？ごめん。", "Were you waiting? Sorry.", "casual"]
  ], [["待つ", "まつ"], ["ごめん", "ごめん"]]),
  s("apo-bump", "Sorry for bumping into someone", "apologies", [
    "sorry for bumping into you",
    "I didn't see you",
    "excuse me I bumped you",
    "ぶつかってすみません",
    "bumped into"
  ], "すみません is enough for a light bump. 大丈夫ですか if they might be hurt.", [
    ["ぶつかってすみません。", "ぶつかってすみません。", "Sorry for bumping into you.", "polite"],
    ["大丈夫ですか。", "だいじょうぶですか。", "Are you all right?", "polite"]
  ], [["ぶつかる", "ぶつかる"], ["大丈夫", "だいじょうぶ"]]),
  s("apo-cancel", "Canceling plans", "apologies", [
    "I can't make it",
    "something came up",
    "I have to cancel",
    "行けなくなりました",
    "cancel plans"
  ], "行けなくなってしまいました is the cancel. Apologize and, if you can, propose another day.", [
    ["申し訳ないんですが、行けなくなりました。", "もうしわけないんですが、いけなくなりました。", "I'm sorry, but I can't make it anymore.", "polite"],
    ["ごめん、今日はやめとく。", "ごめん、きょうはやめとく。", "Sorry, I'll skip today.", "casual"]
  ], [["行く", "いく"], ["申し訳", "もうしわけ"]])
]
