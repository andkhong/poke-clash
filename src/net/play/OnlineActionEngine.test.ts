import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionEngine } from '../../sim/action/ActionEngine';
import { ACTION_TICK_MS, CROWD_SPEED_MULT, MAX_SPEED } from '../../sim/action/rules';
import { MOVESET, SPECIES, lookup } from '../../sim/action/testFixtures';
import type { MatchConfig } from '../../sim/types';
import { OnlineActionEngine } from './OnlineActionEngine';
import type { ClientMessage } from './playProtocol';

const config: MatchConfig = { level: 50, speciesIds: [1, 2], arena: { width: 900, height: 1950 }, shiny: false, ...MOVESET };
const ME = 'p0-1';
const FOE = 'p1-2';
let clock = 0;

beforeEach(() => {
  clock = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});
afterEach(() => vi.restoreAllMocks());

/** A server engine and one client mirror, wired the way playRooms.ts and PlayOnlineScreen wire them. */
function pair() {
  const server = new ActionEngine(config, SPECIES, lookup, 3, { humanIds: [ME, FOE], reportedMovement: true });
  const sent: ClientMessage[] = [];
  const client = new OnlineActionEngine(config, SPECIES, lookup, 3, ME, (m) => sent.push(m));
  while (server.getState().phase === 'intro') server.tick(ACTION_TICK_MS);
  let seq = 0;
  const sync = () => {
    client.applySnapshot(server.snapshot(seq));
    seq = server.lastActionSeq();
  };
  let tick = 0;
  const frames = (ms: number) => {
    for (let t = 0; t < ms; t += ACTION_TICK_MS) {
      if (++tick % 2 === 0) sync(); // the server's 30 Hz
      clock += ACTION_TICK_MS;
      client.tick(ACTION_TICK_MS);
      server.tick(ACTION_TICK_MS);
      for (const m of sent.splice(0)) {
        if (m.t === 'move') server.reportMovement(ME, { x: m.x, y: m.y }, { x: m.vx, y: m.vy }, m.facing);
        if (m.t === 'fire') server.fire(ME, m.slot, { x: m.x, y: m.y });
        if (m.t === 'dash') server.dash(ME);
      }
    }
    sync();
  };
  sync();
  return { server, client, frames };
}

describe('OnlineActionEngine', () => {
  it('moves the player locally at once and the server follows its reports', () => {
    const { server, client, frames } = pair();
    const start = { ...client.getState().pokemon[ME].position };
    client.setMoveInput(ME, 1, 0);
    clock += ACTION_TICK_MS;
    client.tick(ACTION_TICK_MS);
    expect(client.getState().pokemon[ME].position.x).toBeGreaterThan(start.x); // no round trip needed
    frames(1000);
    const moved = client.getState().pokemon[ME].position.x - start.x;
    expect(moved).toBeGreaterThan(MAX_SPEED * 0.5);
    expect(Math.abs(server.getState().pokemon[ME].position.x - client.getState().pokemon[ME].position.x)).toBeLessThan(40);
  });

  it('glides other fighters between snapshots instead of jumping', () => {
    const { server, client, frames } = pair();
    const foe = server.getState().pokemon[FOE];
    const from = foe.position.x;
    server.reportMovement(FOE, { x: from + 30, y: foe.position.y }, { x: 0, y: 0 }, 'E');
    frames(50); // snapshot with the new position arrives
    clock += 20;
    client.tick(20);
    const drawn = client.getState().pokemon[FOE].position.x;
    expect(drawn).toBeGreaterThanOrEqual(from);
    expect(drawn).toBeLessThan(from + 30);
    frames(200);
    expect(client.getState().pokemon[FOE].position.x).toBeCloseTo(from + 30, 0);
  });

  it('sends fires to the server and spends the cooldown locally right away', () => {
    const { server, client, frames } = pair();
    const foe = server.getState().pokemon[FOE].position;
    expect(client.fire(ME, 0, { ...foe })).toBe(true);
    expect(client.canFire(ME, 0)).toBe(false);
    frames(100);
    expect(server.getFighter(ME).cooldowns[0]).toBeGreaterThan(0);
    expect(client.getActionEventsSince(0).some((e) => e.type === 'fired' && e.attackerId === ME)).toBe(true);
  });

  it('drops a shot that has flown its range while snapshots are late, instead of flying it on', () => {
    const { server, client, frames } = pair();
    server.getState().pokemon[FOE].position = { x: 450, y: 1500 };
    server.getState().pokemon[ME].position = { x: 450, y: 400 };
    server.fire(ME, 0, { x: 100, y: 400 }); // a ranged shot off to the side, at nobody
    frames(50);
    expect(client.getProjectiles()).toHaveLength(1);
    clock += 2000; // the connection stalls: no snapshot for 2 s
    client.tick(ACTION_TICK_MS);
    expect(client.getProjectiles()).toHaveLength(0);
  });

  it('takes the knockback from a hit on the player', () => {
    const { server, client, frames } = pair();
    // Mid-arena, clear of the fence, which would otherwise stop the shove.
    const me = { x: 450, y: 1000 };
    client.getState().pokemon[ME].position = { ...me };
    server.getState().pokemon[ME].position = { ...me };
    const foe = server.getState().pokemon[FOE];
    foe.position = { x: me.x, y: me.y + 250 };
    server.fire(FOE, 0, { ...me });
    frames(800);
    expect(client.getActionEventsSince(0).some((e) => e.type === 'hit' && e.targetId === ME)).toBe(true);
    expect(client.getState().pokemon[ME].currentHp).toBeLessThan(client.getState().pokemon[ME].maxHp);
    expect(client.getState().pokemon[ME].position.y).toBeLessThan(me.y); // shoved away from the shot
  });

  it('runs a crowd speed burst on the local mirror too, and the server keeps up with it', () => {
    const { server, client, frames } = pair();
    const start = { x: 450, y: 300 };
    client.getState().pokemon[ME].position = { ...start };
    server.getState().pokemon[ME].position = { ...start };
    server.applyCrowdCard(server.getState().pokemon[ME].team, 'speed');
    server.applyCrowdCard(server.getState().pokemon[FOE].team, 'supply');
    frames(50);
    expect(client.getFighter(ME).speedMs).toBeGreaterThan(0);
    expect(client.getPickups()).toHaveLength(1);
    client.setMoveInput(ME, 0, 1);
    frames(1000);
    const v = client.getState().pokemon[ME].velocity;
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(MAX_SPEED * CROWD_SPEED_MULT, 0);
    expect(Math.abs(server.getState().pokemon[ME].position.y - client.getState().pokemon[ME].position.y)).toBeLessThan(40);
  });
});
