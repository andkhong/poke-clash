import { listAllSpecies } from '../data/loader';

/** One generated display name per browser tab ("Slowpoke482"), used for room
 * chat by anyone without a seat — which, for the always-on autoPlay room, is
 * everyone (see game-server/roomManager.ts's startAutoPlayCycle). Persisted
 * in sessionStorage so it survives reloads within the tab but a fresh tab
 * gets its own, and it's the same identity across every room that tab
 * visits rather than being regenerated per room. */
const STORAGE_KEY = 'poke-clash:spectatorName';

function generateSpectatorName(): string {
  const species = listAllSpecies();
  const pick = species[Math.floor(Math.random() * species.length)];
  const suffix = Math.floor(100 + Math.random() * 900); // 3 digits, never leading-zero
  return `${pick.name}${suffix}`;
}

function loadOrCreateSpectatorName(): string {
  try {
    const existing = sessionStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const generated = generateSpectatorName();
    sessionStorage.setItem(STORAGE_KEY, generated);
    return generated;
  } catch {
    // Private-browsing/storage-disabled fallback: still usable for the tab's
    // lifetime, just not persisted across a reload.
    return generateSpectatorName();
  }
}

/** This tab's spectator identity — computed once at module load, stable for
 * the tab's whole session. */
export const SPECTATOR_NAME: string = loadOrCreateSpectatorName();
