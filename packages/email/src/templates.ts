import type { Language } from "@kotori/domain"
import type { Email } from "./Mailer.ts"

interface Recipient {
  readonly to: string
  readonly name: string | null
  readonly language: Language
}

/** What completes the step: a code to type into the app, or (for link flows) a link to open. */
export type OneTime = { readonly code: string } | { readonly url: string }

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

const greeting = (who: Recipient) =>
  who.language === "ja" ? `${who.name ? `${who.name}さん、` : ""}こんにちは。` : `Hi${who.name ? ` ${who.name}` : ""},`

const signoff = (language: Language) => (language === "ja" ? "ことりより 🐦" : "Kotori 🐦")

/** Plain text first; the HTML is the same copy, escaped, with a code set large or a link made clickable. */
const compose = (
  who: Recipient,
  subject: string,
  lines: ReadonlyArray<string>,
  oneTime?: { readonly secret: OneTime; readonly label: string }
): Email => {
  const shown = oneTime === undefined ? [] : ["", "code" in oneTime.secret ? oneTime.secret.code : oneTime.secret.url]
  const text = [greeting(who), "", ...lines, ...shown, "", signoff(who.language)].join("\n")
  const html = [
    `<p>${escape(greeting(who))}</p>`,
    ...lines.map((line) => `<p>${escape(line)}</p>`),
    ...(oneTime === undefined
      ? []
      : "code" in oneTime.secret
        ? [`<p style="font-size:28px;font-weight:bold;letter-spacing:6px">${escape(oneTime.secret.code)}</p>`]
        : [
            `<p><a href="${escape(oneTime.secret.url)}">${escape(oneTime.label)}</a></p>`,
            `<p style="color:#888;font-size:12px">${escape(oneTime.secret.url)}</p>`
          ]),
    `<p>${escape(signoff(who.language))}</p>`
  ].join("\n")
  return { to: who.to, subject, text, html }
}

interface OneTimeCopy {
  readonly subject: string
  /** The instruction when the email carries a code, and when it carries a link. */
  readonly code: string
  readonly link: string
  readonly label: string
  /** Said when the learner may not have asked for the email themselves. */
  readonly unasked?: string
}

const unasked = {
  en: "If you didn't ask for this, you can ignore this email.",
  ja: "心当たりがなければ、このメールは無視してください。"
}

const oneTimeCopy: Record<"verifyEmail" | "resetPassword" | "signIn", Record<Language, OneTimeCopy>> = {
  verifyEmail: {
    en: {
      subject: "Kotori: confirm your email",
      code: "Enter this code in the app to confirm your email address.",
      link: "Open the link below to confirm your email address.",
      label: "Confirm email"
    },
    ja: {
      subject: "ことり：メールアドレスの確認",
      code: "アプリにこのコードを入力して、メールアドレスを確認してください。",
      link: "下のリンクを開いて、メールアドレスを確認してください。",
      label: "メールアドレスを確認する"
    }
  },
  resetPassword: {
    en: {
      subject: "Kotori: reset your password",
      code: "Enter this code in the app to choose a new password.",
      link: "Use the link below to choose a new password.",
      label: "Reset password",
      unasked: unasked.en
    },
    ja: {
      subject: "ことり：パスワードの再設定",
      code: "アプリにこのコードを入力すると、新しいパスワードを設定できます。",
      link: "下のリンクから新しいパスワードを設定できます。",
      label: "パスワードを再設定する",
      unasked: unasked.ja
    }
  },
  signIn: {
    en: {
      subject: "Kotori: sign in",
      code: "Enter this code in the app to sign in.",
      link: "Open the link below to sign in.",
      label: "Sign in",
      unasked: unasked.en
    },
    ja: {
      subject: "ことり：ログイン",
      code: "アプリにこのコードを入力してログインしてください。",
      link: "下のリンクを開いてログインしてください。",
      label: "ログインする",
      unasked: unasked.ja
    }
  }
}

const oneTimeEmail =
  (purpose: keyof typeof oneTimeCopy) =>
  (who: Recipient, secret: OneTime): Email => {
    const copy = oneTimeCopy[purpose][who.language]
    const lines = ["code" in secret ? copy.code : copy.link, ...(copy.unasked ? [copy.unasked] : [])]
    return compose(who, copy.subject, lines, { secret, label: copy.label })
  }

/**
 * Emails Kotori sends itself. Managed Better Auth hands its verification,
 * password-reset and sign-in codes (or links) to the API's webhook, which
 * sends them with these.
 */
export const templates = {
  verifyEmail: oneTimeEmail("verifyEmail"),
  resetPassword: oneTimeEmail("resetPassword"),
  signIn: oneTimeEmail("signIn"),
  approved: (who: Recipient): Email =>
    who.language === "ja"
      ? compose(who, "ことりへようこそ！", ["アカウントが承認されました。アプリを開いて、さっそく始めましょう。"])
      : compose(who, "You're in! Welcome to Kotori", ["Your account has been approved. Open the app and dive in."])
}
