import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MoveAnimationIndex } from '../../../data/types';
import type { MoveDefinition } from '../../../sim/types';
import { STRUGGLE_MOVE_ID } from '../../../sim/struggle';
import { STATUS_COMMON_ANIMATIONS, type MoveAnimationData } from '../../../data/moveAnimationFormat';

// Guards the converter's output (data-pipeline/build-move-animations.ts)
// rather than any runtime code: every move the sim can produce must have
// an animation and every sheet an animation names must actually be in the
// repo, so a regenerated dataset or a half-run converter can't ship a
// match where some attack silently falls back to the flash.
const ROOT = new URL('../../../../', import.meta.url);
const index = JSON.parse(readFileSync(new URL('src/data/generated/moveAnimations.json', ROOT), 'utf-8')) as MoveAnimationIndex;
const moves = JSON.parse(readFileSync(new URL('src/data/generated/moves.json', ROOT), 'utf-8')) as Record<string, MoveDefinition>;

describe('moveAnimations.json', () => {
  it('has an animation for every move in the dataset, plus Struggle', () => {
    const missing = Object.keys(moves).filter((id) => !index.moves[id]);
    expect(missing).toEqual([]);
    expect(index.moves[String(STRUGGLE_MOVE_ID)]).toBeDefined();
  });

  it('has every status-condition animation the arena plays', () => {
    for (const name of Object.values(STATUS_COMMON_ANIMATIONS)) {
      expect(index.common[name], name).toBeDefined();
    }
  });

  it('ships the JSON and sheet file for every entry', () => {
    const missingFiles: string[] = [];
    for (const [id, entry] of Object.entries(index.moves)) {
      if (!existsSync(new URL(`public/move-anims/moves/${id}.json`, ROOT))) missingFiles.push(`moves/${id}.json`);
      if (entry.sheet && !existsSync(new URL(`public/move-anims/sheets/${entry.sheet}.png`, ROOT))) missingFiles.push(`sheets/${entry.sheet}.png`);
    }
    for (const [name, entry] of Object.entries(index.common)) {
      if (!existsSync(new URL(`public/move-anims/common/${name}.json`, ROOT))) missingFiles.push(`common/${name}.json`);
      if (entry.sheet && !existsSync(new URL(`public/move-anims/sheets/${entry.sheet}.png`, ROOT))) missingFiles.push(`sheets/${entry.sheet}.png`);
    }
    expect(missingFiles).toEqual([]);
  });

  it('writes well-formed frames (a spot check on Tackle and Flamethrower)', () => {
    const tackle = JSON.parse(readFileSync(new URL('public/move-anims/moves/33.json', ROOT), 'utf-8')) as MoveAnimationData;
    expect(tackle.v).toBe(1);
    expect(tackle.name).toBe('Move:TACKLE');
    expect(tackle.frames.length).toBe(index.moves['33'].frames);
    expect(index.moves['33'].melee).toBe(true);
    // the dash: at some frame the user is displaced toward the target
    expect(tackle.frames.some((f) => f.u !== null && f.u[0] > 20)).toBe(true);

    const flamethrower = JSON.parse(readFileSync(new URL('public/move-anims/moves/53.json', ROOT), 'utf-8')) as MoveAnimationData;
    expect(index.moves['53'].melee).toBe(false);
    const cell = flamethrower.frames.find((f) => f.c.length > 0)!.c[0];
    expect(cell.length).toBe(12);
    expect(cell[7]).toBeGreaterThanOrEqual(0); // pattern
    expect(cell[10]).toBeGreaterThanOrEqual(1); // focus
    expect(cell[10]).toBeLessThanOrEqual(4);
  });
});
