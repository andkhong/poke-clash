import { describe, expect, it } from 'vitest';
import { clampToArenaBounds, getPlayableBounds, resolveCollisions, velocityToFacing } from './movement';
import {
  ARENA_PADDING,
  ARENA_TOP_PADDING,
  DESKTOP_ARENA_HEIGHT,
  DESKTOP_ARENA_WIDTH,
  getFenceInsets,
  getRedZoneInsets,
} from './constants';
import type { FacingDirection, PokemonInstance } from './types';

function makeCollider(id: string, x: number, y: number, collisionRadius: number): PokemonInstance {
  return {
    instanceId: id,
    speciesId: 1,
    name: 'Test',
    level: 100,
    types: ['normal'],
    baseStats: { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 },
    computedStats: { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 },
    statStages: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 },
    currentHp: 100,
    maxHp: 100,
    moves: [],
    status: null,
    statusTickAccumMs: 0,
    position: { x, y },
    velocity: { x: 0, y: 0 },
    facing: 'S',
    collisionRadius,
    team: id,
    aiState: 'wander',
    targetInstanceId: null,
    lastRetargetMs: 0,
    actionCooldownMs: 0,
    postAttackHoldMs: 0,
    shiny: false,
  };
}

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

describe('resolveCollisions', () => {
  it('separates two overlapping Pokémon until their circles just touch', () => {
    const a = makeCollider('a', 500, 500, 30);
    const b = makeCollider('b', 520, 500, 30); // 20px apart, but combined radius is 60 — deep overlap
    const pokemonById = { a, b };
    resolveCollisions(['a', 'b'], pokemonById, { width: 2000, height: 2000 });
    expect(Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y)).toBeCloseTo(60, 5);
    // Pushed apart symmetrically along the connecting axis, not just one side.
    expect(a.position.x).toBeLessThan(500);
    expect(b.position.x).toBeGreaterThan(520);
  });

  it('leaves non-overlapping Pokémon untouched', () => {
    const a = makeCollider('a', 500, 500, 30);
    const b = makeCollider('b', 700, 500, 30);
    const pokemonById = { a, b };
    resolveCollisions(['a', 'b'], pokemonById, { width: 2000, height: 2000 });
    expect(a.position).toEqual({ x: 500, y: 500 });
    expect(b.position).toEqual({ x: 700, y: 500 });
  });

  it('never pushes a Pokémon outside the arena bounds', () => {
    const a = makeCollider('a', 10, 500, 30);
    const b = makeCollider('b', 25, 500, 30); // overlap would push `a` past x=0
    const pokemonById = { a, b };
    resolveCollisions(['a', 'b'], pokemonById, { width: 2000, height: 2000 });
    expect(a.position.x).toBeGreaterThanOrEqual(48); // ARENA_PADDING
  });
});

describe('wide arena fence (getPlayableBounds / clampToArenaBounds)', () => {
  const desktopArena = { width: DESKTOP_ARENA_WIDTH, height: DESKTOP_ARENA_HEIGHT };

  it('draws the playable rectangle just inside the fence line on a landscape arena', () => {
    const fence = getFenceInsets(desktopArena);
    expect(fence.left).toBeGreaterThan(0);
    expect(fence.right).toBeGreaterThan(0);
    expect(fence.bottom).toBeGreaterThan(0);
    expect(getPlayableBounds(desktopArena)).toEqual({
      minX: fence.left + ARENA_PADDING,
      maxX: desktopArena.width - fence.right - ARENA_PADDING,
      minY: Math.max(ARENA_TOP_PADDING, fence.top + ARENA_PADDING),
      maxY: desktopArena.height - fence.bottom - ARENA_PADDING,
    });
  });

  it('stops a Pokémon walking through each side of the fence', () => {
    const bounds = getPlayableBounds(desktopArena);
    const centre = { x: desktopArena.width / 2, y: desktopArena.height / 2 };
    const cases: Array<{ velocity: { x: number; y: number }; expected: { x: number; y: number } }> = [
      { velocity: { x: -5000, y: 0 }, expected: { x: bounds.minX, y: centre.y } },
      { velocity: { x: 5000, y: 0 }, expected: { x: bounds.maxX, y: centre.y } },
      { velocity: { x: 0, y: -5000 }, expected: { x: centre.x, y: bounds.minY } },
      { velocity: { x: 0, y: 5000 }, expected: { x: centre.x, y: bounds.maxY } },
    ];
    for (const { velocity, expected } of cases) {
      const p = makeCollider('p', centre.x, centre.y, 40);
      // A full second at wall-crossing speed, then the clamp every mover applies.
      const moved = { x: p.position.x + velocity.x, y: p.position.y + velocity.y };
      expect(clampToArenaBounds(moved, desktopArena)).toEqual(expected);
    }
  });

  it('keeps a Pokémon shoved by a collision inside the fence too', () => {
    const bounds = getPlayableBounds(desktopArena);
    const a = makeCollider('a', bounds.minX, 540, 30);
    const b = makeCollider('b', bounds.minX + 15, 540, 30); // overlap would push `a` through the left fence
    resolveCollisions(['a', 'b'], { a, b }, desktopArena);
    expect(a.position.x).toBeGreaterThanOrEqual(bounds.minX);
  });

  it('leaves the portrait arena untouched — no fence there', () => {
    const arena = { width: 900, height: 1950 };
    expect(getFenceInsets(arena)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    const redZone = getRedZoneInsets(arena);
    expect(getPlayableBounds(arena)).toEqual({
      minX: ARENA_PADDING + redZone.left,
      maxX: arena.width - ARENA_PADDING - redZone.right,
      minY: Math.max(ARENA_TOP_PADDING, redZone.top),
      maxY: arena.height - ARENA_PADDING - redZone.bottom,
    });
  });
});

