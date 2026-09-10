import { beforeEach, describe, expect, it } from 'vitest';
import { clearSpriteResolutionCache, downgradeTier, resolveSpriteUrls } from './spriteResolver';

beforeEach(() => {
  clearSpriteResolutionCache();
});

describe('resolveSpriteUrls', () => {
  it('defaults to the animated tier when there is no build-time hint', () => {
    const urls = resolveSpriteUrls(25, 'pikachu', null);
    expect(urls.tier).toBe('animated');
    expect(urls.isAnimated).toBe(true);
    expect(urls.front).toBe('https://play.pokemonshowdown.com/sprites/ani/pikachu.gif');
    expect(urls.back).toBe('https://play.pokemonshowdown.com/sprites/ani-back/pikachu.gif');
  });

  it('uses the build-time hint tier and slug when available', () => {
    const hint = { '1008': { slug: 'miraidon', tier: 'static-gen5' as const } };
    const urls = resolveSpriteUrls(1008, 'miraidon', hint);
    expect(urls.tier).toBe('static-gen5');
    expect(urls.isAnimated).toBe(false);
    expect(urls.front).toBe('https://play.pokemonshowdown.com/sprites/gen5/miraidon.png');
    expect(urls.back).toBe('https://play.pokemonshowdown.com/sprites/gen5-back/miraidon.png');
  });

  it('falls back to the same front image for back-view at the static-official floor', () => {
    const urls = resolveSpriteUrls(1025, 'pecharunt', null, 'static-official');
    expect(urls.front).toBe(urls.back);
    expect(urls.front).toContain('official-artwork/1025.png');
  });

  it('slugifies hyphenated/irregular PokeAPI names for the default (no-hint) case', () => {
    expect(resolveSpriteUrls(122, 'mr-mime', null).front).toContain('/mrmime.gif');
    expect(resolveSpriteUrls(83, 'farfetchd', null).front).toContain('/farfetchd.gif');
  });

  it('prefers a locally mirrored copy over the hotlinked original, keeping the mirrored tier', () => {
    const hint = {
      '15': {
        slug: 'beedrill',
        tier: 'animated' as const,
        local: { front: '/fallback-sprites/15-front.gif', back: '/fallback-sprites/15-back.gif' },
      },
    };
    const urls = resolveSpriteUrls(15, 'beedrill', hint);
    expect(urls.tier).toBe('animated');
    expect(urls.isAnimated).toBe(true);
    expect(urls.front).toBe('/fallback-sprites/15-front.gif');
    expect(urls.back).toBe('/fallback-sprites/15-back.gif');
  });

  it('marks a mirrored static tier as not animated', () => {
    const hint = {
      '266': {
        slug: 'silcoon',
        tier: 'static-gen5' as const,
        local: { front: '/fallback-sprites/266-front.png', back: '/fallback-sprites/266-back.png' },
      },
    };
    expect(resolveSpriteUrls(266, 'silcoon', hint).isAnimated).toBe(false);
  });

  it('goes back to the hotlinked chain on a tier override, since a failed local file has nothing local beneath it', () => {
    const hint = {
      '15': {
        slug: 'beedrill',
        tier: 'animated' as const,
        local: { front: '/fallback-sprites/15-front.gif', back: '/fallback-sprites/15-back.gif' },
      },
    };
    const urls = resolveSpriteUrls(15, 'beedrill', hint, 'static-gen5');
    expect(urls.front).toBe('https://play.pokemonshowdown.com/sprites/gen5/beedrill.png');
  });

  it('caches by species id unless a tier override is passed', () => {
    const first = resolveSpriteUrls(1, 'bulbasaur', null);
    const second = resolveSpriteUrls(1, 'bulbasaur', null);
    expect(second).toBe(first); // same object reference — came from cache

    const overridden = resolveSpriteUrls(1, 'bulbasaur', null, 'static-gen5');
    expect(overridden).not.toBe(first);
    expect(overridden.tier).toBe('static-gen5');
  });
});

describe('downgradeTier', () => {
  it('steps animated -> static-gen5 -> static-official -> null', () => {
    expect(downgradeTier('animated')).toBe('static-gen5');
    expect(downgradeTier('static-gen5')).toBe('static-official');
    expect(downgradeTier('static-official')).toBeNull();
  });
});
