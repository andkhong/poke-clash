import type { SimulationEngine } from '../../sim/engine';

// The engine mutates one SimState object in place rather than producing a new
// immutable snapshot each tick, so React's reference-equality change detection
// can't be pointed at it directly. Instead this store just ticks a version
// counter on its own throttled interval; components read the engine's live
// state fresh at render time and only need the version bump to know "something
// may have changed, please re-render" (see useSimSnapshot).
const HUD_REFRESH_INTERVAL_MS = 100;

export interface SimStore {
  getEngine(): SimulationEngine;
  getVersion(): number;
  subscribe(callback: () => void): () => void;
}

export function createSimStore(engine: SimulationEngine): SimStore {
  let version = 0;
  const listeners = new Set<() => void>();
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function tick(): void {
    version += 1;
    for (const listener of listeners) listener();
  }

  function ensureLoop(): void {
    if (intervalId !== null) return;
    intervalId = setInterval(tick, HUD_REFRESH_INTERVAL_MS);
  }

  function stopLoopIfIdle(): void {
    if (listeners.size === 0 && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  return {
    getEngine: () => engine,
    getVersion: () => version,
    subscribe(callback) {
      listeners.add(callback);
      ensureLoop();
      return () => {
        listeners.delete(callback);
        stopLoopIfIdle();
      };
    },
  };
}
