import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adjustBalance,
  getBalance,
  isWalletConnected,
  resetWalletsForTests,
  STARTING_BALANCE,
  touchWallet,
  WALLET_GRACE_MS,
  walletStreamClosed,
  walletStreamOpened,
} from './wallets';

describe('wallets', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetWalletsForTests();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('mints a wallet at the starting balance on first sight, and only then', () => {
    expect(getBalance('a')).toBeNull();
    expect(touchWallet('a').balance).toBe(STARTING_BALANCE);
    expect(adjustBalance('a', -30)).toBe(70);
    expect(touchWallet('a').balance).toBe(70);
    expect(adjustBalance('ghost', 50)).toBeNull(); // never creates one
    expect(getBalance('ghost')).toBeNull();
  });

  it('lives while a stream is open and for the grace period after the last one closes', () => {
    walletStreamOpened('a');
    expect(isWalletConnected('a')).toBe(true);
    vi.advanceTimersByTime(WALLET_GRACE_MS * 10);
    expect(getBalance('a')).toBe(STARTING_BALANCE);

    walletStreamOpened('a'); // a second tab-stream (e.g. mid-navigation)
    walletStreamClosed('a');
    vi.advanceTimersByTime(WALLET_GRACE_MS * 10);
    expect(getBalance('a')).toBe(STARTING_BALANCE); // one stream still open

    walletStreamClosed('a');
    expect(isWalletConnected('a')).toBe(false);
    vi.advanceTimersByTime(WALLET_GRACE_MS - 1);
    expect(getBalance('a')).toBe(STARTING_BALANCE);
    vi.advanceTimersByTime(1);
    expect(getBalance('a')).toBeNull();
  });

  it('survives a reconnect inside the grace period with its balance intact', () => {
    walletStreamOpened('a');
    adjustBalance('a', 55);
    walletStreamClosed('a');
    vi.advanceTimersByTime(WALLET_GRACE_MS / 2);
    walletStreamOpened('a');
    vi.advanceTimersByTime(WALLET_GRACE_MS * 10);
    expect(getBalance('a')).toBe(STARTING_BALANCE + 55);
  });

  it('puts a wallet that never opens a stream on the grace clock from the start', () => {
    touchWallet('a');
    vi.advanceTimersByTime(WALLET_GRACE_MS);
    expect(getBalance('a')).toBeNull();
  });
});
