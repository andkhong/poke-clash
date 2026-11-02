import { MAX_MOVE_VOICES, MOVE_REPEAT_WINDOW_MS } from './mix';

/** A move clip that's playing. `own` = the listener's own move or a hit on them. */
export interface MoveVoice {
  key: string;
  own: boolean;
  startedMs: number;
}

/** Whether a new move clip may start among the ones already playing, and
 * which one (if any) it cuts off. Pure, so the mixing rules are testable:
 * - the same clip restarting within MOVE_REPEAT_WINDOW_MS is skipped — unless
 *   it's your own and the earlier one wasn't (a melee hit on you right after
 *   the attacker's quieter clip);
 * - under MAX_MOVE_VOICES it just plays;
 * - at the cap it replaces the oldest of everyone else's clips;
 * - your own clips are never cut — with only those playing, another of yours
 *   still plays (one fighter's cooldowns keep that short) and anyone else's
 *   is dropped. */
export function admitMoveVoice<V extends MoveVoice>(
  playing: readonly V[],
  key: string,
  own: boolean,
  nowMs: number
): { play: false } | { play: true; evict: V | null } {
  if (playing.some((v) => v.key === key && nowMs - v.startedMs < MOVE_REPEAT_WINDOW_MS && (v.own || !own))) return { play: false };
  if (playing.length < MAX_MOVE_VOICES) return { play: true, evict: null };
  const oldestOther = playing.filter((v) => !v.own).reduce<V | null>((oldest, v) => (!oldest || v.startedMs < oldest.startedMs ? v : oldest), null);
  if (oldestOther) return { play: true, evict: oldestOther };
  return own ? { play: true, evict: null } : { play: false };
}
