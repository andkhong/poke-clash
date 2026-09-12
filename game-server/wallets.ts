/** Per-session Pokémon Dollar wallets. A session is one browser tab (see
 * src/net/sessionIdentity.ts); its wallet is created at STARTING_BALANCE the
 * first time the server sees the id and lives for as long as the tab holds a
 * room stream open — "until they disconnect or leave". Module-level rather
 * than per-room so a balance follows the tab from room to room, and never
 * touched by roomManager's resetRoom (same carve-out nextChatId has). */

export const STARTING_BALANCE = 100;
/** Credited to every session subscribed to a room when its match settles,
 * bet or no bet — the "earn by watching" drip that keeps a broke viewer in
 * the game. */
export const MATCH_WATCHED_REWARD = 10;
/** How long a wallet survives with no stream open before it's dropped —
 * long enough to ride out EventSource's auto-reconnect and a hop from one
 * room page to another, short enough that a closed tab really is gone. */
export const WALLET_GRACE_MS = 60_000;

interface Wallet {
  balance: number;
  /** Open room streams carrying this session id (see sse.ts's subscribe). */
  streams: number;
  /** Armed whenever `streams` is 0 — fires the wallet's deletion. */
  graceTimer: ReturnType<typeof setTimeout> | null;
}

const wallets = new Map<string, Wallet>();

function armGrace(sessionId: string, wallet: Wallet): void {
  if (wallet.graceTimer) clearTimeout(wallet.graceTimer);
  wallet.graceTimer = setTimeout(() => {
    if (wallets.get(sessionId) === wallet && wallet.streams === 0) wallets.delete(sessionId);
  }, WALLET_GRACE_MS);
  // Never the only thing keeping the process alive (tests, shutdown).
  wallet.graceTimer.unref?.();
}

/** The session's wallet, created at STARTING_BALANCE if this is the first
 * time the server sees the id. A wallet created with no stream open is on
 * its grace clock from the start, so a one-off request from a session that
 * never streams can't leak one. */
export function touchWallet(sessionId: string): { balance: number } {
  let wallet = wallets.get(sessionId);
  if (!wallet) {
    wallet = { balance: STARTING_BALANCE, streams: 0, graceTimer: null };
    wallets.set(sessionId, wallet);
    armGrace(sessionId, wallet);
  }
  return wallet;
}

/** Current balance, or null for a session the server has never seen (or has
 * already dropped) — never creates one, so summaries/chat can look up a
 * seat's balance without minting wallets for stale ids. */
export function getBalance(sessionId: string): number | null {
  return wallets.get(sessionId)?.balance ?? null;
}

/** Adds `delta` (negative to debit) to an existing wallet and returns the
 * new balance, or null if the session has no wallet any more — a payout to
 * a tab that closed and timed out is simply dropped rather than resurrecting
 * a wallet nobody holds. Callers are responsible for not overdrawing. */
export function adjustBalance(sessionId: string, delta: number): number | null {
  const wallet = wallets.get(sessionId);
  if (!wallet) return null;
  wallet.balance += delta;
  return wallet.balance;
}

export function walletStreamOpened(sessionId: string): void {
  const wallet = wallets.get(sessionId) ?? (touchWallet(sessionId) as Wallet);
  wallet.streams += 1;
  if (wallet.graceTimer) {
    clearTimeout(wallet.graceTimer);
    wallet.graceTimer = null;
  }
}

export function walletStreamClosed(sessionId: string): void {
  const wallet = wallets.get(sessionId);
  if (!wallet) return;
  wallet.streams = Math.max(0, wallet.streams - 1);
  if (wallet.streams === 0) armGrace(sessionId, wallet);
}

/** True while the session has at least one stream open. */
export function isWalletConnected(sessionId: string): boolean {
  return (wallets.get(sessionId)?.streams ?? 0) > 0;
}

export function resetWalletsForTests(): void {
  for (const wallet of wallets.values()) if (wallet.graceTimer) clearTimeout(wallet.graceTimer);
  wallets.clear();
}
