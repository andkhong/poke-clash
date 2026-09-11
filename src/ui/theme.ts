// The app's shared color/font tokens — "Retro Arcade" (21st.dev,
// @serafimcloud), a Solarized Light palette repackaged as a shadcn theme.
// Every plain-DOM screen/component under src/ui should pull its colors from
// here instead of hardcoding hex literals, so the app reads as one
// consistent theme instead of each screen inventing its own. Deliberately
// scoped to the DOM UI chrome only — the Phaser-rendered game world
// (src/render/**: sprites, move VFX, arena tileset, in-canvas move labels)
// keeps its own separately-tuned palette, since those colors are gameplay/
// art choices rather than app theme.

export const BG = '#fdf6e3'; // page background
export const BG_ALT = '#eee8d5'; // card/panel background, one step down from BG
export const TEXT = '#073642'; // primary text
export const TEXT_MUTED = '#586e75'; // secondary/disabled text
export const BORDER = '#839496'; // default border color (combine with an alpha below)

export const PRIMARY = '#d33682'; // magenta — primary buttons, CTAs, active/highlighted state
export const PRIMARY_TEXT = '#ffffff'; // text/icons drawn on a PRIMARY-colored surface
export const SECONDARY = '#2aa198'; // teal — secondary actions, "you" markers, team B
export const ACCENT = '#cb4b16'; // orange — badges/tags, caution state
export const DESTRUCTIVE = '#dc322f'; // red — errors, low HP, leave/end-match controls
export const SUCCESS = '#859900'; // green — healthy HP, positive state
export const BLUE = '#278bd2';
export const YELLOW = '#b58900';
export const VIOLET = '#6c71c4';

export const FONT_MONO = "'Space Mono', monospace";

/** `TEXT` at a given alpha — for borders/dividers/subtle fills that used to
 * be `rgba(255,255,255,X)` against the old dark theme; same alpha, dark ink
 * instead of white, since the background flipped from dark to light. */
export function textAlpha(alpha: number): string {
  return `rgba(7,54,66,${alpha})`;
}

/** `PRIMARY` at a given alpha — for tag/badge fills and glows. */
export function primaryAlpha(alpha: number): string {
  return `rgba(211,54,130,${alpha})`;
}

/** `ACCENT` at a given alpha — for tag/badge fills and glows. */
export function accentAlpha(alpha: number): string {
  return `rgba(203,75,22,${alpha})`;
}

/** `SECONDARY` at a given alpha. */
export function secondaryAlpha(alpha: number): string {
  return `rgba(42,161,152,${alpha})`;
}

/** `DESTRUCTIVE` at a given alpha. */
export function destructiveAlpha(alpha: number): string {
  return `rgba(220,50,47,${alpha})`;
}

/** `YELLOW` at a given alpha. */
export function yellowAlpha(alpha: number): string {
  return `rgba(181,137,0,${alpha})`;
}

/** `BG` at a given alpha — for panels drawn over the arena canvas (e.g. the
 * mobile chat drawer) that still need to read as part of the light theme. */
export function bgAlpha(alpha: number): string {
  return `rgba(253,246,227,${alpha})`;
}

/** The 8 Solarized accent colors, for palettes that need several distinct-
 * but-harmonious colors at once (e.g. chat's per-sender name color). */
export const SOLARIZED_ACCENTS = [YELLOW, ACCENT, DESTRUCTIVE, PRIMARY, VIOLET, BLUE, SECONDARY, SUCCESS] as const;
