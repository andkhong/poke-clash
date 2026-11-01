import { ARENA_HEIGHT, ARENA_WIDTH, DESKTOP_ARENA_HEIGHT, DESKTOP_ARENA_WIDTH } from '../sim/constants';
import type { ArenaBounds } from '../sim/types';

// Single source of truth is sim/constants.ts — re-exported here so UI code
// only ever needs to import from app/config.
export { ARENA_WIDTH, ARENA_HEIGHT, DESKTOP_ARENA_WIDTH, DESKTOP_ARENA_HEIGHT };

/**
 * True for an actual mobile device (phone/tablet), never for a desktop
 * browser window regardless of how it's sized or shaped — this is a device
 * check, not a viewport-orientation one, so a phone rotated to landscape (or
 * a desktop window resized narrow-tall) doesn't flip the answer. Computed
 * once at module load since a session's device type never changes.
 *
 * Prefers the Client Hints `navigator.userAgentData.mobile` flag (accurate,
 * but Chromium-only today) and falls back to a standard UA regex elsewhere
 * (Safari/Firefox). Guarded for a non-browser context (e.g. this module
 * loaded under a test runner with no `navigator`) even though nothing
 * currently imports app/config.ts from one.
 */
export const IS_MOBILE_DEVICE: boolean = detectMobileDevice();

function detectMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (typeof nav.userAgentData?.mobile === 'boolean') return nav.userAgentData.mobile;
  return /Android|iPhone|iPad|iPod|IEMobile|BlackBerry|Opera Mini|Mobile/i.test(navigator.userAgent);
}

/**
 * Resolves this match's arena shape. Mobile devices are hard-locked to the
 * portrait arena this game is fundamentally built around (it's meant to
 * become IG/TikTok video, see sim/constants.ts's ARENA_WIDTH/HEIGHT comment)
 * — `preferWide` is ignored entirely on one. A non-mobile browser gets the
 * wide desktop arena when `preferWide` is set. Decided once, at match start, the same
 * way arena size is already fixed for a match's whole duration — resizing
 * the window mid-match doesn't reshape an arena already in progress.
 */
export function resolveMatchArena(preferWide: boolean): ArenaBounds {
  if (!IS_MOBILE_DEVICE && preferWide) return { width: DESKTOP_ARENA_WIDTH, height: DESKTOP_ARENA_HEIGHT };
  return { width: ARENA_WIDTH, height: ARENA_HEIGHT };
}
