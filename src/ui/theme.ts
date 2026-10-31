// The app's shared color/font tokens — "Hoenn Handheld": the Game Boy
// Advance Ruby/Sapphire look (design canvas: claude.ai/artifact/9yYywhgd5tarYMh7HSnwYu).
// Pale bag-screen blue ground, white message-box panels with a dark ink
// outline and teal trim, badge-gold primary actions; Team Ruby vs Team
// Sapphire, and Emerald green for anything the crowd causes. Hexes are
// matched by eye — no game assets are used.
//
// Every plain-DOM screen/component under src/ui should pull its colors from
// here instead of hardcoding hex literals. The Phaser game world keeps its
// own palette (src/render/**), apart from the team colors in teamColors.ts.

// --- Hoenn Handheld tokens ---
export const GROUND = '#dde9f2'; // page background (bag/summary screen pale blue)
export const GROUND_ROUTE = '#e2f0d8'; // section bands, chips (route grass)
export const PANEL = '#ffffff'; // windows, cards (battle message box)
export const FRAME = '#78b0c8'; // message-box inner trim — decoration only, never text
export const INFO_BOX = '#f4f8e8'; // fighter status, roster rows (battle HUD box)
export const INK = '#283038'; // text and every outline (13.4:1 on white)
export const INK_MUTED = '#586068'; // secondary text (6.4:1 on white)
export const SUNK = '#c8d4dc'; // bar tracks, disabled fills, button bottom bevel
export const COOLDOWN = '#a8b4bc'; // cooldown sweep, losing vote bars
export const ACTION = '#f8c840'; // primary buttons, focus ring, "You" — always INK text on it
export const ACTION_BEVEL = '#d09820'; // bottom edge of ACTION buttons — not for text
export const RUBY = '#b01830'; // Team Ruby (white text 6.9:1)
export const SAPPHIRE = '#6c9cec'; // Team Sapphire fill (INK text 4.8:1)
export const SAPPHIRE_DEEP = '#2048a0'; // Sapphire text/headers, links (8.4:1)
export const CROWD = '#0f7f50'; // everything the crowd causes (white text 5.1:1)
export const CROWD_BEVEL = '#0a5c3a';
export const CROWD_TINT = '#d6efe0'; // your vote, crowd rows
export const HP_GREEN = '#50c060';
export const HP_YELLOW = '#e8c028';
export const HP_RED = '#e04830';
export const ENERGY = '#3890e0'; // energy bar (EXP bar blue)
export const OUTLINE = `3px solid ${INK}`; // message-box border

/** Pixel face with real weights: headings, HUD, buttons, labels, message-box text. 18px and up. */
export const FONT_UI = "'Pixelify Sans', 'Press Start 2P', monospace";
/** Body copy, chat and long text — built for small-size legibility. */
export const FONT_BODY = "'Atkinson Hyperlegible', system-ui, sans-serif";
/** Tiny accents only: timers, key caps, HP/EN tags (matches the in-arena labels). */
export const FONT_PIXEL = "'Press Start 2P', monospace";

// --- Legacy names, remapped onto Hoenn Handheld so existing screens follow
// the new theme. Prefer the tokens above in new code. ---
export const BG = GROUND; // page background
export const BG_ALT = PANEL; // card/panel background
export const TEXT = INK; // primary text
export const TEXT_MUTED = INK_MUTED; // secondary/disabled text
export const BORDER = INK; // default border color (combine with an alpha below)

export const PRIMARY = ACTION; // primary buttons, CTAs, active state — a FILL; gold text fails contrast
export const PRIMARY_TEXT = INK; // text/icons drawn on a PRIMARY-colored surface
export const SECONDARY = SAPPHIRE_DEEP; // secondary actions, "you" markers
export const ACCENT = '#a84810'; // badges/tags, caution state (text-safe: 5.4:1 on INFO_BOX)
export const DESTRUCTIVE = '#c02828'; // errors, leave/end-match controls
export const SUCCESS = '#2e7d3a'; // positive state (text-safe green)
export const BLUE = SAPPHIRE_DEEP;
export const YELLOW = '#8a6400'; // text-safe gold
export const VIOLET = '#5848a8';

export const FONT_MONO = FONT_BODY;

/** `TEXT` at a given alpha — for borders/dividers/subtle fills that used to
 * be `rgba(255,255,255,X)` against the old dark theme; same alpha, dark ink
 * instead of white, since the background flipped from dark to light. */
export function textAlpha(alpha: number): string {
  return `rgba(40,48,56,${alpha})`;
}

/** `PRIMARY` at a given alpha — for tag/badge fills and glows. */
export function primaryAlpha(alpha: number): string {
  return `rgba(248,200,64,${alpha})`;
}

/** `ACCENT` at a given alpha — for tag/badge fills and glows. */
export function accentAlpha(alpha: number): string {
  return `rgba(168,72,16,${alpha})`;
}

/** `SECONDARY` at a given alpha. */
export function secondaryAlpha(alpha: number): string {
  return `rgba(32,72,160,${alpha})`;
}

/** `DESTRUCTIVE` at a given alpha. */
export function destructiveAlpha(alpha: number): string {
  return `rgba(192,40,40,${alpha})`;
}

/** `YELLOW` at a given alpha. */
export function yellowAlpha(alpha: number): string {
  return `rgba(138,100,0,${alpha})`;
}

/** `BG` at a given alpha — for panels drawn over the arena canvas (e.g. the
 * mobile chat drawer) that still need to read as part of the light theme. */
export function bgAlpha(alpha: number): string {
  return `rgba(221,233,242,${alpha})`;
}

/** The 3D "key edge" under PRIMARY buttons. Not a text color (gold on white fails). */
export const PRIMARY_DEEP = ACTION_BEVEL;
/** Dark stage behind embedded arenas and room thumbnails. Same value as
 * MatchScreen's pageStyle, so the landing frame blends with the letterbox. */
export const STAGE_BG = INK;

/** Display: wordmark, section titles. */
export const FONT_DISPLAY = FONT_UI;

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

/** Eight text-safe Gen III hues (all ≥ 4.5:1 on PANEL and INFO_BOX), for
 * palettes that need several distinct colors at once (e.g. chat's per-sender
 * name color). No gold: it fails contrast as text. */
export const TEXT_ACCENTS = [RUBY, SAPPHIRE_DEEP, CROWD, ACCENT, VIOLET, YELLOW, '#a02878', '#18707c'] as const;
/** Legacy name for TEXT_ACCENTS. */
export const SOLARIZED_ACCENTS = TEXT_ACCENTS;
