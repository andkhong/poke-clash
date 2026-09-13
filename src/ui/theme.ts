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

/** PRIMARY darkened for small magenta text on BG/BG_ALT (5.60:1 / 4.93:1) and the
 * 3D "key edge" under PRIMARY buttons. White on it is 6.05:1. */
export const PRIMARY_DEEP = '#b02f6d';
/** Dark stage behind embedded arenas and room thumbnails. Same value as
 * MatchScreen's pageStyle, so the landing frame blends with the letterbox. */
export const STAGE_BG = '#101216';

/** Press Start 2P, already loaded in index.html. Crisp at multiples of 8px
 * (use 16/24/48). Display only: wordmark, section titles, step numbers. */
export const FONT_DISPLAY = "'Press Start 2P', 'Space Mono', monospace";

export const RADIUS_SM = 8; // buttons, chips, thumbnails on mobile
export const RADIUS_MD = 10; // room thumbnails
export const RADIUS_LG = 14; // featured frame, step cards, info boxes
export const RADIUS_PILL = 999;

/** 4px spacing scale. */
export const SPACE = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 32, 8: 48, 9: 64, 10: 80 } as const;

export const SHADOW_SM = `0 1px 2px ${textAlpha(0.08)}`;
export const SHADOW_MD = `0 8px 20px ${textAlpha(0.12)}`;
export const SHADOW_LG = `0 18px 44px ${textAlpha(0.18)}`;
/** Retro offset shadows, no blur. */
export const SHADOW_HARD = `4px 4px 0 ${textAlpha(0.12)}`;
export const SHADOW_HARD_LG = `6px 6px 0 ${textAlpha(0.14)}`;

export const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
export const DURATION_FAST_MS = 120;
export const DURATION_BASE_MS = 180;
export const DURATION_PULSE_MS = 1600;

/** The 8 Solarized accent colors, for palettes that need several distinct-
 * but-harmonious colors at once (e.g. chat's per-sender name color). */
export const SOLARIZED_ACCENTS = [YELLOW, ACCENT, DESTRUCTIVE, PRIMARY, VIOLET, BLUE, SECONDARY, SUCCESS] as const;
