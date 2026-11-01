import { describe, expect, it } from 'vitest';
import { ActionEngine, type ActionEvent } from './ActionEngine';
import type { MatchConfig, PokemonInstance } from '../types';
import { MOVESET, SPECIES, lookup } from './testFixtures';
import * as R from './rules';
import { PlayerController } from './playerController';

function makeEngine(speciesIds: number[], extra: Partial<MatchConfig> = {}, bots = false): ActionEngine {
  const config: MatchConfig = { level: 50, speciesIds, arena: { width: 900, height: 1950 }, shiny: false, ...MOVESET, ...extra };
  const engine = new ActionEngine(config, SPECIES, lookup, 7, { bots });
  while (engine.getState().phase === 'intro') engine.tick(R.ACTION_TICK_MS);
  return engine;
}

function mon(engine: ActionEngine, index: number): PokemonInstance {
  const state = engine.getState();
  return state.pokemon[state.allInstanceIds[index]];
}

function place(p: PokemonInstance, x: number, y: number): void {
  p.position.x = x;
  p.position.y = y;
}

function run(engine: ActionEngine, ms: number): ActionEvent[] {
  const from = engine.getState().elapsedMs;
  const seqBefore = engine.getActionEventsSince(0).length;
  while (engine.getState().elapsedMs - from < ms && !engine.finished) engine.tick(R.ACTION_TICK_MS);
  return engine.getActionEventsSince(0).slice(seqBefore);
}

const SLOT = { ember: 0, tackle: 1, quake: 2, swords: 3 };

describe('Play Mode rules', () => {
  it('derives cooldown and energy cost from PP: more PP is faster and cheaper', () => {
    expect(R.moveCooldownMs(15)).toBe(1600);
    expect(R.moveEnergyCost(15)).toBe(13);
    expect(R.moveCooldownMs(35)).toBeLessThan(R.moveCooldownMs(5));
    expect(R.moveEnergyCost(35)).toBeLessThan(R.moveEnergyCost(5));
    expect(R.moveCooldownMs(1)).toBe(5000);
    expect(R.moveCooldownMs(64)).toBe(600);
  });
});

