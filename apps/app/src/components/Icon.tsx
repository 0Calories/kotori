import createIconSet from "@expo/vector-icons/createIconSet"

/**
 * Material Symbols Rounded (Apache 2.0, see assets/fonts), weight 400 at the
 * 24px optical size, outlined and filled. The fonts are subsets holding only
 * the glyphs below. To add one, download both styles again from Google Fonts
 * (`css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,{0|1},0&icon_names=…`)
 * and add its codepoint here.
 */
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
  done_all: 59511,
  eco: 59957,
  edit: 58313,
  error: 57344,
  expand_more: 58831,
  forum: 57535,
  info: 59534,
  ios_share: 59064,
  link: 57687,
  local_fire_department: 61269,
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

/** Both icon fonts, for loading alongside the text faces before the app shows. */
export const iconFonts = { ...Outlined.font, ...Filled.font }

/** A decorative glyph; the control around it carries the accessible label. */
export const Icon = ({
  name,
  size = 22,
  color,
  filled
}: {
  readonly name: IconName
  readonly size?: number
  readonly color?: string
  /** The filled style, for selected tabs and toggled states. */
  readonly filled?: boolean
}) => {
  const Glyph = filled ? Filled : Outlined
  return <Glyph name={name} size={size} color={color} accessible={false} importantForAccessibility="no" />
}
