import createIconSet from "@expo/vector-icons/createIconSet"

// Subsetted Material Symbols Rounded (opsz 24, wght 400, FILL 0/1); adding a glyph requires re-downloading both TTFs with alphabetical icon_names.
const glyphs = {
  add: 57669,
  arrow_back: 58820,
  arrow_back_ios_new: 58090,
  arrow_forward: 58824,
  arrow_right_alt: 59713,
  auto_awesome: 58975,
  bookmark: 59494,
  bookmarks: 59787,
  call_split: 57526,
  cancel: 58825,
  check: 58826,
  check_circle: 59500,
  chevron_right: 58377,
  close: 57676,
  content_copy: 57677,
  delete: 59506,
  edit: 58313,
  error: 57344,
  forum: 57535,
  info: 59534,
  ios_share: 59064,
  link: 57687,
  logout: 59834,
  mail: 57688,
  menu_book: 59929,
  mic: 57385,
  monitoring: 61840,
  more_horiz: 58835,
  person: 59389,
  play_arrow: 57399,
  radio_button_unchecked: 59446,
  refresh: 58837,
  remove: 57691,
  search: 59574,
  settings: 59576,
  share: 59405,
  spellcheck: 59598,
  swap_horiz: 59604,
  volume_up: 57424,
  work_off: 59714
} as const

export type IconName = keyof typeof glyphs

const Outlined = createIconSet(
  glyphs,
  "MaterialSymbolsRounded",
  require("../../assets/fonts/MaterialSymbolsRounded.ttf")
)
const Filled = createIconSet(
  glyphs,
  "MaterialSymbolsRoundedFilled",
  require("../../assets/fonts/MaterialSymbolsRounded-Filled.ttf")
)

export const iconFonts = { ...Outlined.font, ...Filled.font }

export const Icon = ({
  name,
  size = 22,
  color,
  filled
}: {
  readonly name: IconName
  readonly size?: number
  readonly color?: string
  readonly filled?: boolean
}) => {
  const Glyph = filled ? Filled : Outlined
  return <Glyph name={name} size={size} color={color} accessible={false} importantForAccessibility="no" />
}
