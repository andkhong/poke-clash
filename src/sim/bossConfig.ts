/** Boss Mode's tunable amplification knobs — change any of these to rebalance
 * boss fights without touching matchSetup.ts, damage.ts, or PokemonSprite.ts. */
export const BOSS_CONFIG = {
  /** Multiplies the boss's final computed HP, applied after the base-stat
   * bump below (so this is purely "more health", independent of the other
   * stats). */
  healthMultiplier: 5,
  /** Multiplies all six of the boss's base stats (hp/atk/def/spa/spd/spe)
   * before the normal level-based stat formula runs. 1.05 = +5%. */
  baseStatMultiplier: 1.05,
  /** Multiplies damage the boss deals when it lands a hit. */
  damageMultiplier: 1.1,
  /** Multiplies the boss's on-screen sprite size and collision radius. */
  spriteScaleMultiplier: 3,
} as const;
