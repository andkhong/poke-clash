import { describe, expect, it } from 'vitest';
import { distance, pickWanderWaypoint, resolveCollisions, velocityToFacing } from './movement';
import { createRng } from './rng';
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
    expect(distance(a.position, b.position)).toBeCloseTo(60, 5);
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

describe('pickWanderWaypoint', () => {
  const arena = { width: 900, height: 1950 };

  it('always picks a point a meaningful minimum distance from the current position', () => {
    const rng = createRng(1);
    // A large arena, from its center, so the minimum-distance guarantee isn't
    // masked by bounds-clamping pulling a far pick back close to `from`.
    const from = { x: 450, y: 975 };
    for (let i = 0; i < 50; i++) {
      const wp = pickWanderWaypoint(rng, arena, from);
      expect(distance(from, wp)).toBeGreaterThanOrEqual(400 - 1e-6);
    }
  });

  it('stays within the padded arena bounds even when the pick would overshoot', () => {
    const rng = createRng(2);
    const corner = { x: 48, y: 48 };
    for (let i = 0; i < 50; i++) {
      const wp = pickWanderWaypoint(rng, arena, corner);
      expect(wp.x).toBeGreaterThanOrEqual(48);
      expect(wp.x).toBeLessThanOrEqual(arena.width - 48);
      expect(wp.y).toBeGreaterThanOrEqual(48);
      expect(wp.y).toBeLessThanOrEqual(arena.height - 48);
    }
  });

  it('varies direction across repeated calls rather than always picking the same spot', () => {
    const rng = createRng(3);
    const from = { x: 450, y: 975 };
    const points = Array.from({ length: 10 }, () => pickWanderWaypoint(rng, arena, from));
    const uniqueX = new Set(points.map((p) => Math.round(p.x)));
    expect(uniqueX.size).toBeGreaterThan(1);
  });
});
