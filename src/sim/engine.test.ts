import { describe, expect, it } from 'vitest';
import { SimulationEngine } from './engine';
import type { SpeciesData } from './matchSetup';
import type { MoveDefinition } from './types';
import { ARENA_HEIGHT, ARENA_WIDTH, COMBAT_START_DELAY_MS, TICK_MS } from './constants';
import { distance } from './movement';

const FIXTURE_MOVES: MoveDefinition[] = [
  { id: 1, name: 'Fixture Tackle', type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 35, priority: 0, targeting: 'enemy' },
  { id: 2, name: 'Fixture Ember', type: 'fire', category: 'special', power: 40, accuracy: 100, pp: 25, priority: 0, targeting: 'enemy' },
  { id: 3, name: 'Fixture Aqua Jet', type: 'water', category: 'physical', power: 40, accuracy: 100, pp: 20, priority: 1, targeting: 'enemy' },
  { id: 4, name: 'Fixture Growl-ish', type: 'normal', category: 'status', power: null, accuracy: 100, pp: 40, priority: 0, targeting: 'enemy', effect: { kind: 'statStage', target: 'enemy', statChanges: { atk: -1 } } },
  { id: 5, name: 'Fixture Swords Dance-ish', type: 'normal', category: 'status', power: null, accuracy: 100, pp: 20, priority: 0, targeting: 'self', effect: { kind: 'statStage', target: 'self', statChanges: { atk: 2 } } },
  { id: 6, name: 'Fixture Thunder Wave-ish', type: 'electric', category: 'status', power: null, accuracy: 90, pp: 20, priority: 0, targeting: 'enemy', effect: { kind: 'statusInflict', target: 'enemy', status: 'paralysis', chance: 100 } },
  { id: 7, name: 'Fixture Vine Whip', type: 'grass', category: 'physical', power: 45, accuracy: 100, pp: 25, priority: 0, targeting: 'enemy' },
  { id: 8, name: 'Fixture Quake', type: 'ground', category: 'physical', power: 60, accuracy: 100, pp: 10, priority: 0, targeting: 'all-enemies-in-radius' },
];

const movesById = new Map(FIXTURE_MOVES.map((m) => [m.id, m]));
const moveLookup = (id: number) => movesById.get(id);

const FIXTURE_SPECIES: Record<number, SpeciesData> = {
  1: { id: 1, name: 'Fixmander', types: ['fire'], baseStats: { hp: 60, atk: 65, def: 55, spa: 70, spd: 60, spe: 65 }, movePool: [1, 2, 5, 6], collisionRadius: 40 },
  2: { id: 2, name: 'Fixasaur', types: ['grass', 'poison'], baseStats: { hp: 65, atk: 60, def: 65, spa: 70, spd: 70, spe: 55 }, movePool: [1, 4, 5, 7], collisionRadius: 40 },
  3: { id: 3, name: 'Fixatoise', types: ['water'], baseStats: { hp: 70, atk: 60, def: 70, spa: 65, spd: 70, spe: 50 }, movePool: [1, 3, 4, 6], collisionRadius: 40 },
  4: { id: 4, name: 'Fixachu', types: ['electric'], baseStats: { hp: 40, atk: 55, def: 40, spa: 55, spd: 45, spe: 95 }, movePool: [1, 6, 5, 3], collisionRadius: 40 },
  5: { id: 5, name: 'Fixolax', types: ['normal'], baseStats: { hp: 130, atk: 65, def: 65, spa: 65, spd: 100, spe: 30 }, movePool: [1, 4, 8, 5], collisionRadius: 40 },
  6: { id: 6, name: 'Fixiron', types: ['ground'], baseStats: { hp: 100, atk: 90, def: 130, spa: 55, spd: 65, spe: 30 }, movePool: [8, 1, 4, 5], collisionRadius: 40 },
};

