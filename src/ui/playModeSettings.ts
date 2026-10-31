import { IS_MOBILE_DEVICE } from '../app/config';

const LOCK_ON_STORAGE_KEY = 'pokeclash.playMode.lockOn';

/** Touch devices start with lock-on (tap-to-fire needs a target); mouse players aim themselves. */
export function initialLockOn(): boolean {
  try {
    const saved = localStorage.getItem(LOCK_ON_STORAGE_KEY);
    if (saved !== null) return saved === '1';
  } catch {
    // storage blocked — fall through to the device default
  }
  return IS_MOBILE_DEVICE;
}

export function saveLockOn(on: boolean): void {
  try {
    localStorage.setItem(LOCK_ON_STORAGE_KEY, on ? '1' : '0');
  } catch {
    // per-device convenience only
  }
}
