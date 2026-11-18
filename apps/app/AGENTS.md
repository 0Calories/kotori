# `@kotori/app` coding standards

## Theme tokens

Every style value with a token in `src/theme/tokens.ts` is written as that token, read from `useTheme()` (`color`, `space`, `radius`, `shadow`, `font`, `maxWidth`): `borderRadius: radius.sm`, `padding: space.md`, `color: color.textMuted`, never `14`, `12` or `"#515E58"`. A literal that equals a token is a bug, even when it renders the same.

- **Colours** are always a palette token, or `fade(token, alpha)` for a wash of one. A new colour becomes a new token in the `wakatake` palette, documented with what it is for (`sora` spreads `wakatake`, so it overrides the token only when the theme's hue tinges it). A third party's brand colours, such as Google's on its sign-in button, stay as they are.
- **Spacing and radii** use the token when one has the value. A value no token has (a chip's 5px vertical padding) stays a literal. If the same literal turns up in a second component, it becomes a token in `space` or `radius`.
- **Geometry** that follows from an element's own size comes from a named constant, not a token: a dot's `borderRadius: DOT / 2`.
- **Shadows** come from `shadow(elevation)`, which handles both the web and native forms.