describe('ActionEngine', () => {
  it('starts everyone with boosted HP, full energy and 2 dash charges', () => {
    const engine = makeEngine([1, 2]);
    const p = mon(engine, 0);
    const f = engine.getFighter(p.instanceId);
    expect(p.maxHp % R.HP_MULTIPLIER).toBe(0);
    expect(p.currentHp).toBe(p.maxHp);
    expect(f.energy).toBe(R.ENERGY_MAX);
    expect(f.dashCharges).toBe(R.DASH_CHARGES);
  });

  it('accelerates up to the max speed, never past it, and glides to a stop', () => {
    const engine = makeEngine([1, 2]);
    const p = mon(engine, 0);
    place(p, 300, 900);
    engine.setMoveInput(p.instanceId, 1, 0);
    run(engine, 50);
    const early = Math.hypot(p.velocity.x, p.velocity.y);
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(R.MAX_SPEED);
    run(engine, 1000);
    expect(Math.hypot(p.velocity.x, p.velocity.y)).toBeCloseTo(R.MAX_SPEED, 0);
    engine.setMoveInput(p.instanceId, 0, 0);
    run(engine, 50);
    expect(Math.hypot(p.velocity.x, p.velocity.y)).toBeGreaterThan(R.WALK_THRESHOLD);
    run(engine, 1000);
    expect(Math.hypot(p.velocity.x, p.velocity.y)).toBeLessThan(R.WALK_THRESHOLD);
  });

  it('has two dash charges that refill one at a time', () => {
    const engine = makeEngine([1, 2]);
    const id = mon(engine, 0).instanceId;
    expect(engine.dash(id)).toBe(true);
    run(engine, R.DASH_MS + 20);
    expect(engine.dash(id)).toBe(true);
    run(engine, R.DASH_MS + 20);
    expect(engine.dash(id)).toBe(false);
    run(engine, R.DASH_RECHARGE_MS);
    expect(engine.getFighter(id).dashCharges).toBe(1);
  });

  it('fires a shot that always lands on an enemy in its path, paying energy and starting that slot’s cooldown', () => {
    const engine = makeEngine([1, 2]);
    const me = mon(engine, 0);
    const foe = mon(engine, 1);
    place(me, 450, 700);
    place(foe, 450, 1000);
    const before = foe.currentHp;
    // Fixture Ember is only 50% accurate in the data; aim is the accuracy check here.
    expect(engine.fire(me.instanceId, SLOT.ember, foe.position)).toBe(true);
    expect(engine.getFighter(me.instanceId).energy).toBe(R.ENERGY_MAX - R.moveEnergyCost(25));
    expect(engine.fire(me.instanceId, SLOT.ember, foe.position)).toBe(false);
    const events = run(engine, 1000);
    expect(events.some((e) => e.type === 'hit' && e.targetId === foe.instanceId)).toBe(true);
    expect(foe.currentHp).toBeLessThan(before);
    run(engine, R.moveCooldownMs(25));
    expect(engine.canFire(me.instanceId, SLOT.ember)).toBe(true);
  });

  it('misses an enemy that is not in the line of fire', () => {
    const engine = makeEngine([1, 2]);
    const me = mon(engine, 0);
    const foe = mon(engine, 1);
    place(me, 300, 700);
    place(foe, 600, 1000);
    engine.fire(me.instanceId, SLOT.ember, { x: 300, y: 1200 });
    expect(run(engine, 1200).some((e) => e.type === 'hit')).toBe(false);
  });

  it('lets a well-timed dash slip through a shot', () => {
    const engine = makeEngine([1, 2]);
    const me = mon(engine, 0);
    const foe = mon(engine, 1);
    place(me, 450, 700);
    place(foe, 450, 1050);
    engine.fire(me.instanceId, SLOT.ember, foe.position);
    while (engine.getProjectiles()[0] && foe.position.y - engine.getProjectiles()[0].position.y > 110) engine.tick(R.ACTION_TICK_MS);
    engine.setMoveInput(foe.instanceId, 1, 0);
    expect(engine.dash(foe.instanceId)).toBe(true);
    expect(run(engine, 1000).some((e) => e.type === 'hit')).toBe(false);
  });

  it('never hits a teammate, even one standing in the way', () => {
    const engine = makeEngine([1, 2, 3, 4], { teams: { size: 2 } });
    const me = mon(engine, 0);
    const mate = mon(engine, 1);
    const foe = mon(engine, 2);
    place(mon(engine, 3), 800, 1700);
    place(me, 450, 600);
    place(mate, 450, 800);
    place(foe, 450, 1000);
    engine.fire(me.instanceId, SLOT.ember, foe.position);
    const hits = run(engine, 1200).filter((e) => e.type === 'hit');
    expect(hits.map((e) => e.type === 'hit' && e.targetId)).toEqual([foe.instanceId]);
    expect(mate.currentHp).toBe(mate.maxHp);
  });

  it('bursts radius moves around the user', () => {
    const engine = makeEngine([1, 2, 3]);
    const me = mon(engine, 0);
    place(me, 450, 900);
    place(mon(engine, 1), 450, 1050);
    place(mon(engine, 2), 450, 1500);
    const before = engine.getActionEventsSince(0).length;
    engine.fire(me.instanceId, SLOT.quake, me.position);
    // A burst resolves inside fire() itself, not on a later tick.
    const hits = engine
      .getActionEventsSince(0)
      .slice(before)
      .filter((e) => e.type === 'hit');
    expect(hits.map((e) => e.type === 'hit' && e.targetId)).toEqual([mon(engine, 1).instanceId]);
  });

  it('takes a KO’d fighter out for good: no respawn, and the last side standing wins', () => {
    const engine = makeEngine([1, 2, 3, 4], { teams: { size: 2 } });
    const [a1, a2, b1, b2] = [0, 1, 2, 3].map((i) => mon(engine, i));
    b1.currentHp = 0;
    const ko = run(engine, 50).find((e) => e.type === 'ko');
    expect(ko).toMatchObject({ instanceId: b1.instanceId });
    run(engine, 10_000);
    expect(engine.isAlive(b1.instanceId)).toBe(false); // still out
    expect(engine.finished).toBe(false); // b2 still standing

    b2.currentHp = 0;
    run(engine, 50);
    expect(engine.finished).toBe(true);
    expect(engine.getState().winnerInstanceIds).toEqual([a1.instanceId, a2.instanceId]);
  });

  it('at the time limit, the side with more fighters standing wins', () => {
    const engine = makeEngine([1, 2, 3, 4], { teams: { size: 2 } });
    const [a1, a2, b1] = [0, 1, 2].map((i) => mon(engine, i));
    b1.currentHp = 0;
    run(engine, 50);
    engine.endMatchNow();
    expect(engine.getState().winnerInstanceIds).toEqual([a1.instanceId, a2.instanceId]);
  });

  it('heals a hurt fighter with a shop item, and revives a KO’d one (not one who left) at the item’s share of HP', () => {
    const engine = makeEngine([1, 2, 3, 4], { teams: { size: 2 } });
    const foe = mon(engine, 2);
    expect(engine.useItem(foe.instanceId, 'heal', 0.25, 'Brock')).toBeNull(); // already full
    foe.currentHp = foe.maxHp - 10;
    expect(engine.useItem(foe.instanceId, 'heal', 0.25, 'Brock')).toBe(10); // never past max
    expect(foe.currentHp).toBe(foe.maxHp);

    expect(engine.useItem(foe.instanceId, 'revive', 0.3, 'Brock')).toBeNull(); // not down
    foe.currentHp = 0;
    run(engine, 50);
    expect(engine.useItem(foe.instanceId, 'heal', 0.25, 'Brock')).toBeNull(); // can't heal the fainted
    expect(engine.useItem(foe.instanceId, 'revive', 0.3, 'Brock')).toBe(Math.round(foe.maxHp * 0.3));
    expect(engine.isAlive(foe.instanceId)).toBe(true);
    expect(foe.currentHp).toBe(Math.round(foe.maxHp * 0.3));
    expect(engine.getActionEventsSince(0).filter((e) => e.type === 'item')).toHaveLength(2);

    const quitter = mon(engine, 3);
    engine.eliminate(quitter.instanceId);
    run(engine, 50);
    expect(engine.isAlive(quitter.instanceId)).toBe(false);
    expect(engine.useItem(quitter.instanceId, 'revive', 0.3, 'Brock')).toBeNull(); // left the room
  });

  it('takes a player who leaves out at once, even during the intro', () => {
    const config: MatchConfig = { level: 50, speciesIds: [1, 2], arena: { width: 900, height: 1950 }, shiny: false, ...MOVESET };
    const engine = new ActionEngine(config, SPECIES, lookup, 7, { bots: false });
    const [me, foe] = engine.getState().allInstanceIds;
    engine.tick(R.ACTION_TICK_MS);
    expect(engine.getState().phase).toBe('intro');
    engine.eliminate(foe);
    expect(engine.isAlive(foe)).toBe(false);
    expect(engine.finished).toBe(true);
    expect(engine.getState().winnerInstanceIds).toEqual([me]);
  });

  it('never lets a potion, a bot or the time-limit score treat a player who just left as standing', () => {
    const engine = makeEngine([1, 2, 3, 4], { teams: { size: 2 } });
    const [a1, a2, b1, b2] = [0, 1, 2, 3].map((i) => mon(engine, i));
    for (const p of [b1, b2]) p.currentHp = 1;
    engine.eliminate(a1.instanceId);
    expect(engine.useItem(a1.instanceId, 'heal', 0.25, 'Brock')).toBeNull();
    expect(engine.enemiesOf(b1.instanceId).map((p) => p.instanceId)).toEqual([a2.instanceId]);
    // One of A standing at full HP against two of B at 1 HP: B has more standing.
    engine.endMatchNow();
    expect(engine.getState().winnerInstanceIds).toEqual([b1.instanceId, b2.instanceId]);
  });

  it('ends in a draw, with no winner, when the last fighters go down on the same tick', () => {
    const engine = makeEngine([1, 2]);
    mon(engine, 0).currentHp = 0;
    mon(engine, 1).currentHp = 0;
    run(engine, 50);
    expect(engine.finished).toBe(true);
    expect(engine.getState().winnerInstanceIds).toEqual([]);
  });

  it('turns an overflowing aim into a normal shot along the facing, not a frozen one that never expires', () => {
    const engine = makeEngine([1, 2]);
    const me = mon(engine, 0);
    place(me, 450, 900);
    place(mon(engine, 1), 100, 300);
    expect(engine.fire(me.instanceId, SLOT.ember, { x: 1.7e308, y: 1.7e308 })).toBe(true);
    const [shot] = engine.getProjectiles();
    expect(Math.hypot(shot.velocity.x, shot.velocity.y)).toBeCloseTo(R.PROJECTILE.ranged.speed, 0);
    run(engine, 2000);
    expect(engine.getProjectiles()).toHaveLength(0);
  });

  it('ignores a NaN or infinite move input instead of losing the fighter', () => {
    const engine = makeEngine([1, 2]);
    const me = mon(engine, 0);
    for (const [x, y] of [
      [NaN, 0],
      [Infinity, 1],
    ]) {
      engine.setMoveInput(me.instanceId, x, y);
      run(engine, 100);
      expect(Number.isFinite(me.position.x) && Number.isFinite(me.position.y)).toBe(true);
    }
  });

  it('refuses an item aimed at a prototype key', () => {
    const engine = makeEngine([1, 2]);
    for (const id of ['__proto__', 'constructor']) expect(engine.useItem(id, 'revive', 0.3, 'Brock')).toBeNull();
    expect(({} as { currentHp?: number }).currentHp).toBeUndefined();
  });

  it('sends a bot whose only ranged move is a status move in close enough to land its physical one', () => {
    // Fix2 knows Growl and Tackle: it has no damaging shot to hold back at range for.
    const engine = makeEngine([1, 2], { customMoves: { 1: [2, 1, 3, 4], 2: [5, 1] } }, true);
    const me = mon(engine, 0);
    place(me, 450, 975);
    const hits = run(engine, 15_000).filter((e) => e.type === 'hit' && e.targetId === me.instanceId && e.damage > 0);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('spends one movement budget across every report: walking pace, dash pace only after a dash, paralysis halves it', () => {
    const config: MatchConfig = { level: 50, speciesIds: [1, 2], arena: { width: 900, height: 1950 }, shiny: false, ...MOVESET };
    const moved = (status: PokemonInstance['status'], dash = false) => {
      const engine = new ActionEngine(config, SPECIES, lookup, 7, { bots: false, humanIds: ['p0-1', 'p1-2'], reportedMovement: true });
      while (engine.getState().phase === 'intro') engine.tick(R.ACTION_TICK_MS);
      const p = engine.getState().pokemon['p0-1'];
      p.status = status;
      place(p, 450, 400);
      if (dash) {
        engine.dash(p.instanceId);
        for (let t = 0; t < 12; t++) engine.tick(R.ACTION_TICK_MS); // the budget fills at dash pace for a few ticks
        place(p, 450, 400);
      }
      for (let i = 1; i <= 50; i++) engine.reportMovement(p.instanceId, { x: 450, y: 400 + i * 40 }, { x: 0, y: 0 }, 'S');
      return p.position.y - 400;
    };
    const walking = moved(null);
    expect(walking).toBeLessThanOrEqual(R.MAX_SPEED * 0.2 + 40); // a flood of reports can't outrun walking pace
    expect(moved(null, true)).toBeGreaterThan((R.DASH_SPEED * R.DASH_MS) / 1000); // but a real dash fits
    expect(moved('paralysis')).toBeLessThan(walking);
  });

  it('runs bot-filled matches to a clean finish', () => {
    for (const [ids, extra] of [
      [[1, 2], {}],
      [[1, 2, 3, 4, 5, 6, 7, 8], { teams: { size: 4 } }],
      [[1, 2, 3, 4, 5, 6, 7, 8], {}],
    ] as const) {
      const engine = makeEngine([...ids], extra, true);
      run(engine, R.ACTION_MATCH_LIMIT_MS + 1000);
      const state = engine.getState();
      expect(state.phase).toBe('complete');
      expect(state.winnerInstanceIds.length).toBeGreaterThan(0);
      for (const p of Object.values(state.pokemon)) {
        expect(Number.isFinite(p.position.x) && Number.isFinite(p.position.y)).toBe(true);
        expect(p.currentHp).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('PlayerController', () => {
  it('aims a drag first, then the lock-on target, then the mouse, then straight ahead', () => {
    const engine = makeEngine([1, 2, 3]);
    const me = mon(engine, 0);
    const near = mon(engine, 1);
    const far = mon(engine, 2);
    place(me, 450, 900);
    place(near, 450, 1100);
    place(far, 450, 400);
    const controller = new PlayerController(engine, true);
    controller.update();
    expect(controller.lockTargetId).toBe(near.instanceId);
    controller.mouseAim = { x: 100, y: 900 };
    expect(controller.aimPoint({ x: 1, y: 0 }).x).toBeGreaterThan(me.position.x);
    expect(controller.aimPoint()).toEqual(near.position);
    controller.toggleLock();
    expect(controller.aimPoint()).toEqual({ x: 100, y: 900 });
    controller.mouseAim = null;
    const ahead = controller.aimPoint();
    expect(Math.hypot(ahead.x - me.position.x, ahead.y - me.position.y)).toBeGreaterThan(0);
  });

  it('cycles the lock through enemies by distance and drops a target that leaves the field', () => {
    const engine = makeEngine([1, 2, 3]);
    place(mon(engine, 0), 450, 900);
    place(mon(engine, 1), 450, 1100);
    place(mon(engine, 2), 450, 400);
    const controller = new PlayerController(engine, false);
    controller.cycleTarget();
    expect(controller.lockOn).toBe(true);
    expect(controller.lockTargetId).toBe(mon(engine, 1).instanceId);
    controller.cycleTarget();
    expect(controller.lockTargetId).toBe(mon(engine, 2).instanceId);
    mon(engine, 2).currentHp = 0;
    run(engine, 50);
    controller.update();
    expect(controller.lockTargetId).toBe(mon(engine, 1).instanceId);
  });
});

describe('Crowd Calls', () => {
  const teamEngine = () => makeEngine([1, 2, 3, 4], { teams: { size: 2 } });

  it('shield eats the next hit whole, then is gone', () => {
    const engine = teamEngine();
    const me = mon(engine, 2);
    const foe = mon(engine, 0);
    place(me, 450, 700);
    place(foe, 450, 1000);
    place(mon(engine, 1), 100, 300);
    place(mon(engine, 3), 800, 300);
    engine.applyCrowdCard(foe.team, 'shield');
    expect(engine.getFighter(foe.instanceId).shieldMs).toBe(R.CROWD_SHIELD_MS);
    expect(engine.getFighter(mon(engine, 2).instanceId).shieldMs).toBe(0); // the other side gets nothing
    const before = foe.currentHp;
    engine.fire(me.instanceId, SLOT.ember, foe.position);
    const blocked = run(engine, 600).find((e) => e.type === 'hit');
    expect(blocked).toMatchObject({ damage: 0, blocked: true, knockback: { x: 0, y: 0 } });
    expect(foe.currentHp).toBe(before);
    expect(engine.getFighter(foe.instanceId).shieldMs).toBe(0);
    run(engine, R.moveCooldownMs(25));
    engine.fire(me.instanceId, SLOT.ember, foe.position);
    run(engine, 600);
    expect(foe.currentHp).toBeLessThan(before);
  });

  it('shield fades unused', () => {
    const engine = teamEngine();
    const p = mon(engine, 0);
    engine.applyCrowdCard(p.team, 'shield');
    run(engine, R.CROWD_SHIELD_MS + 50);
    expect(engine.getFighter(p.instanceId).shieldMs).toBe(0);
  });

  it('speed raises the max speed for a while, then it drops back', () => {
    const engine = teamEngine();
    const p = mon(engine, 0);
    place(p, 450, 300);
    engine.applyCrowdCard(p.team, 'speed');
    engine.setMoveInput(p.instanceId, 0, 1);
    run(engine, 1000);
    expect(Math.hypot(p.velocity.x, p.velocity.y)).toBeCloseTo(R.MAX_SPEED * R.CROWD_SPEED_MULT, 0);
    place(p, 450, 200);
    run(engine, R.CROWD_SPEED_MS - 500);
    expect(Math.hypot(p.velocity.x, p.velocity.y)).toBeCloseTo(R.MAX_SPEED, 0);
  });

  it('energy refills the whole side', () => {
    const engine = teamEngine();
    const a = mon(engine, 0);
    const b = mon(engine, 1);
    engine.fire(a.instanceId, SLOT.quake, a.position);
    engine.fire(b.instanceId, SLOT.quake, b.position);
    engine.applyCrowdCard(a.team, 'energy');
    expect(engine.getFighter(a.instanceId).energy).toBe(R.ENERGY_MAX);
    expect(engine.getFighter(b.instanceId).energy).toBe(R.ENERGY_MAX);
  });

  it('supply drops a crate on its own half that only its own side can take', () => {
    const engine = teamEngine();
    const ally = mon(engine, 0);
    const foe = mon(engine, 2);
    engine.applyCrowdCard(ally.team, 'supply');
    const [crate] = engine.getPickups();
    expect(crate.team).toBe(ally.team);
    // Same half of the court as the side's spawn.
    const mid = engine.getState().arena.height / 2;
    expect(crate.position.y < mid).toBe(engine.getFighter(ally.instanceId).spawn.y < mid);

    for (const p of [ally, foe]) p.currentHp = Math.round(p.maxHp / 2);
    place(foe, crate.position.x, crate.position.y);
    place(ally, 450, crate.position.y < mid ? 1700 : 300);
    run(engine, 100);
    expect(engine.getPickups()).toHaveLength(1);
    place(foe, 100, 1700);
    place(ally, crate.position.x, crate.position.y);
    const half = ally.currentHp;
    const taken = run(engine, 50).find((e) => e.type === 'pickupTaken');
    expect(taken).toMatchObject({ instanceId: ally.instanceId, amount: Math.round(ally.maxHp * R.SUPPLY_HEAL_FRACTION) });
    expect(ally.currentHp).toBe(half + Math.round(ally.maxHp * R.SUPPLY_HEAL_FRACTION));
    expect(engine.getPickups()).toHaveLength(0);
  });

  it('supply despawns after its time', () => {
    const engine = teamEngine();
    engine.applyCrowdCard('teamB', 'supply');
    expect(engine.snapshot(0).pickups).toHaveLength(1);
    run(engine, R.SUPPLY_TTL_MS + 50);
    expect(engine.getPickups()).toHaveLength(0);
  });
});