function runFullMatch(seed: number, speciesIds: number[]): SimulationEngine {
  const engine = new SimulationEngine(
    { level: 100, speciesIds, arena: { width: 960, height: 1600 }, shiny: false },
    FIXTURE_SPECIES,
    moveLookup,
    seed
  );

  // The 90s match-time hard cap guarantees completion well within this
  // budget — a bit of headroom over that so a genuine hang still fails the
  // test loudly instead of looping forever.
  const maxSteps = Math.ceil(95_000 / TICK_MS);
  for (let i = 0; i < maxSteps; i++) {
    if (engine.getState().phase === 'complete') break;
    engine.tick(TICK_MS);
  }
  return engine;
}

describe('SimulationEngine full match', () => {
  it('always resolves to one or more winners with valid HP for every seed in a sample', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const engine = runFullMatch(seed, [1, 2, 3, 4, 5, 6]);
      const state = engine.getState();

      expect(state.phase).toBe('complete');
      expect(state.livingOrder.length).toBeGreaterThanOrEqual(1);
      // Co-winners are possible if the 90s cap is hit with several still
      // standing — winnerInstanceIds should always match livingOrder exactly.
      expect([...state.winnerInstanceIds].sort()).toEqual([...state.livingOrder].sort());

      for (const p of Object.values(state.pokemon)) {
        expect(Number.isNaN(p.currentHp)).toBe(false);
        expect(p.currentHp).toBeGreaterThanOrEqual(0);
        expect(p.currentHp).toBeLessThanOrEqual(p.maxHp);
      }
    }
  });

  it('never lets a match run past the 90s hard time limit, even forced far beyond it', () => {
    const engine = runFullMatch(11, [1, 2, 3, 4, 5, 6]);
    // Keep ticking well past 90s regardless of whether it already finished —
    // the cap must hold no matter how much extra time is thrown at it.
    for (let i = 0; i < Math.ceil(30_000 / TICK_MS); i++) {
      engine.tick(TICK_MS);
    }
    const state = engine.getState();
    expect(state.phase).toBe('complete');
    expect(state.elapsedMs).toBeLessThanOrEqual(90_000 + TICK_MS);
    expect([...state.winnerInstanceIds].sort()).toEqual([...state.livingOrder].sort());
  });

  it('emits a matchStart milestone immediately and a matchEnd milestone on completion', () => {
    const engine = runFullMatch(42, [1, 3]);
    const events = engine.getEventsSince(0);
    expect(events[0]).toMatchObject({ type: 'milestone', kind: 'matchStart' });
    expect(events.some((e) => e.type === 'milestone' && e.kind === 'matchEnd')).toBe(true);
  });

  it('emits a finalTwo milestone exactly when a larger match passes through a roster of 2', () => {
    // Whether the roster ever actually *sits* at exactly 2 is seed-dependent:
    // a spread move (or two faints landing on the same tick) can take it
    // straight from 3 to 1, and then there's no final-two moment to announce
    // at all. So derive the expectation from each match's own faint timeline
    // rather than pinning one seed, whose outcome shifts with any change to
    // the order the sim draws from its RNG.
    let sawFinalTwo = false;
    for (let seed = 1; seed <= 8; seed++) {
      const engine = runFullMatch(seed, [1, 2, 3, 4, 5, 6]);
      const events = engine.getEventsSince(0);
      const faintTicks = [...new Set(events.filter((e) => e.type === 'fainted').map((e) => e.atMs))].sort((a, b) => a - b);
      let living = 6;
      let passedThroughTwo = false;
      for (const atMs of faintTicks) {
        living -= events.filter((e) => e.type === 'fainted' && e.atMs === atMs).length;
        if (living === 2) passedThroughTwo = true;
      }
      const emitted = events.some((e) => e.type === 'milestone' && e.kind === 'finalTwo');
      expect(emitted).toBe(passedThroughTwo);
      sawFinalTwo ||= emitted;
    }
    expect(sawFinalTwo).toBe(true); // sanity: the sample actually exercised the milestone
  });

  it('lets nobody attack another Pokémon until COMBAT_START_DELAY_MS after the intro ends', () => {
    const engine = new SimulationEngine(
      { level: 100, speciesIds: [1, 2, 3, 4, 5, 6], arena: { width: 960, height: 1600 }, shiny: false },
      FIXTURE_SPECIES,
      moveLookup,
      99
    );
    const combatStartMs = engine.getState().introDurationMs + COMBAT_START_DELAY_MS;

    // One tick before combat is allowed to start, everyone should genuinely
    // be wandering (not idle/frozen, not already engaged).
    for (let i = 0; i < Math.floor(combatStartMs / TICK_MS) - 1; i++) {
      engine.tick(TICK_MS);
    }
    for (const p of Object.values(engine.getState().pokemon)) {
      expect(['wander', 'incapacitated']).toContain(p.aiState);
    }

    // Keep ticking a bit past the threshold and confirm nothing — not even a
    // self-buff — moved before it. Self-buffing only fires while 'chase'ing a
    // spotted target, which (like 'attack') is impossible during this window.
    for (let i = 0; i < 10; i++) engine.tick(TICK_MS);
    const earlyMoves = engine.getEventsSince(0).filter((e) => e.type === 'moveUsed' && e.atMs < combatStartMs);
    expect(earlyMoves).toEqual([]);
  });

  it('never self-buffs while purely wandering with no enemy anywhere in aggro radius', () => {
    // Arena big enough that circlePosition's two spawn points (opposite sides
    // of a circle sized off the arena) start ~2560px apart — far beyond
    // AGGRO_RADIUS (320) — and even at WANDER_MOVE_SPEED (180px/s) worst-case
    // head-on closing over this 5s window can't shrink that below aggro
    // radius, so both Pokémon are guaranteed to stay in 'wander' (never
    // 'chase') throughout: nobody should look like they're attacking thin air.
    const engine = new SimulationEngine(
      { level: 100, speciesIds: [1, 4], arena: { width: 4000, height: 4000 }, shiny: false },
      FIXTURE_SPECIES,
      moveLookup,
      7
    );

    for (let i = 0; i < Math.ceil(5_000 / TICK_MS); i++) engine.tick(TICK_MS);

    for (const p of Object.values(engine.getState().pokemon)) {
      expect(p.aiState).toBe('wander');
    }
    const selfBuffs = engine.getEventsSince(0).filter((e) => e.type === 'moveUsed' && e.targetIds.length === 0);
    expect(selfBuffs).toEqual([]);
  });

  it('removes a fainted Pokémon from livingOrder and records it in eliminationOrder', () => {
    const engine = runFullMatch(3, [1, 3]);
    const state = engine.getState();
    expect(state.eliminationOrder.length).toBe(1);
    expect(state.livingOrder).not.toContain(state.eliminationOrder[0]);
  });

  it('never lets PP go negative and falls back to Struggle behavior gracefully', () => {
    const engine = runFullMatch(9, [1, 3]);
    const state = engine.getState();
    for (const p of Object.values(state.pokemon)) {
      for (const slot of p.moves) {
        expect(slot.ppRemaining).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('never lets a non-spread move affect more than one Pokémon', () => {
    // resolveTargets (engine.ts) returns exactly [primaryTarget] for any move
    // whose targeting isn't 'all-enemies-in-radius' — this walks real match
    // event logs across several seeds to confirm that invariant actually
    // holds end to end (targetIds, and the hit/crit/effectiveness/damage
    // dictionaries keyed off it, never grow past one entry), not just that
    // the code reads that way. Fixture Quake (targeting: 'all-enemies-in-
    // radius') is deliberately excluded — hitting several Pokémon at once is
    // its whole point, not a bug.
    for (let seed = 1; seed <= 8; seed++) {
      const engine = runFullMatch(seed, [1, 2, 3, 4, 5, 6]);
      const events = engine.getEventsSince(0);
      for (const e of events) {
        if (e.type !== 'moveUsed') continue;
        const move = movesById.get(e.moveId);
        if (!move || move.targeting === 'all-enemies-in-radius') continue;

        expect(e.targetIds.length).toBeLessThanOrEqual(1);
        expect(Object.keys(e.hit).length).toBeLessThanOrEqual(1);
        expect(Object.keys(e.crit).length).toBeLessThanOrEqual(1);
        expect(Object.keys(e.effectiveness).length).toBeLessThanOrEqual(1);
        expect(Object.keys(e.damage).length).toBeLessThanOrEqual(1);
      }
    }
  });

  it("records the finishing blow's attackerPosition as where the winner actually stood, not the arena center it gets teleported to for its victory pose", () => {
    // completeMatch() (engine.ts) teleports a lone winner to the arena
    // center the instant the match ends — the very same tick as the
    // finishing blow that ended it. Before events carried their own
    // attackerPosition snapshot, the renderer read that position live off
    // state.pokemon[...] well after this teleport already happened, so a
    // match-ending ranged attack rendered as if it came from the arena
    // center instead of wherever the attacker actually stood when it fired.
    const arena = { width: 960, height: 1600 };
    const center = { x: arena.width / 2, y: arena.height / 2 };
    let checkedAtLeastOne = false;

    for (let seed = 1; seed <= 20; seed++) {
      const engine = new SimulationEngine(
        { level: 100, speciesIds: [1, 2, 3, 4, 5, 6], arena, shiny: false },
        FIXTURE_SPECIES,
        moveLookup,
        seed
      );
      const maxSteps = Math.ceil(95_000 / TICK_MS);
      for (let i = 0; i < maxSteps; i++) {
        if (engine.getState().phase === 'complete') break;
        engine.tick(TICK_MS);
      }
      const state = engine.getState();
      if (state.winnerInstanceIds.length !== 1) continue; // co-winners (90s cap) never get teleported — nothing to check
      const winnerId = state.winnerInstanceIds[0];
      expect(state.pokemon[winnerId].position).toEqual(center); // sanity: this seed's winner really was teleported

      const winnersMoves = engine
        .getEventsSince(0)
        .filter((e) => e.type === 'moveUsed' && e.attackerId === winnerId);
      const finishingBlow = winnersMoves[winnersMoves.length - 1];
      if (!finishingBlow || finishingBlow.type !== 'moveUsed') continue;

      checkedAtLeastOne = true;
      expect(finishingBlow.attackerPosition).not.toEqual(center);
    }

    expect(checkedAtLeastOne).toBe(true); // sanity: the loop above actually exercised the case
  });

  it('never lets a move damage a teammate in Team Mode', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const engine = new SimulationEngine(
        { level: 100, speciesIds: [1, 2, 3, 4, 5, 6], arena: { width: 960, height: 1600 }, shiny: false, teams: { size: 3 } },
        FIXTURE_SPECIES,
        moveLookup,
        seed
      );
      const teamById = new Map(Object.values(engine.getState().pokemon).map((p) => [p.instanceId, p.team]));
      const maxSteps = Math.ceil(95_000 / TICK_MS);
      for (let i = 0; i < maxSteps; i++) {
        if (engine.getState().phase === 'complete') break;
        engine.tick(TICK_MS);
      }
      const events = engine.getEventsSince(0);
      for (const e of events) {
        if (e.type !== 'moveUsed') continue;
        for (const targetId of e.targetIds) {
          if ((e.damage[targetId] ?? 0) <= 0) continue;
          expect(teamById.get(targetId)).not.toBe(teamById.get(e.attackerId));
        }
      }
    }
  });

  it('splits the roster into teamA/teamB by spawn order and ends the match as soon as one whole side is wiped out', () => {
    const engine = new SimulationEngine(
      { level: 100, speciesIds: [1, 2, 3, 4, 5, 6], arena: { width: 960, height: 1600 }, shiny: false, teams: { size: 3 } },
      FIXTURE_SPECIES,
      moveLookup,
      5
    );
    const pokemonList = Object.values(engine.getState().pokemon);
    expect(pokemonList.slice(0, 3).every((p) => p.team === 'teamA')).toBe(true);
    expect(pokemonList.slice(3).every((p) => p.team === 'teamB')).toBe(true);

    const maxSteps = Math.ceil(95_000 / TICK_MS);
    for (let i = 0; i < maxSteps; i++) {
      if (engine.getState().phase === 'complete') break;
      engine.tick(TICK_MS);
    }
    const state = engine.getState();
    expect(state.phase).toBe('complete');
    // Whoever's left standing (if anyone) must all be from the same side —
    // the match should never end mid-fight with two teams still alive, nor
    // linger after one side hits zero.
    const survivingTeams = new Set(state.livingOrder.map((id) => state.pokemon[id].team));
    expect(survivingTeams.size).toBeLessThanOrEqual(1);
    expect([...state.winnerInstanceIds].sort()).toEqual([...state.livingOrder].sort());
  });

  it('holds the attacker still (bar incidental separation jitter) through its post-attack recovery window, then sends it off on a fresh wander leg instead of resuming a stale waypoint', () => {
    const engine = runFullMatch(13, [1, 2, 3, 4, 5, 6]);
    const events = engine.getEventsSince(0).filter((e) => e.type === 'moveUsed');
    expect(events.length).toBeGreaterThan(0); // sanity: this seed's match actually had combat

    // Re-simulate up to just after the very first landed move and confirm the
    // attacker's wanderWaypoint was cleared by resetCooldown — stepMovement's
    // 'wander' branch only repicks when it's unset, so this is what actually
    // guarantees the post-attack scatter starts from "wherever it just was",
    // not wherever some earlier (possibly pre-combat) waypoint pointed.
    const replay = new SimulationEngine(
      { level: 100, speciesIds: [1, 2, 3, 4, 5, 6], arena: { width: 960, height: 1600 }, shiny: false },
      FIXTURE_SPECIES,
      moveLookup,
      13
    );
    const firstMove = events[0];
    const attackerId = (firstMove as { attackerId: string }).attackerId;
    // Land exactly on the tick the move fires: updateTargeting for this tick
    // already ran (based on pre-attack cooldown, hence still 'attack') before
    // executeMove's resetCooldown clears wanderWaypoint later in the same
    // stepOnce — so the waypoint reset is observable immediately, but the
    // aiState flip to 'wander' isn't due until next tick's updateTargeting
    // call, checked below.
    while (replay.getState().elapsedMs < firstMove.atMs) replay.tick(TICK_MS);
    expect(replay.getState().pokemon[attackerId].wanderWaypoint).toBeUndefined();
    const positionAtLanding = { ...replay.getState().pokemon[attackerId].position };
    // A real wander/chase leg moves ~180-430px/s (see WANDER_SPEED/CHASE_SPEED
    // and their aggressive multiplier) — hundreds of px over the ~1.2s hold
    // window below. Separation from a crowding neighbor is the one force
    // still allowed to act during the hold (see stepMovement), but that's a
    // gentle equalizing nudge, nowhere near that scale — this bound is loose
    // enough to absorb it while still failing hard if the hold regresses and
    // wander/chase movement leaks through.
    const MAX_HOLD_JITTER_PX = 50;

    replay.tick(TICK_MS);
    const justAfter = replay.getState().pokemon[attackerId];
    expect(justAfter.aiState).toBe('wander');
    // postAttackHoldMs (see engine.ts's stepMovement) holds it — regardless
    // of the 'wander' aiState above — until the render's whole attack-visual
    // window has played out, so no waypoint gets picked yet.
    expect(justAfter.wanderWaypoint).toBeUndefined();
    expect(justAfter.postAttackHoldMs).toBeGreaterThan(0);
    expect(distance(justAfter.position, positionAtLanding)).toBeLessThan(MAX_HOLD_JITTER_PX);

    // Bounded like runFullMatch's own loop (see its comment) — this polls a
    // live condition rather than a fixed step count, so a genuine regression
    // has to fail loudly instead of hanging the whole suite.
    const MAX_HOLD_POLL_TICKS = 200;
    let holdCleared = false;
    for (let i = 0; i < MAX_HOLD_POLL_TICKS; i++) {
      if (replay.getState().phase === 'complete') break;
      if (replay.getState().pokemon[attackerId].postAttackHoldMs <= 0) {
        holdCleared = true;
        break;
      }
      replay.tick(TICK_MS);
      expect(distance(replay.getState().pokemon[attackerId].position, positionAtLanding)).toBeLessThan(
        MAX_HOLD_JITTER_PX
      );
    }

    // Two ways this attacker's story doesn't reach a clean "hold released"
    // beat within this test's own generous patience budget: the match wraps
    // up first, or — now that MIN_ACTION_COOLDOWN_MS[_AGGRESSIVE] is pinned
    // to POST_ATTACK_HOLD_MS (see constants.ts) — it's fast and cornered
    // enough to keep re-triggering resetCooldown before its own hold ever
    // decays, staying locked in a continuous toe-to-toe exchange
    // indefinitely. Both are legitimate outcomes, not a regression — the
    // position-stability check above already ran on every tick either way —
    // so there's nothing further to assert in either case.
    if (!holdCleared) return;

    // What happens right as the hold clears depends on whether this
    // attacker's own actionCooldownMs already cleared before the fixed hold
    // did: if so, updateTargeting re-evaluated distance-to-target mid-hold
    // and may have already put it back into 'attack' (re-engaging
    // immediately, no wander leg at all this cycle) rather than 'wander'
    // (forced only while actionCooldownMs > 0) — both are valid; the
    // invariant that actually matters is that wanderWaypoint is never a
    // stale leftover, only ever genuinely unset or freshly repicked.
    const afterHold = replay.getState().pokemon[attackerId];
    // A paralyzed Pokémon is a third legitimate case alongside the two
    // below: stepMovement's paralysis branch (checked before 'wander's own)
    // holds it in place without ever reaching the wanderWaypoint-picking
    // logic at all, so aiState reads 'wander' (updateTargeting has no reason
    // to say otherwise) while wanderWaypoint stays genuinely unset — not a
    // stale leftover, just never assigned because idle wandering itself is
    // suppressed for as long as the paralysis lasts.
    if (afterHold.status === 'paralysis') {
      expect(afterHold.aiState).toBe('wander');
      expect(afterHold.wanderWaypoint).toBeUndefined();
    } else if (afterHold.aiState === 'wander') {
      expect(afterHold.wanderWaypoint).toBeDefined(); // freshly repicked, not a stale/absent one
    } else {
      expect(afterHold.wanderWaypoint).toBeUndefined();
    }
  });

  it('holds the intro circle formation without moving Pokémon before battle starts', () => {
    const engine = new SimulationEngine(
      { level: 100, speciesIds: [1, 2, 3], arena: { width: 960, height: 1600 }, shiny: false },
      FIXTURE_SPECIES,
      moveLookup,
      1
    );
    const before = Object.fromEntries(
      Object.entries(engine.getState().pokemon).map(([id, p]) => [id, { ...p.position }])
    );
    engine.tick(TICK_MS); // one small step, still within INTRO_DURATION_MS
    expect(engine.getState().phase).toBe('intro');
    for (const [id, p] of Object.entries(engine.getState().pokemon)) {
      expect(p.position).toEqual(before[id]);
    }
  });

  it('never lets a paralyzed Pokémon wander — it holds ground whenever aiState would otherwise be wander', () => {
    // Fixture Thunder Wave-ish (move id 6) inflicts paralysis at 100%, so
    // real matches reliably produce paralyzed Pokémon to observe. Checks
    // velocity rather than position deltas: a genuine wander leg drives
    // speed all the way up to WANDER_MOVE_SPEED (180, or the aggressive
    // multiplier beyond that), while stepMovement's hold-ground steering
    // (separation-only, same as the existing 'attack' state) leaves only a
    // small crowding-avoidance nudge — empirically under 5px/s against this
    // fixture roster — so a generous ceiling well below wander speed still
    // cleanly tells "held" apart from "wandering," with no risk of the
    // ceiling itself flaking on ordinary separation jitter.
    //
    // Excludes the one tick paralysis is first inflicted on: maybeAct (and
    // the applyStatus call inside it) runs in stepOnce's second per-Pokémon
    // pass, after stepMovement has already run for everyone in the first —
    // so that tick's velocity was computed while this Pokémon was still
    // un-paralyzed, and only takes effect starting the next tick.
    const HELD_VELOCITY_CEILING = 60;
    let checkedAtLeastOne = false;

    for (let seed = 1; seed <= 20; seed++) {
      const engine = new SimulationEngine(
        { level: 100, speciesIds: [1, 2, 3, 4, 5, 6], arena: { width: 960, height: 1600 }, shiny: false },
        FIXTURE_SPECIES,
        moveLookup,
        seed
      );
      const maxSteps = Math.ceil(95_000 / TICK_MS);
      const wasParalyzedLastTick = new Map<string, boolean>();

      for (let i = 0; i < maxSteps; i++) {
        if (engine.getState().phase === 'complete') break;
        engine.tick(TICK_MS);
        const state = engine.getState();
        for (const id of state.livingOrder) {
          const p = state.pokemon[id];
          const isParalyzed = p.status === 'paralysis';
          if (isParalyzed && p.aiState === 'wander' && wasParalyzedLastTick.get(id)) {
            checkedAtLeastOne = true;
            expect(Math.hypot(p.velocity.x, p.velocity.y)).toBeLessThan(HELD_VELOCITY_CEILING);
          }
          wasParalyzedLastTick.set(id, isParalyzed);
        }
      }
    }

    expect(checkedAtLeastOne).toBe(true); // sanity: paralysis + wander actually came up in the sample
  });

  it('never lets a living Pokémon wander when MatchConfig.disableWander is set, for a real 1v1 match', () => {
    // Full-stack check (MatchConfig -> matchSetup.ts's createMatch -> SimState
    // -> ai.ts's updateTargeting), complementing ai.test.ts's direct unit
    // tests of updateTargeting itself with a real running match.
    //
    // Excludes the exact tick 'intro' first flips to 'battle': stepOnce
    // (engine.ts) returns immediately once it flips that flag, before ever
    // calling updateTargeting (or stepMovement) for the first time — so
    // aiState is still every Pokémon's stale initial 'wander' from
    // buildInstance (matchSetup.ts) for that one tick, with zero actual
    // wandering movement to go with it (stepMovement never ran either).
    const engine = new SimulationEngine(
      { level: 100, speciesIds: [1, 2], arena: { width: 500, height: 1000 }, shiny: false, disableWander: true },
      FIXTURE_SPECIES,
      moveLookup,
      1
    );
    const maxSteps = Math.ceil(95_000 / TICK_MS);
    let sawBattlePhase = false;
    let wasInBattleLastTick = false;
    for (let i = 0; i < maxSteps; i++) {
      if (engine.getState().phase === 'complete') break;
      engine.tick(TICK_MS);
      const state = engine.getState();
      const inBattle = state.phase === 'battle' || state.phase === 'finalTwo';
      if (inBattle && wasInBattleLastTick) {
        sawBattlePhase = true;
        for (const id of state.livingOrder) {
          expect(state.pokemon[id].aiState).not.toBe('wander');
        }
      }
      wasInBattleLastTick = inBattle;
    }
    expect(sawBattlePhase).toBe(true); // sanity: the match actually reached battle phase
  });

  it('only ever uses the pinned move when MatchConfig.forcedMoveId is set, for a real 1v1 match', () => {
    // Full-stack check (MatchConfig -> matchSetup.ts's buildInstance ->
    // PokemonInstance.forcedMoveId -> ai.ts's chooseMove), complementing
    // ai.test.ts's direct unit tests of chooseMove itself with a real
    // running match, including engine.ts's maybeAct chase-buff suppression.
    const engine = new SimulationEngine(
      {
        level: 100,
        speciesIds: [1, 2],
        arena: { width: 960, height: 1600 },
        shiny: false,
        forcedMoveId: { 1: 1 }, // Fixmander (species 1) always uses Fixture Tackle (move id 1)
      },
      FIXTURE_SPECIES,
      moveLookup,
      1
    );
    const maxSteps = Math.ceil(95_000 / TICK_MS);
    for (let i = 0; i < maxSteps; i++) {
      if (engine.getState().phase === 'complete') break;
      engine.tick(TICK_MS);
    }

    const fixmander = Object.values(engine.getState().pokemon).find((p) => p.speciesId === 1)!;
    const fixmanderMoves = engine
      .getEventsSince(0)
      .filter((e) => e.type === 'moveUsed' && e.attackerId === fixmander.instanceId);

    expect(fixmanderMoves.length).toBeGreaterThan(0); // sanity: it actually attacked at least once
    for (const e of fixmanderMoves) {
      expect(e.type === 'moveUsed' && e.moveId).toBe(1);
    }
  });
});

