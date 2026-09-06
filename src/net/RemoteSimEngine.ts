import type { EngineLike } from '../sim/engineLike';
import type { SimEvent, SimState, Vec2 } from '../sim/types';

// Matches game-server's own broadcast cadence (HUD_REFRESH_INTERVAL_MS) — the
// window position interpolation should span between two successive snapshots.
const LERP_WINDOW_MS = 100;

/** EngineLike implementation for multiplayer spectators. Applies whatever the
 * server dictates verbatim (HP/status/phase/events all snap immediately, same
 * as the local HUD already only refreshing 10x/sec) and only smooths
 * `position`, since the network delivers it at 10 Hz while Phaser renders at
 * 60 fps. No gameplay decision is ever made client-side. */
export class RemoteSimEngine implements EngineLike {
  private state: SimState;
  private events: SimEvent[] = [];
  private prevPositions = new Map<string, Vec2>();
  private targetPositions = new Map<string, Vec2>();
  private lerpElapsedMs = 0;

  constructor(initialState: SimState) {
    this.state = initialState;
    this.targetPositions = snapshotPositions(this.state);
  }

  getState(): Readonly<SimState> {
    return this.state;
  }

  getEventsSince(seq: number): SimEvent[] {
    return this.events.filter((e) => e.seq > seq);
  }

  // No-op: spectators have no authority over a server-run match.
  endMatchNow(): void {}

  tick(dtMs: number): void {
    this.lerpElapsedMs += dtMs;
    const t = Math.min(1, this.lerpElapsedMs / LERP_WINDOW_MS);
    for (const id of this.state.livingOrder) {
      const from = this.prevPositions.get(id);
      const to = this.targetPositions.get(id);
      const pokemon = this.state.pokemon[id];
      if (from && to && pokemon) {
        pokemon.position = { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) };
      }
    }
  }

  /** Called by RoomConnection on every stateUpdate/battleComplete message. */
  applyServerUpdate(nextState: SimState, newEvents: SimEvent[]): void {
    this.prevPositions = snapshotPositions(this.state);
    this.state = nextState;
    this.targetPositions = snapshotPositions(this.state);
    this.lerpElapsedMs = 0;
    if (newEvents.length > 0) this.events.push(...newEvents);
  }
}

function snapshotPositions(state: SimState): Map<string, Vec2> {
  const map = new Map<string, Vec2>();
  for (const id of state.livingOrder) {
    map.set(id, { ...state.pokemon[id].position });
  }
  return map;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
