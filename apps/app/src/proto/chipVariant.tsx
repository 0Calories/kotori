import { createContext, type ReactNode, useContext } from "react"
import type { PrototypeVariantOption } from "../components/PrototypeSwitcher.tsx"

/**
 * PROTOTYPE: Validated design candidate (`A`) vs `OLD` baseline, switchable via `?variant=` for
 * side-by-side review in the draft PR before planning the full backend + app implementation.
 */
export type ChipVariantKey = "A" | "OLD"

export interface ChipVariantSpec extends PrototypeVariantOption<ChipVariantKey> {
  readonly tagline: string
  readonly searchRowRule: string
  readonly entryLockedRule: string
  readonly kotoriNotesRule: string
}

export const CHIP_VARIANTS: ReadonlyArray<ChipVariantSpec> = [
  {
    key: "A",
    name: "Proposed Design",
    tagline:
      "Nest Shelf headboard, soft-stone grammar keycaps, 5-tier Frequency Snow Pebbles, below-example Kotori's Notes, and curated Snow-Tray search rows.",
    searchRowRule:
      "Snow-Tray row led by 5-tier Frequency first (`Very common` / `Common` / `Uncommon` / `Rare` / `Archaic`) + inflection match + at most 1 differentiating label",
    entryLockedRule:
      "Nest Shelf headboard: top-right 44pt speaker, atomic grammar keycaps (`verb`, `godan`, `transitive`), hairline Snow-Pebble shelf",
    kotoriNotesRule: "Mascot portrait `Kotori's Note [AI]` card positioned below example sentences"
  },
  {
    key: "OLD",
    name: "PR 151 Baseline",
    tagline:
      "Previous baseline across entry & search rows: scattered headboard, binary Common/Rare, above-example `✦` notes, and multi-tag search rows.",
    searchRowRule: "Vertically centered speaker; unranked `common` + POS + 2 label pills in one row",
    entryLockedRule: "Scattered headboard (`Listen` bottom-left, single POS bottom-right, PR #151 wash chips)",
    kotoriNotesRule: "Lone `✦` box placed above example sentences"
  }
]

export const parseChipVariant = (raw: string | readonly string[] | undefined): ChipVariantKey => {
  const value = Array.isArray(raw) ? raw[0] : raw
  const normalized = value?.toUpperCase()
  if (normalized === "OLD" || normalized === "PR151") return "OLD"
  return "A"
}

export const chipVariantSpec = (key: ChipVariantKey): ChipVariantSpec =>
  CHIP_VARIANTS.find((item) => item.key === key) ?? CHIP_VARIANTS[0]!

const ChipVariantContext = createContext<ChipVariantKey>("A")

export const ChipVariantProvider = ({
  variant,
  children
}: {
  readonly variant: ChipVariantKey
  readonly children: ReactNode
}) => <ChipVariantContext.Provider value={variant}>{children}</ChipVariantContext.Provider>

export const useChipVariant = () => useContext(ChipVariantContext)
