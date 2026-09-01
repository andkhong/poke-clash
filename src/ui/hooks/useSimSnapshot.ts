import { useSyncExternalStore } from 'react';
import type { SimState } from '../../sim/types';
import type { SimStore } from '../state/simStore';

/** Re-renders the calling component on the store's throttled version bump,
 * then returns the engine's current (live, mutable) SimState. */
export function useSimSnapshot(store: SimStore): SimState {
  useSyncExternalStore(store.subscribe, () => store.getVersion());
  return store.getEngine().getState();
}
