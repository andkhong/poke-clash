import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { ChatMessage, RoomSummary } from '../../net/protocol';
import { CHAT_MAX_LENGTH, normalizeChatText, QUICK_REACTIONS } from '../../net/chat';
import { containsBlockedLanguage } from '../../net/chatFilter';
import { chatSenderColor, chatSenderLabel, formatChatTime, isSystemMessage } from './chatModel';
import { DESTRUCTIVE, PRIMARY, PRIMARY_TEXT, SUCCESS, TEXT, textAlpha } from '../theme';

export interface ChatPanelProps {
  messages: ChatMessage[];
  /** The local player's seat, or null when unseated. */
  mySlotIndex: number | null;
  /** This tab's generated spectator identity (see spectatorIdentity.ts) —
   * used to append " (You)" to an unseated sender's own messages. */
  mySpectatorName: string | null;
  room: RoomSummary | null;
  canSend: boolean;
  /** Resolves to null on success, or a machine error code (`rate_limited`,
   * `not_in_room`, `blocked_language`, `send_failed`, …) the panel turns into
   * a short notice. */
  onSend: (text: string) => Promise<string | null>;
  /** A fixed list height in px (the mobile lobby, which scrolls as a page),
   * or 'flex' to fill whatever flex column the panel is placed in (the web
   * sidebar and the mobile drawer). */
  listHeight?: number | 'flex';
  /** Stream-chat style `HH:MM` per line — on in the roomy web sidebar, off in
   * the narrow mobile drawer. */
  showTimestamps?: boolean;
}

const STATUS_NOTICE_MS = 2000;
const BLOCKED_NOTICE = 'Keep it clean — that message wasn’t sent';
// "Near enough" to the bottom that a new message should auto-scroll — a
// reader who has scrolled up to re-read keeps their place instead.
const NEAR_BOTTOM_PX = 40;

/** The message list + quick reactions + composer shared by every chat
 * surface (web sidebar, mobile drawer, mobile lobby). Layout-agnostic: the
 * parent decides how tall the list is. */
export function ChatPanel({
  messages,
  mySlotIndex,
  mySpectatorName,
  room,
  canSend,
  onSend,
  listHeight = 'flex',
  showTimestamps = false,
}: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [newBelow, setNewBelow] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToBottom = useCallback(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
    nearBottomRef.current = true;
    setNewBelow(false);
  }, []);

  // Layout effect so the initial backlog is already scrolled to its newest
  // line on the first painted frame rather than flashing the oldest.
  useLayoutEffect(() => {
    if (nearBottomRef.current) scrollToBottom();
    else if (messages.length > 0) setNewBelow(true);
  }, [messages, scrollToBottom]);

  useEffect(
    () => () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    },
    []
  );

  const handleScroll = () => {
    const list = listRef.current;
    if (!list) return;
    nearBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM_PX;
    if (nearBottomRef.current) setNewBelow(false);
  };

  const flashNotice = (text: string) => {
    setNotice(text);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), STATUS_NOTICE_MS);
  };

  const send = async (raw: string) => {
    const text = normalizeChatText(raw);
    if (text === null || !canSend || sending) return;
    // Same filter the server enforces (see chatFilter.ts), run here so the
    // sender is told immediately and the line never leaves the device. The
    // draft is left in the box to be edited rather than wiped.
    if (containsBlockedLanguage(text)) {
      flashNotice(BLOCKED_NOTICE);
      return;
    }
    setSending(true);
    const error = await onSend(text);
    setSending(false);
    if (error === null) {
      setDraft('');
      // Sending always brings you back to the live end, like a stream chat.
      scrollToBottom();
      return;
    }
    flashNotice(
      error === 'rate_limited'
        ? 'Slow down'
        : error === 'not_in_room'
          ? 'Join the room to chat'
          : error === 'blocked_language'
            ? BLOCKED_NOTICE
            : 'Couldn’t send'
    );
  };

  const listWrapStyle: CSSProperties =
    listHeight === 'flex' ? { ...listWrapBase, flex: 1, minHeight: 0 } : { ...listWrapBase, height: listHeight };

  return (
    <div style={listHeight === 'flex' ? { ...panelStyle, flex: 1, minHeight: 0 } : panelStyle}>
      <div style={listWrapStyle}>
        <div ref={listRef} onScroll={handleScroll} style={listStyle}>
          {messages.length === 0 && <p style={emptyStyle}>No messages yet.</p>}
          {messages.map((message) =>
            isSystemMessage(message) ? (
              // No sender, no colon — see isSystemMessage.
              <div key={message.id} style={systemRowStyle}>
                {showTimestamps && <span style={timeStyle}>{formatChatTime(message.sentAtMs)}</span>}
                <span>{message.text}</span>
              </div>
            ) : (
              <div key={message.id} style={rowStyle}>
                {showTimestamps && <span style={timeStyle}>{formatChatTime(message.sentAtMs)}</span>}
                <span style={{ color: chatSenderColor(message), fontWeight: 'bold', textTransform: 'capitalize' }}>{chatSenderLabel(message, mySlotIndex, room, mySpectatorName)}</span>
                <span style={{ opacity: 0.6 }}>: </span>
                <span>{message.text}</span>
              </div>
            )
          )}
        </div>
        {newBelow && (
          <button type="button" onClick={scrollToBottom} style={newBelowStyle}>
            ↓ New messages
          </button>
        )}
      </div>

      {notice && <p style={noticeStyle}>{notice}</p>}

      <div style={chipsRowStyle}>
        {QUICK_REACTIONS.map((reaction) => (
          <button
            key={reaction}
            type="button"
            onClick={() => void send(reaction)}
            disabled={!canSend || sending}
            style={{ ...chipStyle, opacity: canSend ? 1 : 0.4 }}
          >
            {reaction}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
        style={composerStyle}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          // iOS Safari pans the page to reveal a focused input and doesn't
          // always pan back — nothing on these screens ever scrolls the
          // window, so 0 is always the right place to return to.
          onBlur={() => window.scrollTo(0, 0)}
          placeholder={canSend ? 'Send a message' : 'Join the room to chat'}
          disabled={!canSend}
          maxLength={CHAT_MAX_LENGTH}
          enterKeyHint="send"
          autoComplete="off"
          autoCapitalize="sentences"
          aria-label="Chat message"
          style={inputStyle}
        />
        <button type="submit" disabled={!canSend || sending || normalizeChatText(draft) === null} style={sendButtonStyle}>
          SEND
        </button>
      </form>
    </div>
  );
}

const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontFamily: 'monospace',
  color: TEXT,
};

const listWrapBase: CSSProperties = {
  position: 'relative',
};

const listStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  padding: '4px 8px',
  boxSizing: 'border-box',
  background: textAlpha(0.06),
  borderRadius: 6,
};

