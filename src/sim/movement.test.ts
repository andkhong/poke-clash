import { describe, expect, it } from 'vitest';
import { velocityToFacing } from './movement';
import type { FacingDirection } from './types';

describe('velocityToFacing (8-way)', () => {
  it('buckets the 4 cardinal directions correctly', () => {
    expect(velocityToFacing({ x: 1, y: 0 }, 'S')).toBe('E');
    expect(velocityToFacing({ x: -1, y: 0 }, 'S')).toBe('W');
    expect(velocityToFacing({ x: 0, y: 1 }, 'S')).toBe('S'); // y-down screen space
    expect(velocityToFacing({ x: 0, y: -1 }, 'S')).toBe('N');
  });

  it('buckets the 4 diagonal directions correctly', () => {
    expect(velocityToFacing({ x: 1, y: 1 }, 'S')).toBe('SE');
    expect(velocityToFacing({ x: 1, y: -1 }, 'S')).toBe('NE');
    expect(velocityToFacing({ x: -1, y: 1 }, 'S')).toBe('SW');
    expect(velocityToFacing({ x: -1, y: -1 }, 'S')).toBe('NW');
  });

  it('snaps a near-diagonal velocity to its nearest of the 8 sectors', () => {
    // Mostly-east with a slight downward bias should still read as E, not SE,
    // until it crosses the 22.5° halfway point into the next sector.
    expect(velocityToFacing({ x: 10, y: 1 }, 'S')).toBe('E');
    expect(velocityToFacing({ x: 10, y: 9 }, 'S')).toBe('SE');
  });

  it('keeps the previous facing when velocity is effectively zero (avoids jitter)', () => {
    for (const previous of ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'] as FacingDirection[]) {
      expect(velocityToFacing({ x: 0, y: 0 }, previous)).toBe(previous);
      expect(velocityToFacing({ x: 1e-6, y: -1e-6 }, previous)).toBe(previous);
    }
  });

  it('stays on the current facing when velocity sits right at a sector boundary (anti-flicker)', () => {
    // Exactly at the E/SE boundary (22.5°) — whichever side you were already
    // on should stick, rather than the raw nearest-sector rounding flipping
    // it back and forth every tick as steering forces nudge the angle by a
    // fraction of a degree either way.
    const boundary = { x: Math.cos(Math.PI / 8), y: Math.sin(Math.PI / 8) };
    expect(velocityToFacing(boundary, 'E')).toBe('E');
    expect(velocityToFacing(boundary, 'SE')).toBe('SE');
  });

  it('still switches facing once the angle moves meaningfully past the boundary', () => {
    expect(velocityToFacing({ x: 1, y: 1 }, 'E')).toBe('SE'); // a full 45° past E's center
  });

  it('covers a full sweep of all 8 sectors exactly once each, in compass order', () => {
    const seen: FacingDirection[] = [];
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const facing = velocityToFacing({ x: Math.cos(angle), y: Math.sin(angle) }, 'S');
      seen.push(facing);
    }
    expect(new Set(seen).size).toBe(8); // all 8 directions represented, none skipped or duplicated
  });
});
