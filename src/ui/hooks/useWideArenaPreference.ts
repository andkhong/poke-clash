import { useCallback, useState } from 'react';
import { IS_MOBILE_DEVICE } from '../../app/config';

const STORAGE_KEY = 'poke-clash:wide-arena';

function readStoredPreference(): boolean {
  // Hard-locked — a mobile device never reads (or writes) this, regardless
  // of what a stale value from an earlier desktop session might say.
  if (IS_MOBILE_DEVICE) return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Private browsing / storage disabled — just fall back to the default.
    return false;
  }
}

/**
 * The user's "wide desktop arena" opt-in — persisted across screens/sessions
 * (set once in Setup, it stays on in Custom Battle, Boss Mode, etc.) via
 * localStorage. Mobile devices are hard-locked off: `setWide` is a no-op
 * there, so a screen doesn't need its own `IS_MOBILE_DEVICE` check before
 * calling it — only before deciding whether to render the toggle at all.
 */
export function useWideArenaPreference(): [boolean, (next: boolean) => void] {
  const [wide, setWideState] = useState<boolean>(readStoredPreference);

  const setWide = useCallback((next: boolean) => {
    if (IS_MOBILE_DEVICE) return;
    setWideState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Preference just won't persist past this session — no worse than not
      // having it at all.
    }
  }, []);

  return [wide, setWide];
}
