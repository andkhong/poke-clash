import { describe, expect, it } from 'vitest';
import { CHAT_MAX_LENGTH, normalizeChatText, QUICK_REACTIONS } from './chat';

const BELL = String.fromCharCode(7);
const NEWLINE = String.fromCharCode(10);
const DEL = String.fromCharCode(127);
const C1 = String.fromCharCode(0x85);

describe('normalizeChatText', () => {
  it('trims surrounding whitespace and keeps the rest verbatim', () => {
    expect(normalizeChatText('  gg  wp  ')).toBe('gg  wp');
  });

  it('strips C0/C1 control characters, DEL and newlines before trimming', () => {
    expect(normalizeChatText(`${BELL}hi ${NEWLINE}`)).toBe('hi');
    expect(normalizeChatText(`a${DEL}b${C1}c`)).toBe('abc');
  });

  it('rejects a message with nothing sendable left', () => {
    expect(normalizeChatText('')).toBeNull();
    expect(normalizeChatText('   ')).toBeNull();
    expect(normalizeChatText(`${BELL}${NEWLINE}`)).toBeNull();
  });

  it('accepts exactly CHAT_MAX_LENGTH characters and rejects one more', () => {
    expect(normalizeChatText('x'.repeat(CHAT_MAX_LENGTH))).toHaveLength(CHAT_MAX_LENGTH);
    expect(normalizeChatText('x'.repeat(CHAT_MAX_LENGTH + 1))).toBeNull();
  });

  it('keeps emoji intact', () => {
    expect(normalizeChatText('🔥🔥')).toBe('🔥🔥');
  });

  it('passes every quick reaction through unchanged', () => {
    for (const reaction of QUICK_REACTIONS) expect(normalizeChatText(reaction)).toBe(reaction);
  });
});
