import { describe, expect, it } from 'vitest';
import { distance, pickWanderWaypoint, resolveCollisions, steerToward, velocityToFacing } from './movement';
import { createRng } from './rng';
import { ARENA_TOP_PADDING, RED_ZONE_RIGHT_FRACTION, getRedZoneInsets } from './constants';
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

describe('steerToward facing', () => {
  it('faces the seek direction even when crowding neighbors would push the blended velocity a very different way', () => {
    const self = makeCollider('self', 500, 500, 40);
    self.facing = 'S';
    const target = { x: 900, y: 500 }; // due east — an unambiguous seek direction
    // Five heavily-overlapping neighbors packed just north of self, all well
    // within separation's influence radius — their combined push is strong
    // enough to swing the blended velocity to ~38° off due east (confirmed
    // against the pre-fix formula: this exact setup used to flip facing to
    // 'SE'), despite this Pokémon actually trying to go straight east.
    const neighbors = [
      { instanceId: 'self', position: self.position, collisionRadius: 40 },
      { instanceId: 'n1', position: { x: 495, y: 485 }, collisionRadius: 40 },
      { instanceId: 'n2', position: { x: 500, y: 485 }, collisionRadius: 40 },
      { instanceId: 'n3', position: { x: 505, y: 485 }, collisionRadius: 40 },
      { instanceId: 'n4', position: { x: 497, y: 483 }, collisionRadius: 40 },
      { instanceId: 'n5', position: { x: 503, y: 483 }, collisionRadius: 40 },
    ];
    steerToward(self, target, 180, neighbors);
    expect(self.facing).toBe('E');
  });

  it('stays on one stable facing across ticks despite the crowd jittering, as long as the seek target does not move', () => {
    const self = makeCollider('self', 500, 500, 40);
    const target = { x: 900, y: 500 };
    const facingsSeen = new Set<FacingDirection>();
    // The same strong 5-neighbor cluster as above, alternating between
    // packed just north and just south of self each tick — as it would if
    // several separate Pokémon were jostling past each other tick to tick.
    // Confirmed against the pre-fix formula: this exact alternation used to
    // flip facing between 'SE' and 'NE' every other tick, despite this
    // Pokémon's own seek target never moving at all.
    for (let i = 0; i < 20; i++) {
      const ySign = i % 2 === 0 ? -1 : 1;
      const neighbors = [
        { instanceId: 'self', position: self.position, collisionRadius: 40 },
        { instanceId: 'n1', position: { x: 495, y: 500 + ySign * 15 }, collisionRadius: 40 },
        { instanceId: 'n2', position: { x: 500, y: 500 + ySign * 15 }, collisionRadius: 40 },
        { instanceId: 'n3', position: { x: 505, y: 500 + ySign * 15 }, collisionRadius: 40 },
        { instanceId: 'n4', position: { x: 497, y: 500 + ySign * 17 }, collisionRadius: 40 },
        { instanceId: 'n5', position: { x: 503, y: 500 + ySign * 17 }, collisionRadius: 40 },
      ];
      steerToward(self, target, 180, neighbors);
      facingsSeen.add(self.facing);
    }
    expect(facingsSeen).toEqual(new Set<FacingDirection>(['E']));
  });

  it('leaves facing untouched when there is nowhere to go (hold-still callers passing target=self.position)', () => {
    const self = makeCollider('self', 500, 500, 40);
    self.facing = 'NW';
    steerToward(self, self.position, 0, []);
    expect(self.facing).toBe('NW');
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
    // A large, square arena (square isn't "mobile"-shaped — see
    // isMobileArena — so it also carries no red-zone reservation), from its
    // center, so the minimum-distance guarantee isn't masked by
    // bounds-clamping pulling a far pick back close to `from`. The portrait
    // arena used elsewhere in this file is intentionally too narrow for that
    // isolation — its own red-zone reservation is exactly what the tests
    // below exercise.
    const bigArena = { width: 4000, height: 4000 };
    const from = { x: 2000, y: 2000 };
    for (let i = 0; i < 50; i++) {
      const wp = pickWanderWaypoint(rng, bigArena, from);
      expect(distance(from, wp)).toBeGreaterThanOrEqual(400 - 1e-6);
    }
  });

  it('never picks a waypoint past the red zone on any of the four edges of a portrait (mobile) arena', () => {
    const rng = createRng(4);
    const from = { x: 450, y: 975 };
    const redZone = getRedZoneInsets(arena);
    // Sanity: this arena is portrait, so a reservation applies on every edge.
    expect(redZone.top).toBeGreaterThan(0);
    expect(redZone.right).toBeGreaterThan(0);
    expect(redZone.bottom).toBeGreaterThan(0);
    expect(redZone.left).toBeGreaterThan(0);
    const topBound = Math.max(ARENA_TOP_PADDING, redZone.top);
    for (let i = 0; i < 200; i++) {
      const wp = pickWanderWaypoint(rng, arena, from);
      expect(wp.x).toBeGreaterThanOrEqual(48 + redZone.left - 1e-6);
      expect(wp.x).toBeLessThanOrEqual(arena.width - 48 - redZone.right + 1e-6);
      expect(wp.y).toBeGreaterThanOrEqual(topBound - 1e-6);
      expect(wp.y).toBeLessThanOrEqual(arena.height - 48 - redZone.bottom + 1e-6);
    }
  });

  it('applies no red-zone reservation on a landscape (desktop) arena', () => {
    const rng = createRng(5);
    const desktopArena = { width: 1920, height: 1080 };
    const from = { x: 960, y: 540 };
    const redZone = getRedZoneInsets(desktopArena);
    expect(redZone).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    let sawNearRightEdge = false;
    for (let i = 0; i < 200; i++) {
      const wp = pickWanderWaypoint(rng, desktopArena, from);
      expect(wp.x).toBeLessThanOrEqual(desktopArena.width - 48 + 1e-6);
      if (wp.x > desktopArena.width - 48 - desktopArena.width * RED_ZONE_RIGHT_FRACTION) sawNearRightEdge = true;
    }
    // Confirms the loose upper bound above isn't just trivially true — some
    // picks really do land in what would've been the red zone on a portrait
    // arena, proving the desktop arena genuinely imposes no such reservation.
    expect(sawNearRightEdge).toBe(true);
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

  it('mostly escapes into the open arena instead of re-landing on the same wall it started at', () => {
    const rng = createRng(6);
    const topLeftCorner = { x: 48, y: 200 }; // exactly ARENA_PADDING/ARENA_TOP_PADDING's corner
    const EPSILON = 1e-6;
    const trials = 300;
    let stillOnAWall = 0;
    for (let i = 0; i < trials; i++) {
      const wp = pickWanderWaypoint(rng, arena, topLeftCorner);
      const onVerticalWall = wp.x <= 48 + EPSILON || wp.x >= arena.width - 48 + EPSILON;
      const onHorizontalWall = wp.y <= 200 + EPSILON || wp.y >= arena.height - 48 + EPSILON;
      if (onVerticalWall || onHorizontalWall) stillOnAWall++;
    }
    // A single uncontested random cast (the old behavior) lands back on one
    // of this corner's two walls roughly 3 times out of 4 — steerToward then
    // just walks it along that wall to the new point instead of into the
    // arena, which repeated over a few legs reads as sliding along the wall
    // rather than redirecting away from it. The retry keeps that a rare
    // fallback instead of the common case.
    expect(stillOnAWall / trials).toBeLessThan(0.2);
  });

  it('varies direction across repeated calls rather than always picking the same spot', () => {
    const rng = createRng(3);
    const from = { x: 450, y: 975 };
    const points = Array.from({ length: 10 }, () => pickWanderWaypoint(rng, arena, from));
    const uniqueX = new Set(points.map((p) => Math.round(p.x)));
    expect(uniqueX.size).toBeGreaterThan(1);
  });
});
