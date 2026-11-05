/**
 * The console's palette: the app's snow and young bamboo (wakatake) turned for a dark terminal,
 * with its rose accent kept for what needs care. Live databases are rose; local ones are green.
 */
export const color = {
  background: "#0E1511",
  surface: "#141D18",
  raised: "#1B2620",
  /** A selected row. */
  selected: "#243A2D",
  border: "#2B3A32",
  borderStrong: "#41564A",
  text: "#E6EFE8",
  muted: "#97A89E",
  faint: "#66786D",
  /** Wakatake 500, as in the app. */
  primary: "#81B38E",
  primarySoft: "#355D41",
  /** The app's rose, lifted to read on dark. */
  accent: "#E2728E",
  accentSoft: "#4A2230",
  warn: "#E5B65C",
  danger: "#EF6F6C",
  ok: "#81B38E",
  info: "#83B8D6",
  /** The sky (sora) blue behind the app icon. */
  sky: "#8FC3E8",
  /** Behind a dialog: the background, three quarters opaque. */
  scrim: "#0E1511C0"
} as const

export const symbol = {
  bullet: "●",
  dot: "·",
  arrow: "→",
  check: "✓",
  cross: "✗",
  warning: "!",
  sparkle: "✦",
  pointer: "▸",
  ellipsis: "…",
  spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
} as const

/** How a run's state reads at a glance. */
export const statusLook = {
  running: { color: color.info, icon: "◐", label: "running" },
  succeeded: { color: color.ok, icon: symbol.check, label: "done" },
  failed: { color: color.danger, icon: symbol.cross, label: "failed" },
  cancelled: { color: color.muted, icon: "◌", label: "stopped" }
} as const
