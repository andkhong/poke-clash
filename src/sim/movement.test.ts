import { describe, expect, it } from 'vitest';
import {
  applyMovement,
  distance,
  getPlayableBounds,
  pickWanderWaypoint,
  resolveCollisions,
  steerToward,
  trackWanderHeadway,
  velocityToFacing,
} from './movement';
import { createRng } from './rng';
import {
  ARENA_PADDING,
  ARENA_TOP_PADDING,
  DESKTOP_ARENA_HEIGHT,
  DESKTOP_ARENA_WIDTH,
  TICK_MS,
  WANDER_SPEED,
  WANDER_STUCK_REPICK_MS,
  WANDER_TURN_AWAY_MIN_RAD,
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

describe('wide arena fence (getPlayableBounds / applyMovement)', () => {
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
      p.velocity = velocity;
      applyMovement(p, 1000, desktopArena); // a full second at wall-crossing speed
      expect(p.position).toEqual(expected);
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

  it('keeps every pick inside the fence on a landscape (desktop) arena, which has no red zone', () => {
    const rng = createRng(5);
    const desktopArena = { width: DESKTOP_ARENA_WIDTH, height: DESKTOP_ARENA_HEIGHT };
    const from = { x: desktopArena.width / 2, y: desktopArena.height / 2 };
    expect(getRedZoneInsets(desktopArena)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    const fence = getFenceInsets(desktopArena);
    const EPSILON = 1e-6;
    const near = 60; // within this of a wall counts as having reached it
    const reached = { left: false, right: false, top: false, bottom: false };
    for (let i = 0; i < 400; i++) {
      const wp = pickWanderWaypoint(rng, desktopArena, from);
      expect(wp.x).toBeGreaterThanOrEqual(fence.left + ARENA_PADDING - EPSILON);
      expect(wp.x).toBeLessThanOrEqual(desktopArena.width - fence.right - ARENA_PADDING + EPSILON);
      expect(wp.y).toBeGreaterThanOrEqual(Math.max(ARENA_TOP_PADDING, fence.top + ARENA_PADDING) - EPSILON);
      expect(wp.y).toBeLessThanOrEqual(desktopArena.height - fence.bottom - ARENA_PADDING + EPSILON);
      if (wp.x < fence.left + ARENA_PADDING + near) reached.left = true;
      if (wp.x > desktopArena.width - fence.right - ARENA_PADDING - near) reached.right = true;
      if (wp.y < Math.max(ARENA_TOP_PADDING, fence.top + ARENA_PADDING) + near) reached.top = true;
      if (wp.y > desktopArena.height - fence.bottom - ARENA_PADDING - near) reached.bottom = true;
    }
    // Confirms the bounds above aren't just loosely true — picks really do
    // use the whole fenced-in area right up to each wall.
    expect(reached).toEqual({ left: true, right: true, top: true, bottom: true });
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

  it('leans toward open space when given everyone else\'s positions, without ever ignoring the distance window', () => {
    // A crowd parked in the top third of the arena: legs picked with that
    // crowd in view should land in the emptier bottom half far more often
    // than not, and every pick still has to be a real trek away from `from`.
    const rng = createRng(11);
    const from = { x: 450, y: 700 };
    const crowd = Array.from({ length: 8 }, (_, i) => ({ x: 200 + i * 60, y: 450 + (i % 3) * 40 }));
    const trials = 300;
    let landedInEmptierHalf = 0;
    let outsideWindow = 0;
    for (let i = 0; i < trials; i++) {
      const wp = pickWanderWaypoint(rng, arena, from, undefined, crowd);
      const d = distance(from, wp);
      if (d < 400 - 1e-6 || d > 900 + 1e-6) outsideWindow++;
      if (wp.y > arena.height / 2) landedInEmptierHalf++;
    }
    // Only the every-draw-rejected fallback can land outside the window —
    // from this spot roughly half the arena is acceptable, so a dozen
    // straight misses is a once-in-a-thousand event, not a pattern.
    expect(outsideWindow / trials).toBeLessThan(0.01);
    // From y=700, roughly half the acceptable ring is above the midline and
    // half below — with no crowd in view that'd be ~50/50. With the crowd
    // sitting on the upper half's side, the open-space preference should
    // tip it decisively.
    expect(landedInEmptierHalf / trials).toBeGreaterThan(0.85);
  });

  it('turns at least WANDER_TURN_AWAY_MIN_RAD off the heading it was blocked on when one is given', () => {
    const rng = createRng(9);
    const from = { x: 450, y: 975 };
    const blockedHeading = { x: 1, y: 0 }; // was walking due east into something
    const trials = 300;
    let tooCloseToBlocked = 0;
    for (let i = 0; i < trials; i++) {
      const wp = pickWanderWaypoint(rng, arena, from, blockedHeading);
      const angle = Math.atan2(wp.y - from.y, wp.x - from.x); // 0 = east
      if (Math.abs(angle) < WANDER_TURN_AWAY_MIN_RAD - 1e-9) tooCloseToBlocked++;
    }
    // Only the out-of-attempts fallback (a clamped candidate whose direction
    // shifted in the clamp) could ever land inside the cone — vanishingly
    // rare from the open middle of the arena.
    expect(tooCloseToBlocked / trials).toBeLessThan(0.01);
  });
});

describe('trackWanderHeadway', () => {
  const waypoint = { x: 1000, y: 500 };
  const seekSpeed = WANDER_SPEED;

  function wanderer(x: number, y: number): PokemonInstance {
    const p = makeCollider('w', x, y, 40);
    p.wanderWaypoint = { ...waypoint };
    return p;
  }

  it('keeps the waypoint while real headway is being made, even if a shove knocked it partly off course', () => {
    const p = wanderer(500, 500);
    const tickStart = { x: 500, y: 500 };
    // A full tick's walk east, plus a sideways shove from a neighbor.
    p.position = { x: 500 + WANDER_SPEED * (TICK_MS / 1000), y: 500 + 30 };
    expect(trackWanderHeadway(p, tickStart, seekSpeed, TICK_MS)).toBeNull();
    expect(p.wanderWaypoint).toEqual(waypoint);
    expect(p.wanderStuckMs).toBe(0);
  });

  it('abandons the waypoint only after WANDER_STUCK_REPICK_MS of getting nowhere, reporting the blocked heading', () => {
    const p = wanderer(500, 500);
    const pinned = { x: 500, y: 500 };
    const ticksToGiveUp = Math.ceil(WANDER_STUCK_REPICK_MS / TICK_MS);
    for (let i = 0; i < ticksToGiveUp - 1; i++) {
      expect(trackWanderHeadway(p, pinned, seekSpeed, TICK_MS)).toBeNull();
      expect(p.wanderWaypoint).toEqual(waypoint); // still committed
    }
    const blocked = trackWanderHeadway(p, pinned, seekSpeed, TICK_MS);
    expect(blocked).not.toBeNull();
    expect(blocked!.x).toBeCloseTo(1, 6); // unit vector toward where it was trying to go
    expect(blocked!.y).toBeCloseTo(0, 6);
    expect(p.wanderWaypoint).toBeUndefined();
    expect(p.wanderStuckMs).toBe(0);
  });

  it('resets the stuck clock the moment headway resumes, so brief bumps never add up to a give-up', () => {
    const p = wanderer(500, 500);
    const pinned = { x: 500, y: 500 };
    const almost = Math.ceil(WANDER_STUCK_REPICK_MS / TICK_MS) - 1;
    for (let i = 0; i < almost; i++) trackWanderHeadway(p, pinned, seekSpeed, TICK_MS);
    expect(p.wanderStuckMs).toBeGreaterThan(0);
    // One clean tick of progress...
    p.position = { x: 500 + WANDER_SPEED * (TICK_MS / 1000), y: 500 };
    expect(trackWanderHeadway(p, pinned, seekSpeed, TICK_MS)).toBeNull();
    expect(p.wanderStuckMs).toBe(0);
    // ...and it takes a whole fresh WANDER_STUCK_REPICK_MS of being pinned
    // again before it would give up.
    const nowPinned = { ...p.position };
    for (let i = 0; i < almost; i++) {
      expect(trackWanderHeadway(p, nowPinned, seekSpeed, TICK_MS)).toBeNull();
    }
    expect(p.wanderWaypoint).toEqual(waypoint);
  });

  it('does not mistake the deliberate arrival slowdown near the waypoint for being blocked', () => {
    // 20px out: steerToward halves the speed there, so a tick only covers
    // ~4.5px unobstructed — 2px of that must still count as headway.
    const p = wanderer(980, 500);
    const tickStart = { x: 980, y: 500 };
    p.position = { x: 982, y: 500 };
    expect(trackWanderHeadway(p, tickStart, seekSpeed, TICK_MS)).toBeNull();
    expect(p.wanderStuckMs).toBe(0);
  });

  it('is a no-op (and clears the stuck clock) when there is no waypoint to judge against', () => {
    const p = makeCollider('w', 500, 500, 40);
    p.wanderStuckMs = 300;
    expect(trackWanderHeadway(p, { x: 500, y: 500 }, seekSpeed, TICK_MS)).toBeNull();
    expect(p.wanderStuckMs).toBe(0);
  });
});
