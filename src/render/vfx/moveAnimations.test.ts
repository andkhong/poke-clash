import { describe, expect, it } from 'vitest';
import { resolveMoveAnimation } from './moveAnimations';
import type { MoveDefinition } from '../../sim/types';

function move(overrides: Partial<MoveDefinition>): MoveDefinition {
  return {
    id: 999,
    name: 'Fixture Move',
    type: 'normal',
    category: 'physical',
    power: 40,
    accuracy: 100,
    pp: 10,
    priority: 0,
    targeting: 'enemy',
    ...overrides,
  };
}

describe('resolveMoveAnimation', () => {
  it('routes an ordinary single-target physical move to lunge', () => {
    expect(resolveMoveAnimation(move({ targeting: 'enemy' })).family).toBe('lunge');
  });

  it('routes Hydro Pump and Hydro Cannon to hydroPump', () => {
    expect(resolveMoveAnimation(move({ id: 56, type: 'water', category: 'special' })).family).toBe('hydroPump');
    expect(resolveMoveAnimation(move({ id: 308, type: 'water', category: 'special' })).family).toBe('hydroPump');
  });

  it('routes every named spread physical move (no per-move override, no type-based rule) to rockBurst, never the single-target lunge default', () => {
    // Self Destruct, Explosion, Rock Slide, Petal Blizzard, Diamond Storm,
    // Brutal Swing, Breaking Swipe, Mortal Spin — engine.ts's resolveTargets
    // can hand each of these several real hit targets scattered around the
    // arena, but 'lunge' physically dashes the attacker to exactly one point
    // (PokemonSprite.playLungeAttack) — so left on the plain 'lunge' default,
    // the attack would visibly lunge at one target while impact bursts (and
    // the HP-bar drops that go with them) popped up at the others' own,
    // possibly far-off positions with no attack ever visibly reaching them —
    // reading as one attack simultaneously hitting Pokémon in two different
    // places at once.
    const spreadPhysicalMoveIds = [120, 153, 157, 572, 591, 693, 784, 866];
    for (const id of spreadPhysicalMoveIds) {
      const family = resolveMoveAnimation(
        move({ id, category: 'physical', targeting: 'all-enemies-in-radius' })
      ).family;
      expect(family).toBe('rockBurst');
      expect(family).not.toBe('lunge');
    }
  });

  it('still lets a named per-move override win over the spread-physical fallback', () => {
    // Razor Leaf (id 75) is 'physical' + spread-shaped in reference footage
    // but is single-target in this engine's data — its named override to
    // 'leaf' must still apply rather than falling into the spread-physical
    // rule above (which only fires for genuinely 'all-enemies-in-radius' moves).
    expect(resolveMoveAnimation(move({ id: 75, category: 'physical', targeting: 'enemy' })).family).toBe('leaf');
  });

  it('leaves an ordinary spread special move on its own type-based/default family, not rockBurst', () => {
    // Only the plain 'lunge' default gets redirected — a spread special move
    // (e.g. a beam-shaped water move) is already ranged and already loops
    // per hit target (see ArenaScene.ts), so it needs no rerouting.
    expect(resolveMoveAnimation(move({ category: 'special', type: 'water', targeting: 'all-enemies-in-radius' })).family).toBe(
      'beam'
    );
  });
});
