import { describe, expect, it } from 'vitest';
import { MOVE_VFX_ADJUSTMENTS, getMoveVfxAdjustment } from './moveVfxAdjustments';

describe('moveVfxAdjustments', () => {
  it('holds the reviewed per-move tuning', () => {
    expect(getMoveVfxAdjustment(85)).toBeUndefined(); // Thunderbolt: the pack's animation, per the review's later pick
    expect(getMoveVfxAdjustment(482)).toBeUndefined(); // Sludge Wave: the arena's own effect, per the review's later pick
    expect(getMoveVfxAdjustment(62)?.scale).toBeGreaterThan(1); // Aurora Beam: bigger
    expect(getMoveVfxAdjustment(59)?.scale).toBeLessThan(1); // Blizzard: smaller
    expect(getMoveVfxAdjustment(91)?.dropCells).toEqual([{ x: 128, y: 282 }]); // Dig: second mound gone
    expect(getMoveVfxAdjustment(572)?.usePackAnimation).toBe(true); // Petal Blizzard: the pack's storm
    expect(getMoveVfxAdjustment(295)?.dropPatterns).toContain(0); // Luster Purge: ink bursts gone
    expect(getMoveVfxAdjustment(618)?.dropPatterns).toEqual([5, 6, 7, 8, 9]); // Origin Pulse: splashes and flash gone
    expect(getMoveVfxAdjustment(137)?.upright).toBe(true); // Glare: the eyes face the viewer
    expect(getMoveVfxAdjustment(142)?.upright).toBe(true); // Lovely Kiss: no rotation
    expect(getMoveVfxAdjustment(184)?.upright).toBe(true); // Scary Face: never upside down
    expect(getMoveVfxAdjustment(153)?.patternCycle?.patterns).toEqual([0, 1, 2, 3, 5, 6, 7]); // Explosion: bursts before smoke
    expect(getMoveVfxAdjustment(153)?.playbackSpeed).toBe(1); // ...at the pack's own pace
    expect(getMoveVfxAdjustment(33)).toBeUndefined(); // Tackle: untouched
  });

  it('only holds sane values', () => {
    for (const [id, adjustment] of Object.entries(MOVE_VFX_ADJUSTMENTS)) {
      expect(Number.isInteger(Number(id))).toBe(true);
      if (adjustment.scale !== undefined) expect(adjustment.scale).toBeGreaterThan(0);
      if (adjustment.playbackSpeed !== undefined) expect(adjustment.playbackSpeed).toBeGreaterThan(0);
      // Pinning both ways at once would be contradictory.
      expect(adjustment.preferArenaVfx && adjustment.usePackAnimation).toBeFalsy();
      for (const drop of adjustment.dropCells ?? []) {
        expect(Number.isFinite(drop.x) && Number.isFinite(drop.y)).toBe(true);
      }
      if (adjustment.patternCycle) {
        expect(adjustment.patternCycle.patterns.length).toBeGreaterThan(0);
        for (const pattern of adjustment.patternCycle.patterns) expect(Number.isInteger(pattern) && pattern >= 0).toBe(true);
        if (adjustment.patternCycle.holdFrames !== undefined) expect(adjustment.patternCycle.holdFrames).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
