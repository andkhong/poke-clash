import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { ChatMessage } from '../../net/protocol';
import { CHAT_MAX_LENGTH, normalizeChatText, QUICK_REACTIONS } from '../../net/chat';
import { containsBlockedLanguage } from '../../net/chatFilter';
import { chatSenderColor, chatSenderLabel, formatChatTime, isSystemMessage } from './chatModel';
import { ACTION, ACTION_BEVEL, DESTRUCTIVE, FONT_BODY, FONT_UI, INK, INK_MUTED, OUTLINE, PANEL, SUNK } from '../theme';
import { tapHeight } from '../crowd/hoenn';

export interface ChatPanelProps {
  messages: ChatMessage[];
  /** This viewer's display name — used to append " (You)" to their own messages. */
  mySpectatorName: string | null;
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
  /** The input's placeholder while canSend is false. */
  disabledPlaceholder?: string;
  /** Desktop sidebar density (mouse): 36 px controls and a one-line reaction
   * row instead of the 44 px touch tiles the phone drawer and lobby keep. */
  dense?: boolean;
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
  mySpectatorName,
  canSend,
  onSend,
  listHeight = 'flex',
  showTimestamps = false,
  disabledPlaceholder = 'Join the room to chat',
  dense = false,
}: ChatPanelProps) {
  const control = tapHeight(dense);
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
          : error === 'not_signed_up'
            ? 'Sign up to chat'
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
              <div key={message.id} style={dense ? denseRowStyle : rowStyle}>
                {showTimestamps && <span style={timeStyle}>{formatChatTime(message.sentAtMs)}</span>}
                <span style={{ color: chatSenderColor(message), fontWeight: 'bold', textTransform: 'capitalize' }}>
                  {chatSenderLabel(message, mySpectatorName)}
                </span>
                <span style={{ color: INK_MUTED }}>: </span>
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

      <div style={dense ? denseChipsRowStyle : chipsRowStyle}>
        {QUICK_REACTIONS.map((reaction) => (
          <button
            key={reaction}
            type="button"
            onClick={() => void send(reaction)}
            disabled={!canSend || sending}
            aria-label={`Send ${reaction}`}
            style={{ ...chipStyle, ...(dense ? denseChipStyle : null), opacity: canSend ? 1 : 0.4 }}
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
          placeholder={canSend ? 'Send a message' : disabledPlaceholder}
          disabled={!canSend}
          maxLength={CHAT_MAX_LENGTH}
          enterKeyHint="send"
          autoComplete="off"
          autoCapitalize="sentences"
          aria-label="Chat message"
          style={{ ...inputStyle, minHeight: control }}
        />
        <button
          type="submit"
          disabled={!canSend || sending || normalizeChatText(draft) === null}
          style={{ ...sendButtonStyle, minHeight: control, ...(dense ? denseSendStyle : null) }}
        >
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
  fontFamily: FONT_BODY,
  color: INK,
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
  background: PANEL,
  border: OUTLINE,
  borderRadius: 8,
};

const emptyStyle: CSSProperties = {
  margin: '8px 0',
  fontSize: 14,
  color: INK_MUTED,
};

const rowStyle: CSSProperties = {
  fontSize: 15,
  lineHeight: 1.45,
  padding: '2px 0',
  overflowWrap: 'anywhere',
};

const denseRowStyle: CSSProperties = { ...rowStyle, fontSize: 14, lineHeight: 1.4, padding: '1px 0' };

// Server-written lines (house picks, purchases) stay quiet so viewers' own
// messages stand out: smaller, muted, italic, never bold.
const systemRowStyle: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.35,
  padding: '1px 0',
  color: INK_MUTED,
  fontStyle: 'italic',
  overflowWrap: 'anywhere',
};

const timeStyle: CSSProperties = {
  fontSize: 12,
  color: INK_MUTED,
  marginRight: 6,
};

const newBelowStyle: CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: 8,
  transform: 'translateX(-50%)',
  minHeight: 32,
  padding: '0 10px',
  fontSize: 14,
  fontFamily: FONT_UI,
  fontWeight: 700,
  color: INK,
  background: ACTION,
  border: OUTLINE,
  borderRadius: 8,
  cursor: 'pointer',
  boxShadow: `inset 0 -3px 0 ${ACTION_BEVEL}`,
};

const noticeStyle: CSSProperties = {
  margin: 0,
  fontSize: 14,
  fontWeight: 'bold',
  color: DESTRUCTIVE,
};

const chipsRowStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
};

const chipStyle: CSSProperties = {
  flex: '1 0 auto',
  minHeight: 44,
  padding: '0 10px',
  fontSize: 16,
  fontFamily: FONT_UI,
  color: INK,
  background: PANEL,
  border: `2px solid ${INK}`,
  borderRadius: 8,
  boxShadow: `inset 0 -3px 0 ${SUNK}`,
  cursor: 'pointer',
};

// One tight row on desktop: chips size to their label instead of stretching into tiles.
const denseChipsRowStyle: CSSProperties = { display: 'flex', gap: 4 };

const denseChipStyle: CSSProperties = {
  flex: '1 1 0',
  minWidth: 0,
  minHeight: 32,
  padding: '0 4px',
  fontSize: 14,
  borderRadius: 6,
  boxShadow: `inset 0 -2px 0 ${SUNK}`,
};

const denseSendStyle: CSSProperties = { padding: '0 12px', fontSize: 15, borderWidth: 2, boxShadow: `inset 0 -3px 0 ${ACTION_BEVEL}` };

const composerStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
};

// Mirrors SpeciesPicker's search input; 16px because iOS Safari zooms the
// page into any focused input smaller than that.
const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 46,
  boxSizing: 'border-box',
  fontSize: 16,
  fontFamily: FONT_BODY,
  padding: '0 12px',
  borderRadius: 8,
  border: OUTLINE,
  background: PANEL,
  color: INK,
};

const sendButtonStyle: CSSProperties = {
  minHeight: 46,
  padding: '0 14px',
  fontSize: 18,
  fontFamily: FONT_UI,
  fontWeight: 700,
  color: INK,
  background: ACTION,
  border: OUTLINE,
  borderRadius: 8,
  boxShadow: `inset 0 -4px 0 ${ACTION_BEVEL}`,
  cursor: 'pointer',
};
