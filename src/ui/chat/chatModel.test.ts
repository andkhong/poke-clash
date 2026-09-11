import { describe, expect, it } from 'vitest';
import type { ChatMessage, RoomSummary } from '../../net/protocol';
import { CHAT_LOG_LIMIT } from '../../net/chat';
import { TEAM_A_COLOR_CSS, TEAM_B_COLOR_CSS } from '../teamColors';
import { appendChatMessage, chatSenderColor, chatSenderLabel, countUnread, formatChatTime, latestChatId } from './chatModel';

function msg(id: number, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id, slotIndex: 0, speciesId: null, speciesName: null, team: null, text: `m${id}`, sentAtMs: id * 1000, ...overrides };
}

function roomWith(speciesNames: Array<string | null>): RoomSummary {
  return {
    id: 'room-1',
    name: 'Room 1',
    mode: 'classic',
    phase: 'countdown',
    slots: speciesNames.map((speciesName, slotIndex) => ({
      slotIndex,
      playerId: `p${slotIndex}`,
      speciesId: speciesName ? slotIndex + 1 : null,
      speciesName,
      isAutoFilled: false,
      team: null,
    })),
    countdownEndsAtMs: null,
    bossSpeciesName: null,
    capacity: speciesNames.length,
    arena: { width: 900, height: 1950 },
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
  it('is "You" for the local seat', () => {
    expect(chatSenderLabel(msg(1, { slotIndex: 2 }), 2, roomWith(['Aipom', 'Litleo', 'Skiddo']))).toBe('You');
  });

  it('prefers the seat\'s live species name, so a pre-pick message upgrades once they pick', () => {
    const message = msg(1, { slotIndex: 1, speciesName: null });
    expect(chatSenderLabel(message, 0, roomWith(['Aipom', null]))).toBe('Seat 2');
    expect(chatSenderLabel(message, 0, roomWith(['Aipom', 'Litleo']))).toBe('Litleo');
  });

  it('falls back to the snapshotted name, then the seat number, without a room', () => {
    expect(chatSenderLabel(msg(1, { slotIndex: 3, speciesName: 'Burmy' }), null, null)).toBe('Burmy');
    expect(chatSenderLabel(msg(1, { slotIndex: 3 }), null, null)).toBe('Seat 4');
  });

  it('never labels anyone "You" for a spectator', () => {
    expect(chatSenderLabel(msg(1, { slotIndex: 0, speciesName: 'Aipom' }), null, null)).toBe('Aipom');
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
