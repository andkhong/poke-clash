import { describe, expect, it } from 'vitest';
import { playableFrameCount, type MoveAnimationCell, type MoveAnimationFrame } from './moveAnimationFormat';

const cell: MoveAnimationCell = [128, 224, 100, 100, 0, 0, 0, 5, 255, 1, 2, 0];
const drawn: MoveAnimationFrame = { u: null, t: null, c: [cell] };
const idle: MoveAnimationFrame = { u: [0, 0, 255, 1], t: null, c: [] };
const bare: MoveAnimationFrame = { u: null, t: null, c: [] };

describe('playableFrameCount', () => {
  it('drops a trailing run of frames that draw nothing and leave the battlers alone', () => {
    expect(playableFrameCount([drawn, drawn, idle, bare, idle])).toBe(2); // Explosion's shape: smoke, then a wait
    expect(playableFrameCount([drawn, idle, drawn])).toBe(3); // an idle frame in the middle is a real pause
    expect(playableFrameCount([drawn])).toBe(1);
  });

  it('keeps a tail that still moves, fades or hides a battler', () => {
    expect(playableFrameCount([drawn, { u: [40, -20, 255, 1], t: null, c: [] }])).toBe(2); // a dash's return
    expect(playableFrameCount([drawn, { u: null, t: [0, 0, 128, 1], c: [] }])).toBe(2); // a fading target
    expect(playableFrameCount([drawn, { u: [0, 0, 255, 0], t: null, c: [] }])).toBe(2); // Fly's hidden user
  });

  it('is zero for an animation that never does anything', () => {
    expect(playableFrameCount([])).toBe(0);
    expect(playableFrameCount([idle, bare])).toBe(0);
  });
});
