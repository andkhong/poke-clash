import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../net/protocol';
import { CHAT_LOG_LIMIT } from '../../net/chat';
import { TEAM_A_COLOR_CSS, TEAM_B_COLOR_CSS } from '../teamColors';
import { appendChatMessage, chatSenderColor, chatSenderLabel, countUnread, formatChatTime, latestChatId } from './chatModel';

function msg(id: number, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    slotIndex: 0,
    speciesId: null,
    speciesName: null,
    team: null,
    spectatorName: null,
    balance: null,
    text: `m${id}`,
    sentAtMs: id * 1000,
    ...overrides,
  };
}

describe('appendChatMessage', () => {
  it('appends a new message', () => {
    expect(appendChatMessage([msg(1)], msg(2)).map((m) => m.id)).toEqual([1, 2]);
  });

  it('returns the same array (no re-render) for an id already present', () => {
    const log = [msg(1), msg(2)];
    expect(appendChatMessage(log, msg(2))).toBe(log);
  });

  it('drops the oldest once past the log limit', () => {
    let log: ChatMessage[] = [];
    for (let id = 1; id <= CHAT_LOG_LIMIT + 5; id++) log = appendChatMessage(log, msg(id));
    expect(log).toHaveLength(CHAT_LOG_LIMIT);
    expect(log[0].id).toBe(6);
    expect(log[log.length - 1].id).toBe(CHAT_LOG_LIMIT + 5);
  });
});

describe('chatSenderLabel', () => {
  it('shows the sender\'s name, with " (You)" only for this viewer\'s own', () => {
    const message = msg(1, { slotIndex: null, spectatorName: 'Slowpoke482' });
    expect(chatSenderLabel(message, null)).toBe('Slowpoke482');
    expect(chatSenderLabel(message, 'Eevee123')).toBe('Slowpoke482');
    expect(chatSenderLabel(message, 'Slowpoke482')).toBe('Slowpoke482 (You)');
  });

  it('shows the balance as snapshotted on the message', () => {
    expect(chatSenderLabel(msg(1, { slotIndex: null, spectatorName: 'Slowpoke482', balance: 1250 }), 'Slowpoke482')).toBe(
      'Slowpoke482 ($1,250) (You)'
    );
    expect(chatSenderLabel(msg(1, { slotIndex: null, spectatorName: 'Slowpoke482', balance: 0 }), null)).toBe('Slowpoke482 ($0)');
  });
});

describe('chatSenderColor', () => {
  it('uses the side color in a team room', () => {
    expect(chatSenderColor(msg(1, { team: 'teamA' }))).toBe(TEAM_A_COLOR_CSS);
    expect(chatSenderColor(msg(1, { team: 'teamB', slotIndex: 5 }))).toBe(TEAM_B_COLOR_CSS);
  });

  it('gives each of 8 seats a distinct, stable color outside team mode', () => {
    const colors = Array.from({ length: 8 }, (_, slotIndex) => chatSenderColor(msg(1, { slotIndex })));
    expect(new Set(colors).size).toBe(8);
    expect(chatSenderColor(msg(9, { slotIndex: 3 }))).toBe(colors[3]);
    expect(chatSenderColor(msg(1, { slotIndex: 8 }))).toBe(colors[0]);
  });

  it('gives an unseated sender a color stable per generated name, not per message', () => {
    const a = msg(1, { slotIndex: null, spectatorName: 'Slowpoke482' });
    const b = msg(2, { slotIndex: null, spectatorName: 'Slowpoke482' });
    const other = msg(3, { slotIndex: null, spectatorName: 'Eevee123' });
    expect(chatSenderColor(a)).toBe(chatSenderColor(b));
    // Not guaranteed distinct (small palette), but exercised so a change to
    // the hash isn't silently untested.
    expect(typeof chatSenderColor(other)).toBe('string');
  });
});

describe('unread bookkeeping', () => {
  it('counts messages newer than the last seen id', () => {
    const log = [msg(1), msg(2), msg(3)];
    expect(countUnread(log, 0)).toBe(3);
    expect(countUnread(log, 2)).toBe(1);
    expect(countUnread(log, 3)).toBe(0);
  });

  it('reports the newest id, or 0 for an empty log', () => {
    expect(latestChatId([])).toBe(0);
    expect(latestChatId([msg(4), msg(7)])).toBe(7);
  });
});

describe('formatChatTime', () => {
  it('renders zero-padded local HH:MM', () => {
    expect(formatChatTime(new Date(2026, 8, 10, 7, 5).getTime())).toBe('07:05');
    expect(formatChatTime(new Date(2026, 8, 10, 19, 34).getTime())).toBe('19:34');
  });
});
