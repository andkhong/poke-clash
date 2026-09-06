import type { SimEvent } from './types';
import type { EngineLike } from './engineLike';

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
