import { toShowdownSlug } from '../../data/showdownSlug';
import type { SpriteIndex, SpriteTier } from '../../data/types';

export interface SpriteUrls {
  tier: SpriteTier;
  /** Facing North (back-view) and South (front-view). East/West reuse `front`, mirrored via transform. */
  front: string;
  back: string;
  /** true for tier 'animated' (a real multi-frame GIF); false means a static image needing procedural animation. */
  isAnimated: boolean;
}

function urlsForTier(slug: string, tier: SpriteTier, speciesId: number): SpriteUrls {
  switch (tier) {
    case 'animated':
      return {
        tier,
        front: `https://play.pokemonshowdown.com/sprites/ani/${slug}.gif`,
        back: `https://play.pokemonshowdown.com/sprites/ani-back/${slug}.gif`,
        isAnimated: true,
      };
    case 'static-gen5':
      return {
        tier,
        front: `https://play.pokemonshowdown.com/sprites/gen5/${slug}.png`,
        back: `https://play.pokemonshowdown.com/sprites/gen5-back/${slug}.png`,
        isAnimated: false,
      };
    case 'static-official':
    case 'unknown':
    default: {
      // No official back-view art exists — North falls back to the same front image.
      const url = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${speciesId}.png`;
      return { tier: 'static-official', front: url, back: url, isAnimated: false };
    }
  }
}

/** Step one tier down the fallback chain — used by the runtime onerror handler. */
export function downgradeTier(tier: SpriteTier): SpriteTier | null {
  if (tier === 'animated') return 'static-gen5';
  if (tier === 'static-gen5') return 'static-official';
  return null; // static-official is the guaranteed floor; nothing below it
}

const runtimeCache = new Map<number, SpriteUrls>();

/**
 * Resolves the sprite URLs for one species. A locally mirrored copy
 * (spriteIndex.json's `local`, fetched into public/fallback-sprites/ by
 * data-pipeline/fetch-fallback-sprites.ts) wins outright — same-origin,
 * cached, no third party involved. Otherwise it's the hotlinked original,
 * preferring the build-time probe hint's tier for correct-on-first-paint
 * and defaulting to 'animated' (the common case) when no hint exists. The
 * caller (PokemonSprite) is responsible for calling `downgradeTier` +
 * re-resolving with a `tierOverride` on an actual image load failure —
 * this function alone can't guarantee the URL it returns exists, only that
 * it's the best guess; an override always goes back to the hotlinked
 * chain, since a local file that failed has nothing local beneath it.
 */
export function resolveSpriteUrls(
  speciesId: number,
  speciesName: string,
  hintIndex: SpriteIndex | null,
  tierOverride?: SpriteTier
): SpriteUrls {
  if (!tierOverride && runtimeCache.has(speciesId)) return runtimeCache.get(speciesId)!;

  const hint = hintIndex?.[String(speciesId)];
  let resolved: SpriteUrls;
  if (!tierOverride && hint?.local) {
    resolved = { tier: hint.tier, front: hint.local.front, back: hint.local.back, isAnimated: hint.tier === 'animated' };
  } else {
    const slug = hint?.slug ?? toShowdownSlug(speciesName);
    const tier = tierOverride ?? hint?.tier ?? 'animated';
    resolved = urlsForTier(slug, tier, speciesId);
  }
  if (!tierOverride) runtimeCache.set(speciesId, resolved);
  return resolved;
}

export function clearSpriteResolutionCache(): void {
  runtimeCache.clear();
}
