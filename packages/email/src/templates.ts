import type { Language } from "@kotori/domain"
import type { Email } from "./Mailer.ts"

interface Recipient {
  readonly to: string
  readonly name: string | null
  readonly language: Language
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

const greeting = (who: Recipient) =>
  who.language === "ja" ? `${who.name ? `${who.name}さん、` : ""}こんにちは。` : `Hi${who.name ? ` ${who.name}` : ""},`

const signoff = (language: Language) => (language === "ja" ? "ことりより 🐦" : "Kotori 🐦")

/** Plain text first; the HTML is the same copy with the link made clickable. */
const compose = (
  who: Recipient,
  subject: string,
  lines: ReadonlyArray<string>,
  link?: { label: string; url: string }
): Email => {
  const text = [greeting(who), "", ...lines, ...(link ? ["", link.url] : []), "", signoff(who.language)].join("\n")
  const html = [
    `<p>${escape(greeting(who))}</p>`,
    ...lines.map((line) => `<p>${escape(line)}</p>`),
    ...(link
      ? [
          `<p><a href="${escape(link.url)}">${escape(link.label)}</a></p>`,
          `<p style="color:#888;font-size:12px">${escape(link.url)}</p>`
        ]
      : []),
    `<p>${escape(signoff(who.language))}</p>`
  ].join("\n")
  return { to: who.to, subject, text, html }
}

export const templates = {
  verifyEmail: (who: Recipient, url: string): Email =>
    who.language === "ja"
      ? compose(who, "ことり：メールアドレスの確認", ["下のリンクを開いて、メールアドレスを確認してください。"], {
          label: "メールアドレスを確認する",
          url
        })
      : compose(who, "Kotori: confirm your email", ["Open the link below to confirm your email address."], {
          label: "Confirm email",
          url
        }),

  resetPassword: (who: Recipient, url: string): Email =>
    who.language === "ja"
      ? compose(
          who,
          "ことり：パスワードの再設定",
          ["下のリンクから新しいパスワードを設定できます。心当たりがなければ、このメールは無視してください。"],
          {
            label: "パスワードを再設定する",
            url
          }
        )
      : compose(
          who,
          "Kotori: reset your password",
          ["Use the link below to choose a new password. If you didn't ask for this, you can ignore this email."],
          {
            label: "Reset password",
            url
          }
        ),

  approved: (who: Recipient): Email =>
    who.language === "ja"
      ? compose(who, "ことりへようこそ！", ["アカウントが承認されました。アプリを開いて、さっそく始めましょう。"])
      : compose(who, "You're in! Welcome to Kotori", ["Your account has been approved. Open the app and dive in."])
}
