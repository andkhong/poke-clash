import type { ChatMessage, RoomSummary } from '../../net/protocol';
import { CHAT_LOG_LIMIT } from '../../net/chat';
import { teamColorCss } from '../teamColors';
import { SOLARIZED_ACCENTS } from '../theme';

/** Pure chat-presentation logic, kept out of the components so it can be
 * unit-tested under Vitest's node environment (no DOM). */

/** Mobile ticker (the collapsed match chat): how many recent lines stay on
 * screen, and for how long before they fade. Three lines rather than one so a
 * burst from a full room doesn't drop messages before anyone reads them. */
export const CHAT_TICKER_MAX = 3;
export const CHAT_TICKER_MS = 6000;
export const CHAT_TICKER_FADE_MS = 800;

/** Web layout: the Twitch-style chat column beside the arena, shown once the
 * viewport is at least this wide. A width breakpoint rather than a device
 * check, so a narrowed desktop window degrades to the mobile overlay and a
 * tablet gets the column. */
export const CHAT_SIDEBAR_WIDTH = 340;
export const CHAT_SIDEBAR_MIN_WIDTH_PX = 900;
export const CHAT_SIDEBAR_MEDIA_QUERY = `(min-width: ${CHAT_SIDEBAR_MIN_WIDTH_PX}px)`;

/** The log with `message` appended — or the very same array if a message
 * with that id is already present, which happens whenever an SSE reconnect's
 * `hello` backlog and a live `chat` frame overlap (and under React
 * StrictMode's double-invoked handlers). Trimmed to the server's own limit. */
export function appendChatMessage(log: ChatMessage[], message: ChatMessage): ChatMessage[] {
  if (log.some((m) => m.id === message.id)) return log;
  const next = [...log, message];
  return next.length > CHAT_LOG_LIMIT ? next.slice(next.length - CHAT_LOG_LIMIT) : next;
}

/** Who to show as the sender. A seated player is known by their pick, same
 * as ever: "You" for the local seat, otherwise the seat's *current* species
 * name (a message sent before picking upgrades from "Seat N" to the species
 * once they pick), falling back to the name snapshotted on the message, then
 * the seat number. Every room supports chat now (see spectatorIdentity.ts),
 * so an unseated sender (message.slotIndex null) shows their generated
 * display name instead — "You" when it's this tab's own. */
export function chatSenderLabel(
  message: ChatMessage,
  mySlotIndex: number | null,
  room: RoomSummary | null,
  mySpectatorName: string | null
): string {
  if (message.slotIndex === null) {
    if (mySpectatorName !== null && message.spectatorName === mySpectatorName) return 'You';
    return message.spectatorName ?? 'Spectator';
  }
  if (mySlotIndex !== null && message.slotIndex === mySlotIndex) return 'You';
  const liveName = room?.slots[message.slotIndex]?.speciesName ?? null;
  return liveName ?? message.speciesName ?? `Seat ${message.slotIndex + 1}`;
}

// Eight hues that read on the light chat background — one per seat, Twitch
// style, so a reader can follow a sender by color alone.
const SENDER_PALETTE = SOLARIZED_ACCENTS;

/** Stable string hash → palette index, so a spectator's generated name (no
 * slotIndex to key off) still gets a consistent color across messages. */
function hashPaletteIndex(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(hash) % SENDER_PALETTE.length;
}

/** Name color: the side's color in a team room (matching the roster HUD and
 * the sprite's team ring), otherwise a stable per-seat hue, or — for an
 * unseated sender — a hue stable per generated name instead. */
export function chatSenderColor(message: ChatMessage): string {
  const teamColor = teamColorCss(message.team ?? undefined);
  if (teamColor) return teamColor;
  if (message.slotIndex !== null) return SENDER_PALETTE[message.slotIndex % SENDER_PALETTE.length];
  return SENDER_PALETTE[hashPaletteIndex(message.spectatorName ?? '')];
}

/** Id of the newest message, or 0 for an empty log (ids start at 1). */
export function latestChatId(log: ChatMessage[]): number {
  return log.length === 0 ? 0 : log[log.length - 1].id;
}

export function countUnread(log: ChatMessage[], lastSeenId: number): number {
  let unread = 0;
  for (const message of log) if (message.id > lastSeenId) unread += 1;
  return unread;
}

/** Local-time `HH:MM`, the way a stream chat stamps lines. */
export function formatChatTime(sentAtMs: number): string {
  const date = new Date(sentAtMs);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
