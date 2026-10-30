import type { EnglishNuance } from "@kotori/domain"
import { View } from "react-native"
import { useSession } from "../session/SessionProvider.tsx"
import { Chip } from "./Chip.tsx"
import { Text } from "./Text.tsx"

/** Low-confidence judgments are never shown; matches the entry screen's threshold. */
const CONFIDENT = 0.55

const NO_SPELLINGS: ReadonlyArray<string> = []

/**
 * The English side of a sense, for Japanese natives: variety, strength, currency and
 * register chips, and the loanword verdict. A diverging katakana loan (スタイル ≠ style)
 * is the headline warning; a matching one is quiet good news, unless the loan is the very
 * word on screen (コーヒー for "coffee"), where it would say nothing.
 */
export const EnglishNuanceNotes = ({
  english,
  word = NO_SPELLINGS
}: {
  readonly english: EnglishNuance
  /** The spellings of the Japanese word being shown. */
  readonly word?: ReadonlyArray<string>
}) => {
  const { t } = useSession()
  const labels = t.nuance.english
  const confident = (judgment: { readonly confidence: number }) => judgment.confidence >= CONFIDENT
  const chips = [
    confident(english.variety) ? labels.variety[english.variety.value] : "",
    confident(english.strength) ? labels.strength[english.strength.value] : "",
    confident(english.currency) ? labels.currency[english.currency.value] : "",
    confident(english.register) ? labels.register[english.register.value] : "",
    confident(english.loan) && english.loan.value === "matches" && !word.includes(english.loanWord ?? "")
      ? labels.loanMatches
      : ""
  ].filter((chip) => chip.length > 0)
  const diverges = confident(english.loan) && english.loan.value === "diverges"
  const strong = english.strength.value === "strong" || english.strength.value === "avoid"
  if (chips.length === 0 && !diverges) return null
  return (
    <View style={{ gap: 6 }}>
      {chips.length > 0 || diverges ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {diverges ? <Chip tone="accent" icon="error" label={labels.loanDiverges(english.loanWord)} /> : null}
          {chips.map((chip) => (
            <Chip
              key={chip}
              tone={strong && chip === labels.strength[english.strength.value] ? "accent" : "neutral"}
              label={chip}
            />
          ))}
        </View>
      ) : null}
      {diverges && english.loanTrap ? (
        <Text jp variant="caption" color="textMuted">
          {english.loanTrap}
        </Text>
      ) : null}
    </View>
  )
}
