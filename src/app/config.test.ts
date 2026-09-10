import { afterEach, describe, expect, it, vi } from 'vitest';

// IS_MOBILE_DEVICE is computed once at module load from `navigator`, so each
// case here stubs a fresh `navigator` and re-imports the module (via
// vi.resetModules()) to force a fresh evaluation — importing normally would
// just return the first test's cached result for every subsequent one.
describe('IS_MOBILE_DEVICE / resolveMatchArena', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('trusts userAgentData.mobile:true over anything else when present', async () => {
    vi.stubGlobal('navigator', {
      userAgentData: { mobile: true },
      // A desktop-looking UA string that a regex-only check would misread —
      // proves userAgentData is consulted first, not just as a fallback.
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    });
    const { IS_MOBILE_DEVICE } = await import('./config');
    expect(IS_MOBILE_DEVICE).toBe(true);
  });

  it('trusts userAgentData.mobile:false over a mobile-looking UA string', async () => {
    vi.stubGlobal('navigator', {
      userAgentData: { mobile: false },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari',
    });
    const { IS_MOBILE_DEVICE } = await import('./config');
    expect(IS_MOBILE_DEVICE).toBe(false);
  });

  it('falls back to a UA regex on browsers with no userAgentData (Safari/Firefox)', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari',
    });
    const { IS_MOBILE_DEVICE } = await import('./config');
    expect(IS_MOBILE_DEVICE).toBe(true);
  });

  it('treats a standard desktop UA with no userAgentData as non-mobile', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    });
    const { IS_MOBILE_DEVICE } = await import('./config');
    expect(IS_MOBILE_DEVICE).toBe(false);
  });

  it('hard-locks resolveMatchArena to the portrait arena on mobile, ignoring preferWide', async () => {
    vi.stubGlobal('navigator', { userAgentData: { mobile: true } });
    const { resolveMatchArena, ARENA_WIDTH, ARENA_HEIGHT } = await import('./config');
    expect(resolveMatchArena(true)).toEqual({ width: ARENA_WIDTH, height: ARENA_HEIGHT });
    expect(resolveMatchArena(false)).toEqual({ width: ARENA_WIDTH, height: ARENA_HEIGHT });
  });

  it('lets a non-mobile device opt into the wide desktop arena', async () => {
    vi.stubGlobal('navigator', { userAgentData: { mobile: false } });
    const { resolveMatchArena, DESKTOP_ARENA_WIDTH, DESKTOP_ARENA_HEIGHT } = await import('./config');
    expect(resolveMatchArena(true)).toEqual({ width: DESKTOP_ARENA_WIDTH, height: DESKTOP_ARENA_HEIGHT });
  });

  it('defaults a non-mobile device to the portrait arena until it opts in', async () => {
    vi.stubGlobal('navigator', { userAgentData: { mobile: false } });
    const { resolveMatchArena, ARENA_WIDTH, ARENA_HEIGHT } = await import('./config');
    expect(resolveMatchArena(false)).toEqual({ width: ARENA_WIDTH, height: ARENA_HEIGHT });
  });
});