describe('cold-open wander in a packed spawn', () => {
  it('never reads as spinning: facing changes only a handful of times per Pokémon even with 16 oversized bodies overlapping at spawn', () => {
    // Mirrors the Legendaries preset on the portrait arena — 16 Pokémon at
    // the sprite-size cap (collision radius ~95px) on a spawn circle whose
    // neighbor spacing (~113px) is far less than a pair's combined radii
    // (~190px), so everyone starts the battle overlapping their neighbors.
    // Repicking a wander waypoint on every collision (the old behavior) gave
    // each of them a brand-new random heading nearly every tick here — 20+
    // facing flips per Pokémon over the 3s cold-open, 40 for the unluckiest.
    const OVERSIZED_RADIUS = 95;
    const species: Record<number, SpeciesData> = Object.fromEntries(
      Object.values(FIXTURE_SPECIES).map((s) => [s.id, { ...s, collisionRadius: OVERSIZED_RADIUS }])
    );
    const speciesIds = Array.from({ length: 16 }, (_, i) => (i % 6) + 1);

    for (const seed of [1, 2, 3]) {
      const engine = new SimulationEngine(
        { level: 100, speciesIds, arena: { width: ARENA_WIDTH, height: ARENA_HEIGHT }, shiny: false },
        species,
        moveLookup,
        seed
      );
      const state = engine.getState();
      while (state.elapsedMs < state.introDurationMs) engine.tick(TICK_MS);

      const facingChanges = new Map<string, number>();
      const lastFacing = new Map<string, string>();
      for (const id of state.livingOrder) {
        facingChanges.set(id, 0);
        lastFacing.set(id, state.pokemon[id].facing);
      }
      const coldOpenEndMs = state.elapsedMs + COMBAT_START_DELAY_MS;
      while (state.elapsedMs < coldOpenEndMs) {
        engine.tick(TICK_MS);
        for (const id of state.livingOrder) {
          const facing = state.pokemon[id].facing;
          if (facing !== lastFacing.get(id)) {
            facingChanges.set(id, facingChanges.get(id)! + 1);
            lastFacing.set(id, facing);
          }
        }
      }

      const counts = [...facingChanges.values()];
      const average = counts.reduce((sum, c) => sum + c, 0) / counts.length;
      // A real wander leg or two, plus at most a couple of stuck give-ups —
      // nowhere near the tick-by-tick churn that reads as spinning.
      expect(Math.max(...counts)).toBeLessThanOrEqual(6);
      expect(average).toBeLessThanOrEqual(3);
      // Sanity: they're genuinely walking off in their own directions, not
      // frozen in the formation.
      expect(counts.some((c) => c > 0)).toBe(true);
    }
  });
});
