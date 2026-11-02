import { describe, expect, it } from 'vitest';
import { MAX_MOVE_VOICES, MOVE_REPEAT_WINDOW_MS } from './mix';
import { admitMoveVoice, type MoveVoice } from './moveVoices';

const voice = (key: string, own: boolean, startedMs: number): MoveVoice => ({ key, own, startedMs });

describe('admitMoveVoice', () => {
  it('plays freely under the cap', () => {
    expect(admitMoveVoice([voice('a', false, 0)], 'b', false, 500)).toEqual({ play: true, evict: null });
  });

  it('skips the same clip restarting within the repeat window, not after it', () => {
    const playing = [voice('a', false, 1000)];
    expect(admitMoveVoice(playing, 'a', false, 1000 + MOVE_REPEAT_WINDOW_MS - 1)).toEqual({ play: false });
    expect(admitMoveVoice(playing, 'a', false, 1000 + MOVE_REPEAT_WINDOW_MS)).toEqual({ play: true, evict: null });
  });

  it('lets your own clip through right after someone else’s quieter copy of it', () => {
    const playing = [voice('a', false, 1000)];
    expect(admitMoveVoice(playing, 'a', true, 1050)).toEqual({ play: true, evict: null });
    expect(admitMoveVoice([voice('a', true, 1000)], 'a', true, 1050)).toEqual({ play: false });
  });

  it('at the cap, replaces the oldest of everyone else’s clips, never an own one', () => {
    const own = voice('mine', true, 0);
    const older = voice('x', false, 100);
    const newer = voice('y', false, 200);
    const playing = [own, older, newer];
    expect(playing).toHaveLength(MAX_MOVE_VOICES);
    expect(admitMoveVoice(playing, 'z', false, 900)).toEqual({ play: true, evict: older });
    expect(admitMoveVoice(playing, 'z', true, 900)).toEqual({ play: true, evict: older });
  });

  it('with only own clips at the cap, another own clip still plays and anyone else’s is dropped', () => {
    const playing = [voice('a', true, 0), voice('b', true, 100), voice('c', true, 200)];
    expect(admitMoveVoice(playing, 'd', true, 900)).toEqual({ play: true, evict: null });
    expect(admitMoveVoice(playing, 'e', false, 900)).toEqual({ play: false });
  });
});
