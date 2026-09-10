import { describe, expect, it } from 'vitest';
import type { MoveAnimationIndexEntry } from '../../data/types';
import type { MoveDefinition } from '../../sim/types';
import { resolveMoveVfxSource } from './moveVfxSource';

const MOVE: MoveDefinition = {
  id: 999,
  name: 'Fixture',
  type: 'water',
  category: 'special',
  power: 80,
  accuracy: 100,
  pp: 10,
  priority: 0,
  targeting: 'enemy',
};
const PACK: MoveAnimationIndexEntry = { anim: 'Move:FIXTURE', sheet: 'fixture', frames: 10, melee: false, screen: false };
const SCREEN: MoveAnimationIndexEntry = { ...PACK, screen: true };

describe('resolveMoveVfxSource', () => {
  it('plays the pack animation unless it is screen-wide or missing', () => {
    expect(resolveMoveVfxSource(MOVE, PACK, undefined)).toEqual({ kind: 'pack', entry: PACK, viaReview: false });
    expect(resolveMoveVfxSource(MOVE, SCREEN, undefined)).toMatchObject({ kind: 'family', family: 'beam', reason: 'screen-wide', entry: SCREEN });
    expect(resolveMoveVfxSource(MOVE, undefined, undefined)).toMatchObject({ kind: 'family', reason: 'no-pack-animation', entry: null });
  });

  it('lets the review pin either way', () => {
    expect(resolveMoveVfxSource(MOVE, PACK, { preferArenaVfx: true })).toMatchObject({ kind: 'family', reason: 'review-preference' });
    expect(resolveMoveVfxSource(MOVE, SCREEN, { usePackAnimation: true })).toEqual({ kind: 'pack', entry: SCREEN, viaReview: true });
    // Pinning the pack can't conjure an animation the pack doesn't have.
    expect(resolveMoveVfxSource(MOVE, undefined, { usePackAnimation: true })).toMatchObject({ kind: 'family', reason: 'no-pack-animation' });
  });

  it('honors a forced source over everything but a missing animation', () => {
    expect(resolveMoveVfxSource(MOVE, SCREEN, undefined, 'pack')).toEqual({ kind: 'pack', entry: SCREEN, viaReview: false });
    expect(resolveMoveVfxSource(MOVE, PACK, { usePackAnimation: true }, 'arena')).toMatchObject({ kind: 'family', reason: 'forced' });
    expect(resolveMoveVfxSource(MOVE, undefined, undefined, 'pack')).toMatchObject({ kind: 'family', reason: 'no-pack-animation' });
  });
});
