import type { CSSProperties } from 'react';
import { ACTION, ACTION_BEVEL, CROWD, CROWD_BEVEL, FONT_UI, FRAME, INK, OUTLINE, PANEL, RUBY, SAPPHIRE, SUNK } from '../theme';

// "Hoenn Handheld" style pieces shared by the crowd UI and the Play Mode
// screens (lobby, match HUD, results), so they draw the same bars and buttons.

/** A bar track; put a barFill inside. */
export function barTrack(height: number, border = 2): CSSProperties {
  return {
    position: 'relative',
    height,
    border: `${border}px solid ${INK}`,
    borderRadius: 4,
    background: SUNK,
    overflow: 'hidden',
    boxSizing: 'content-box',
  };
}

export function barFill(color: string, fraction: number): CSSProperties {
  return {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: `${Math.max(0, Math.min(1, fraction)) * 100}%`,
    background: color,
  };
}

/** A small bordered tag: "2v2", "CROWD CALL", "YOU". */
export function chip(background: string, color = INK): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0 8px',
    minHeight: 24,
    borderRadius: 4,
    border: `2px solid ${INK}`,
    background,
    color,
    fontFamily: FONT_UI,
    fontSize: 15,
    whiteSpace: 'nowrap',
  };
}

export type ButtonKind = 'primary' | 'secondary' | 'crowd';

/** Chunky bevelled button, ≥ 44 px tall. Primary is gold with INK text. */
export function hoennButton(kind: ButtonKind, enabled = true, size: 'md' | 'lg' = 'md'): CSSProperties {
  const fill = kind === 'primary' ? ACTION : kind === 'crowd' ? CROWD : PANEL;
  const bevel = kind === 'primary' ? ACTION_BEVEL : kind === 'crowd' ? CROWD_BEVEL : SUNK;
  return {
    minHeight: size === 'lg' ? 56 : 46,
    padding: size === 'lg' ? '0 28px' : '0 14px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 8,
    border: `3px solid ${INK}`,
    background: enabled ? fill : SUNK,
    color: enabled && kind === 'crowd' ? PANEL : INK,
    boxShadow: enabled ? `inset 0 -4px 0 ${bevel}` : 'none',
    fontFamily: FONT_UI,
    fontWeight: 700,
    fontSize: size === 'lg' ? 24 : 18,
    textDecoration: 'none',
    cursor: enabled ? 'pointer' : 'not-allowed',
    boxSizing: 'border-box',
  };
}

/** The battle message box: white with an ink outline and teal inner trim. */
export const messageBox: CSSProperties = {
  background: PANEL,
  border: OUTLINE,
  borderRadius: 8,
  boxShadow: `inset 0 0 0 3px ${PANEL}, inset 0 0 0 7px ${FRAME}`,
  boxSizing: 'border-box',
  color: INK,
};

/** Ruby's ring / Sapphire's diamond, the team markers used everywhere. */
export function teamMarker(team: string | undefined, size = 12): CSSProperties {
  if (team === 'teamB') {
    return {
      display: 'inline-block',
      flex: 'none',
      width: size - 2,
      height: size - 2,
      background: SAPPHIRE,
      border: `2px solid ${INK}`,
      transform: 'rotate(45deg)',
    };
  }
  return {
    display: 'inline-block',
    flex: 'none',
    width: size,
    height: size,
    borderRadius: '50%',
    border: `3px solid ${team === 'teamA' ? RUBY : INK}`,
    boxSizing: 'border-box',
  };
}

/** Minimum control height: 36 px in the dense desktop sidebar (mouse), 44 px on touch surfaces. */
export function tapHeight(dense: boolean): number {
  return dense ? 36 : 44;
}

/** hoennButton's look at sidebar density: thinner border/bevel, smaller type. */
export function hoennButtonSm(kind: ButtonKind, enabled = true, dense = true): CSSProperties {
  return {
    ...hoennButton(kind, enabled),
    minHeight: tapHeight(dense),
    padding: '0 10px',
    gap: 6,
    borderWidth: 2,
    boxShadow: enabled ? `inset 0 -3px 0 ${kind === 'primary' ? ACTION_BEVEL : kind === 'crowd' ? CROWD_BEVEL : SUNK}` : 'none',
    fontSize: 15,
  };
}
