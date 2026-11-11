import type { Language } from "@kotori/contracts"

export type LegalKind = "privacy" | "terms"

export interface LegalSection {
  readonly id: string
  readonly title: string
  readonly paragraphs: ReadonlyArray<string>
}

export interface LegalDocument {
  readonly kind: LegalKind
  readonly title: string
  readonly updated: string
  readonly intro: string
  readonly sections: ReadonlyArray<LegalSection>
  readonly companionHref: "/privacy" | "/terms"
  readonly companionLabel: string
}

/**
 * Routes that need neither a signed-in session nor the API to render: public legal
 * pages (`/privacy`, `/terms`, crawled directly on the web) and `/proto` mock-ups.
 */
export const isUnguardedRoute = (pathname: string): boolean => {
  const clean = pathname.replace(/\/+$/, "") || "/"
  return clean === "/privacy" || clean === "/terms" || clean === "/proto" || clean.startsWith("/proto/")
}

/** Optional `?lang=en|ja` query override on `/privacy` and `/terms`, falling back to the app language. */
export const legalLanguageFromParam = (raw: string | readonly string[] | undefined, fallback: Language): Language => {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === "en" || value === "ja" ? value : fallback
}

const documents: Record<Language, Record<LegalKind, LegalDocument>> = {
  en: {
    privacy: {
      kind: "privacy",
      title: "Privacy Policy",
      updated: "Last updated: November 11, 2026",
      intro:
        "Kotori helps English and Japanese learners sound natural. This policy explains what information Kotori collects, how it is used, which service providers process it, and how you can erase everything at any time.",
      companionHref: "/terms",
      companionLabel: "Terms of Service",
      sections: [
        {
          id: "account",
          title: "Account and Google Sign-In Data",
          paragraphs: [
            "When you create an account with email and password, Kotori stores your email address, optional display name, password hash, email verification status, and active session records.",
            "If you choose Continue with Google or connect Google in Settings, Kotori receives only your basic Google account identity via standard OpenID Connect scopes (openid, email, and profile): your Google account identifier, email address, email verification flag, and profile name. Kotori uses this information solely to sign you in or link Google to your existing Kotori account. Kotori never accesses Gmail messages, Google Drive, contacts, or other Google data, and never sells or uses Google user data for advertising."
          ]
        },
        {
          id: "study",
          title: "Study and Language Data",
          paragraphs: [
            "To run your notebook and spaced-repetition reviews across devices, Kotori stores your chosen language direction (Japanese or English), time zone, daily study limits, saved words and expressions, flashcards, and review history.",
            "When you ask a language question, check whether a sentence sounds natural, or practice expressing an idea, the text you submit is sent to Kotori's AI language providers to produce your answer and enforce per-account usage limits."
          ]
        },
        {
          id: "providers",
          title: "Service Providers",
          paragraphs: [
            "Kotori relies on infrastructure and AI processors strictly to operate the app: Neon (PostgreSQL database and Managed Better Auth for accounts and sessions), Fly.io and Vercel (API and web hosting), Anthropic Claude and TypeSafe Jev (naturalness checks, language answers, nuance judgments, and example sentences), ElevenLabs (pronunciation audio synthesis), Resend (transactional verification, password-reset, and approval emails), and Sentry (crash and error diagnostics, with all on-screen text and images masked in error replays).",
            "Kotori does not sell personal information, run third-party advertising networks, or track you across other websites or apps."
          ]
        },
        {
          id: "cookies",
          title: "Cookies and Device Storage",
          paragraphs: [
            "On the web, Kotori uses strictly necessary HttpOnly cookies to maintain your sign-in session and verify OAuth sign-in returns, plus local storage for interface preferences such as theme and furigana display. On iOS and Android, session credentials are stored in encrypted system storage (SecureStore)."
          ]
        },
        {
          id: "deletion",
          title: "Data Retention and Account Deletion",
          paragraphs: [
            "Your account and study records are kept while your account remains open. You can permanently delete your account at any time from Settings → Delete account in the app. Deleting your account immediately erases your identity, linked sign-in methods, sessions, saved notebook, flashcards, and review history from Kotori's database."
          ]
        },
        {
          id: "contact",
          title: "Changes and Contact",
          paragraphs: [
            "If we make material changes to this policy, we will update the date above and post the revised text at hellokotori.com/privacy. For privacy questions or data requests, reply to any Kotori account email or open an issue at github.com/0Calories/kotori."
          ]
        }
      ]
    },
    terms: {
      kind: "terms",
      title: "Terms of Service",
      updated: "Last updated: November 11, 2026",
      intro: "By creating an account or using Kotori on the web, iOS, or Android, you agree to these terms.",
      companionHref: "/privacy",
      companionLabel: "Privacy Policy",
      sections: [
        {
          id: "service",
          title: "The Service and Private Beta",
          paragraphs: [
            "Kotori is a bilingual dictionary, nuance guide, and spaced-repetition notebook for learners of Japanese and English. While Kotori is in private beta, new sign-ups may wait for manual approval before full access is enabled, and features or hourly/daily AI allowances may change as the service develops."
          ]
        },
        {
          id: "accounts",
          title: "Your Account",
          paragraphs: [
            "You are responsible for keeping your password and linked Google account secure and for activity under your account. You can sign out or permanently erase your account and study history at any time in Settings."
          ]
        },
        {
          id: "acceptable-use",
          title: "Acceptable Use",
          paragraphs: [
            "Kotori is provided for personal language learning. You agree not to scrape, mirror, or bulk-download dictionary entries, audio clips, or AI-generated explanations; probe, bypass, or overload rate limits or authentication controls; or submit unlawful, harmful, or abusive material."
          ]
        },
        {
          id: "ai",
          title: "AI-Generated Guidance",
          paragraphs: [
            "Alongside human-edited dictionaries, Kotori uses AI models (Anthropic Claude, TypeSafe Jev, and ElevenLabs) to judge formality and nuance, write example sentences, check phrasing, and voice pronunciation audio. AI output can be incomplete or mistaken — please verify high-stakes translations, legal, medical, or professional communications independently."
          ]
        },
        {
          id: "licenses",
          title: "Dictionaries and Intellectual Property",
          paragraphs: [
            "Japanese dictionary entries come from JMDict by the Electronic Dictionary Research and Development Group (CC BY-SA 4.0). English entries are adapted from English and Japanese Wiktionary via Wiktextract (CC BY-SA 4.0) and JMDict (CC BY-SA 4.0), and word frequency data comes from OpenSubtitles via FrequencyWords (CC BY-SA 4.0). Those works remain licensed under CC BY-SA 4.0; Kotori's software, interface design, and shima-enaga mascot belong to Kotori."
          ]
        },
        {
          id: "disclaimers",
          title: "Disclaimers, Suspension, and Updates",
          paragraphs: [
            'Kotori is provided "as is" and "as available" without warranties of uninterrupted availability, fitness for a particular purpose, or error-free content, to the fullest extent permitted by applicable law. To the maximum extent permitted by law, Kotori will not be liable for indirect, incidental, or consequential damages arising from your use of the service.',
            "We may suspend or terminate accounts that abuse the service or violate these terms, and we may update these terms from time to time by posting the updated version at hellokotori.com/terms."
          ]
        }
      ]
    }
  },
  ja: {
    privacy: {
      kind: "privacy",
      title: "プライバシーポリシー",
      updated: "最終更新日：2026年11月11日",
      intro:
        "ことり（Kotori）は、英語と日本語を学ぶ人が自然な表現を身につけるための学習サービスです。本ポリシーでは、ことりが取得する情報、その利用目的、利用する外部サービス、およびデータの削除方法について説明します。",
      companionHref: "/terms",
      companionLabel: "利用規約",
      sections: [
        {
          id: "account",
          title: "アカウント情報と Google ログイン",
          paragraphs: [
            "メールアドレスとパスワードで登録した場合、ことりはメールアドレス、任意の表示名、ハッシュ化されたパスワード、メール確認状態、およびログインセッション情報を保存します。",
            "「Googleで続ける」または設定画面の「Googleを連携」を利用した場合、ことりは標準の OpenID Connect スコープ（openid、email、profile）を通じて、Google アカウント識別子・メールアドレス・メール確認状態・表示名のみを受け取ります。これらはログインおよび既存のアカウントへの連携のみに使用され、Gmail の本文や連絡先、Google ドライブ等のデータへアクセスすることはありません。また、Google ユーザーデータを第三者に販売したり広告目的で利用したりすることはありません。"
          ]
        },
        {
          id: "study",
          title: "学習データと入力内容",
          paragraphs: [
            "複数の端末でノートや間隔反復（SRS）の復習を同期するため、学習する言語、タイムゾーン、1日の学習上限、保存した単語・表現、復習カード、および復習履歴を保存します。",
            "質問や英文・日本語文の自然さチェック、表現の相談を行った場合、入力されたテキストは回答の作成および利用回数制限の管理のために AI プロバイダへ送信されます。"
          ]
        },
        {
          id: "providers",
          title: "利用する外部サービス",
          paragraphs: [
            "ことりはサービス提供に必要な範囲で以下の事業者の基盤を利用しています。Neon（PostgreSQL データベースおよび認証基盤 Managed Better Auth）、Fly.io・Vercel（API および Web ホスティング）、Anthropic Claude・TypeSafe Jev（ニュアンス判定・例文作成・添削・質問への回答）、ElevenLabs（発音音声の合成）、Resend（確認コード・パスワード再設定・承認通知メールの送信）、Sentry（エラー監視。エラー発生時の画面記録ではテキストと画像はすべてマスクされます）。",
            "ことりが個人情報を販売したり、広告ネットワークや他サイト横断のトラッキングを行ったりすることはありません。"
          ]
        },
        {
          id: "cookies",
          title: "Cookie と端末内の保存",
          paragraphs: [
            "Web 版では、ログイン状態の維持と OAuth 認証の検証に不可欠な HttpOnly Cookie のみを使用し、テーマやふりがな表示などの設定をブラウザのローカルストレージに保存します。iOS・Android 版では、セッション情報を OS の暗号化ストレージ（SecureStore）に保存します。"
          ]
        },
        {
          id: "deletion",
          title: "データの保持とアカウント削除",
          paragraphs: [
            "アカウントおよび学習記録は、アカウントが有効な間保持されます。アプリ内の「設定 → アカウントを削除」からいつでもアカウントを完全に削除でき、削除を実行するとアカウント情報、連携したログイン手段、セッション、保存したノート、カード、復習履歴がデータベースから即座に消去されます。"
          ]
        },
        {
          id: "contact",
          title: "改定とお問い合わせ",
          paragraphs: [
            "本ポリシーを改定する場合は、上部の更新日を更新し hellokotori.com/privacy に掲載します。データやプライバシーに関するご質問は、ことりからのアカウント通知メールへの返信、または github.com/0Calories/kotori の Issue よりご連絡ください。"
          ]
        }
      ]
    },
    terms: {
      kind: "terms",
      title: "利用規約",
      updated: "最終更新日：2026年11月11日",
      intro:
        "Web 版、iOS 版、または Android 版のことり（Kotori）にアカウントを作成または利用することにより、本規約に同意したものとみなされます。",
      companionHref: "/privacy",
      companionLabel: "プライバシーポリシー",
      sections: [
        {
          id: "service",
          title: "サービス内容とプライベートベータ",
          paragraphs: [
            "ことりは、日本語および英語の学習者向けの辞書・ニュアンス解説・間隔反復ノートアプリです。プライベートベータ期間中は、新規登録後に順次承認を行っており、機能や AI 機能の時間・日次の上限は予告なく変更される場合があります。"
          ]
        },
        {
          id: "accounts",
          title: "アカウントの管理",
          paragraphs: [
            "パスワードおよび連携した Google アカウントの安全な管理は利用者ご自身の責任となります。設定画面からいつでもログアウトや、アカウントおよび全学習データの完全な削除を行えます。"
          ]
        },
        {
          id: "acceptable-use",
          title: "禁止事項",
          paragraphs: [
            "ことりは個人の語学学習のために提供されます。辞書データ・音声・AI 生成コンテンツのスクレイピングや一括取得、レート制限や認証の回避・過度な負荷をかける行為、法令に反する内容や他者を害する内容の送信を禁止します。"
          ]
        },
        {
          id: "ai",
          title: "AI による解説・音声について",
          paragraphs: [
            "ことりでは辞書データに加え、AI モデル（Anthropic Claude、TypeSafe Jev、ElevenLabs）を用いて丁寧さ・ニュアンスの判定、例文の作成、表現の添削、および発音音声の合成を行っています。AI の出力には誤りや不十分な点が含まれる可能性があるため、重要な翻訳や業務・法務・医療などに関わる表現はご自身でもご確認ください。"
          ]
        },
        {
          id: "licenses",
          title: "辞書データの出典と権利",
          paragraphs: [
            "日本語辞書データは Electronic Dictionary Research and Development Group の JMDict（CC BY-SA 4.0）に基づいています。英単語データはウィクショナリー英語版・日本語版（Wiktextract 経由、CC BY-SA 4.0）および JMDict（CC BY-SA 4.0）、使用頻度データは OpenSubtitles / FrequencyWords（CC BY-SA 4.0）に基づいています。各辞書データはそれぞれのライセンスに従い、ことりのソフトウェア、インターフェース、シマエナガのマスコットに関する権利はことりに帰属します。"
          ]
        },
        {
          id: "disclaimers",
          title: "免責事項・利用停止・規約の変更",
          paragraphs: [
            "ことりは現状有姿で提供され、適用法令で認められる最大限の範囲において、常時稼働や特定目的への適合性、内容の完全な正確性を保証するものではありません。また、本サービスの利用に起因する間接的・付随的損害について、法令で認められる範囲で責任を負いません。",
            "不正利用や本規約への違反があった場合、アカウントを停止または削除することがあります。本規約は必要に応じて改定され、改定後は hellokotori.com/terms に掲載します。"
          ]
        }
      ]
    }
  }
}

export const legalDocument = (kind: LegalKind, language: Language): LegalDocument => documents[language][kind]
