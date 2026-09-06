import type { SimEvent, SimState } from './types';

/** The subset of SimulationEngine's public API that renderers/UI actually
 * depend on. SimulationEngine has private fields, so TypeScript's structural
 * typing for classes requires the exact same declaring class for anything
 * annotated `: SimulationEngine` — a duck-typed stand-in (e.g. a multiplayer
 * spectator's remote replay adapter) can't satisfy that even with matching
 * public methods. Depending on this interface instead lets both the real
 * engine and a remote adapter be used interchangeably. */
export interface EngineLike {
  getState(): Readonly<SimState>;
  getEventsSince(seq: number): SimEvent[];
  tick(dtMs: number): void;
  endMatchNow(): void;
}
