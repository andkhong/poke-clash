import { describe, expect, it } from 'vitest';
import { legacyRedirect, parseHash } from './useHashRoute';

describe('parseHash', () => {
  it('routes the landing, solo and online play hashes', () => {
    expect(parseHash('')).toEqual({ kind: 'landing' });
    expect(parseHash('#/')).toEqual({ kind: 'landing' });
    expect(parseHash('#/local')).toEqual({ kind: 'local' });
    expect(parseHash('#/play')).toEqual({ kind: 'play', roomId: null });
    expect(parseHash('#/play/ab12c')).toEqual({ kind: 'play', roomId: 'ab12c' });
    expect(parseHash('#/play/ab12c?watch')).toEqual({ kind: 'play', roomId: 'ab12c', watch: true });
    expect(parseHash('#/nope')).toEqual({ kind: 'landing' });
  });

  it('sends the sunset watch-mode links to the online room list', () => {
    expect(parseHash('#/rooms')).toEqual({ kind: 'play', roomId: null });
    expect(parseHash('#/room/room-6')).toEqual({ kind: 'play', roomId: null });
    expect(legacyRedirect('#/rooms')).toBe('#/play');
    expect(legacyRedirect('#/room/room-6')).toBe('#/play');
    expect(legacyRedirect('#/play')).toBeNull();
    expect(legacyRedirect('#/local')).toBeNull();
  });
});
