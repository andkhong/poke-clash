/** One secret id per browser tab, minted client-side and kept in
 * sessionStorage (same lifetime as spectatorIdentity.ts's display name: it
 * survives reloads within the tab, a fresh tab gets its own, and it follows
 * the tab from room to room). It's the bearer for this tab's wallet on the
 * server (game-server/wallets.ts) — sent on the room stream URL, and with
 * every join, chat and bet — so it must never be shown or broadcast. */
const STORAGE_KEY = 'poke-clash:sessionId';

function generateSessionId(): string {
  // randomUUID is only defined on secure origins — a phone opening the dev
  // server over plain LAN http still needs an id, just a less fancy one.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function loadOrCreateSessionId(): string {
  try {
    const existing = sessionStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const generated = generateSessionId();
    sessionStorage.setItem(STORAGE_KEY, generated);
    return generated;
  } catch {
    // Private-browsing/storage-disabled fallback: a reload starts a new
    // wallet, but the tab works for as long as it's open.
    return generateSessionId();
  }
}

/** This tab's session id — computed once at module load, stable for the
 * tab's whole session. */
export const SESSION_ID: string = loadOrCreateSessionId();
