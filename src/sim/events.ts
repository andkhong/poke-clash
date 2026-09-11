import type { SimEvent } from './types';
import type { EngineLike } from './engineLike';

/** Every event with a seq after `seq`, from a log whose seqs are strictly
 * increasing (each SimulationEngine.nextSeq() call is exactly one push, and
 * a multiplayer spectator receives them in order). A binary search rather
 * than a full filter: renderers ask every frame and the log only ever grows
 * over a match. */
export function eventsAfter(events: readonly SimEvent[], seq: number): SimEvent[] {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (events[mid].seq > seq) hi = mid;
    else lo = mid + 1;
  }
  return events.slice(lo);
}

/**
 * Each independent consumer (Phaser renderer, React HUD) should own one of these
 * rather than sharing a single "events this tick" array — that way neither one
 * misses events regardless of relative frame rates or read timing.
 */
export class EventCursor {
  private lastSeq = 0;

  constructor(private readonly engine: EngineLike) {}

  /** Pulls (and consumes) every event produced since this cursor last read. */
  drain(): SimEvent[] {
    const events = this.engine.getEventsSince(this.lastSeq);
    if (events.length > 0) this.lastSeq = events[events.length - 1].seq;
    return events;
  }
}