const emptyStyle: CSSProperties = {
  margin: '8px 0',
  fontSize: 12,
  opacity: 0.5,
};

const rowStyle: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.45,
  padding: '2px 0',
  overflowWrap: 'anywhere',
};

const systemRowStyle: CSSProperties = {
  ...rowStyle,
  color: SUCCESS,
  fontStyle: 'italic',
};

const timeStyle: CSSProperties = {
  fontSize: 11,
  opacity: 0.45,
  marginRight: 6,
};

const newBelowStyle: CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: 8,
  transform: 'translateX(-50%)',
  padding: '5px 12px',
  fontSize: 11,
  fontFamily: 'monospace',
  fontWeight: 'bold',
  color: PRIMARY_TEXT,
  background: PRIMARY,
  border: 'none',
  borderRadius: 12,
  cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
};

const noticeStyle: CSSProperties = {
  margin: 0,
  fontSize: 11,
  color: DESTRUCTIVE,
};

const chipsRowStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
};

const chipStyle: CSSProperties = {
  flex: '1 0 auto',
  padding: '6px 10px',
  fontSize: 13,
  fontFamily: 'monospace',
  color: TEXT,
  background: textAlpha(0.08),
  border: `1px solid ${textAlpha(0.18)}`,
  borderRadius: 14,
  cursor: 'pointer',
};

const composerStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
};

// Mirrors SpeciesPicker's search input; 16px rather than 13 because iOS
// Safari zooms the page into any focused input smaller than that.
const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  boxSizing: 'border-box',
  fontSize: 16,
  fontFamily: 'monospace',
  padding: '8px 10px',
  borderRadius: 6,
  border: `1px solid ${textAlpha(0.2)}`,
  background: textAlpha(0.05),
  color: TEXT,
  outline: 'none',
};

const sendButtonStyle: CSSProperties = {
  padding: '8px 12px',
  fontSize: 11,
  fontFamily: 'monospace',
  fontWeight: 'bold',
  letterSpacing: 1,
  color: PRIMARY_TEXT,
  background: PRIMARY,
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
};
