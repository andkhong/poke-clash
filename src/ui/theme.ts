// The app's shared color/font tokens — "Hoenn Handheld": the Game Boy
// Advance Ruby/Sapphire look (design canvas: claude.ai/artifact/9yYywhgd5tarYMh7HSnwYu).
// Every color is a swatch from the Ruby/Sapphire overworld palette (56 colors);
// the contrast notes are measured against PANEL (white) unless they say otherwise.
// Pale bag-screen blue ground, white message-box panels with a dark ink
// outline and teal trim, badge-gold primary actions; Team Ruby vs Team
// Sapphire, and Emerald green for anything the crowd causes. Hexes are
// matched by eye — no game assets are used.
//
// Every plain-DOM screen/component under src/ui should pull its colors from
// here instead of hardcoding hex literals. The Phaser game world keeps its
// own palette (src/render/**), apart from the team colors in teamColors.ts.

// --- Hoenn Handheld tokens ---
export const GROUND = '#dee6ee'; // page background (pale blue)
export const GROUND_ROUTE = '#a4d5c5'; // section bands, chips (route mint)
export const PANEL = '#ffffff'; // windows, cards (battle message box)
export const FRAME = '#62a4de'; // message-box inner trim — decoration only, never text
export const INFO_BOX = '#eee6a4'; // fighter status, roster rows (battle HUD cream)
export const INK = '#29315a'; // text and every outline (12.5:1; 9.8:1 on GROUND/INFO_BOX)
export const INK_MUTED = '#62627b'; // secondary text (5.9:1; 4.6:1 on GROUND/INFO_BOX)
export const SUNK = '#bdcde6'; // bar tracks, disabled fills, button bottom bevel
export const COOLDOWN = '#a4a4a4'; // cooldown sweep, losing vote bars
export const ACTION = '#ffc55a'; // primary buttons, focus ring, "You" — always INK text on it (8.0:1)
export const ACTION_BEVEL = '#cd9c52'; // bottom edge of ACTION buttons — not for text
export const RUBY = '#c54141'; // Team Ruby (5.0:1 both ways with white)
export const SAPPHIRE = '#62acee'; // Team Sapphire fill (INK text 5.2:1)
export const SAPPHIRE_DEEP = '#394a7b'; // Sapphire text/headers, links (8.6:1)
export const CROWD = '#398b31'; // fills for anything the crowd causes (white text 4.3:1 — large/bold text only)
export const CROWD_TEXT = '#395200'; // crowd-colored text on light grounds (8.8:1)
export const CROWD_BEVEL = '#395200';
export const CROWD_TINT = '#73c5a4'; // your vote, crowd rows (INK text 6.1:1)
export const HP_GREEN = '#41b483';
export const HP_YELLOW = '#ffc55a';
export const HP_RED = '#ff625a';
export const ENERGY = '#528bc5'; // energy bar
export const OUTLINE = `3px solid ${INK}`; // message-box border

/** Pixel face with real weights: headings, HUD, buttons, labels, message-box text. 18px and up. */
export const FONT_UI = "'UI Digits', 'Pixelify Sans', 'Press Start 2P', monospace"; // UI Digits: see index.html
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
export const ACCENT = '#7b4141'; // badges/tags, caution state (7.9:1; 6.2:1 on INFO_BOX)
export const DESTRUCTIVE = '#c54141'; // errors, leave/end-match controls
export const SUCCESS = '#395200'; // positive state (text-safe green)
export const BLUE = SAPPHIRE_DEEP;
export const YELLOW = '#6a5a5a'; // text-safe warm gray (the palette has no dark gold)
export const VIOLET = '#624152';

export const FONT_MONO = FONT_BODY;

/** `TEXT` at a given alpha — for borders/dividers/subtle fills that used to
 * be `rgba(255,255,255,X)` against the old dark theme; same alpha, dark ink
 * instead of white, since the background flipped from dark to light. */
export function textAlpha(alpha: number): string {
  return `rgba(41,49,90,${alpha})`;
}

/** `PRIMARY` at a given alpha — for tag/badge fills and glows. */
export function primaryAlpha(alpha: number): string {
  return `rgba(255,197,90,${alpha})`;
}

/** `ACCENT` at a given alpha — for tag/badge fills and glows. */
export function accentAlpha(alpha: number): string {
  return `rgba(123,65,65,${alpha})`;
}

/** `SECONDARY` at a given alpha. */
export function secondaryAlpha(alpha: number): string {
  return `rgba(57,74,123,${alpha})`;
}

/** `DESTRUCTIVE` at a given alpha. */
export function destructiveAlpha(alpha: number): string {
  return `rgba(197,65,65,${alpha})`;
}

/** `YELLOW` at a given alpha. */
export function yellowAlpha(alpha: number): string {
  return `rgba(106,90,90,${alpha})`;
}

/** `BG` at a given alpha — for panels drawn over the arena canvas (e.g. the
 * mobile chat drawer) that still need to read as part of the light theme. */
export function bgAlpha(alpha: number): string {
  return `rgba(222,230,238,${alpha})`;
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
export const TEXT_ACCENTS = [RUBY, SAPPHIRE_DEEP, CROWD_TEXT, ACCENT, VIOLET, YELLOW, '#414a6a', '#cd4152'] as const;
/** Legacy name for TEXT_ACCENTS. */
export const SOLARIZED_ACCENTS = TEXT_ACCENTS;
