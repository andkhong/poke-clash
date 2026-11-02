import type { PlayModeKind } from '../../app/playMode';

/** Local copy of PLAY_MODES' labels: app/playMode.ts pulls in the species
 * dataset, which must stay out of the landing bundle. */
export function modeLabel(mode: PlayModeKind): string {
  return mode === 'ffa' ? 'Brawl' : `${mode}v${mode}`;
}
