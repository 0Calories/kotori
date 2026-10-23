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

/** Plain text first; the HTML is the same copy, escaped. */
const compose = (who: Recipient, subject: string, lines: ReadonlyArray<string>): Email => {
  const text = [greeting(who), "", ...lines, "", signoff(who.language)].join("\n")
  const html = [greeting(who), ...lines, signoff(who.language)].map((line) => `<p>${escape(line)}</p>`).join("\n")
  return { to: who.to, subject, text, html }
}

/**
 * Emails Kotori sends itself. Sign-up verification and password reset are sent by
 * Managed Better Auth (see docs/deploy.md for routing them through Resend via webhooks).
 */
export const templates = {
  approved: (who: Recipient): Email =>
    who.language === "ja"
      ? compose(who, "ことりへようこそ！", ["アカウントが承認されました。アプリを開いて、さっそく始めましょう。"])
      : compose(who, "You're in! Welcome to Kotori", ["Your account has been approved. Open the app and dive in."])
}
