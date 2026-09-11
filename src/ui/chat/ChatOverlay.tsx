import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ChatMessage } from '../../net/protocol';
import { ChatPanel, type ChatPanelProps } from './ChatPanel';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { CHAT_TICKER_FADE_MS, CHAT_TICKER_MAX, CHAT_TICKER_MS, chatSenderColor, chatSenderLabel, countUnread, latestChatId } from './chatModel';

export type ChatOverlayProps = Omit<ChatPanelProps, 'listHeight' | 'showTimestamps'>;

interface TickerEntry {
  message: ChatMessage;
  fading: boolean;
}

/**
 * The mobile match chat, laid over the arena inside MatchScreen's stage box.
 * Two states of one control: collapsed, a `CHAT (n)` button bottom-left with
 * a short fading stack of the newest lines above it (so nobody has to open
 * anything to see a "GG" go by, and the map stays fully visible — the stack
 * ignores pointer events); expanded, a bottom-sheet drawer holding the full
 * ChatPanel. Nothing is drawn on the canvas itself: speech bubbles over
 * sprites were rejected because fainted players — the ones with the most
 * time to chat — have no sprite to anchor to.
 */
export function ChatOverlay(props: ChatOverlayProps) {
  const { messages } = props;
  const [open, setOpen] = useState(false);
  // Both baselines start at the newest backlog id so the hello snapshot
  // produces neither an unread badge nor a ticker flash on mount.
  const [lastSeenId, setLastSeenId] = useState(() => latestChatId(messages));
  const [ticker, setTicker] = useState<TickerEntry[]>([]);
  const lastTickerIdRef = useRef(latestChatId(messages));
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const keyboardInset = useKeyboardInset();

  useEffect(() => {
    const fresh = messages.filter((m) => m.id > lastTickerIdRef.current);
    if (fresh.length === 0) return;
    lastTickerIdRef.current = latestChatId(messages);
    // A line that arrives while the drawer is open is read right there — it
    // shouldn't then pop up in the ticker the moment the drawer closes.
    if (open) return;
    setTicker((current) => [...current, ...fresh.map((message) => ({ message, fading: false }))].slice(-CHAT_TICKER_MAX));
    const timers = timersRef.current;
    for (const message of fresh) {
      const fadeTimer = setTimeout(() => {
        timers.delete(fadeTimer);
        setTicker((current) => current.map((entry) => (entry.message.id === message.id ? { ...entry, fading: true } : entry)));
      }, CHAT_TICKER_MS - CHAT_TICKER_FADE_MS);
      const removeTimer = setTimeout(() => {
        timers.delete(removeTimer);
        setTicker((current) => current.filter((entry) => entry.message.id !== message.id));
      }, CHAT_TICKER_MS);
      timers.add(fadeTimer);
      timers.add(removeTimer);
    }
  }, [messages, open]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    if (open) setLastSeenId(latestChatId(messages));
  }, [open, messages]);

  if (open) {
    return (
      <div style={{ ...drawerStyle, bottom: keyboardInset, maxHeight: `calc(100% - ${keyboardInset}px)` }}>
        <div style={drawerHeaderStyle}>
          <span style={drawerTitleStyle}>CHAT</span>
          <button type="button" onClick={() => setOpen(false)} title="Close chat" aria-label="Close chat" style={closeButtonStyle}>
            ▾
          </button>
        </div>
        <div style={drawerBodyStyle}>
          <ChatPanel {...props} listHeight="flex" />
        </div>
      </div>
    );
  }

  const unread = countUnread(messages, lastSeenId);

  return (
    <>
      {ticker.length > 0 && (
        <div style={tickerStackStyle}>
          {ticker.map(({ message, fading }) => (
            <div key={message.id} style={{ ...tickerRowStyle, opacity: fading ? 0 : 1 }}>
              <span style={{ color: chatSenderColor(message), fontWeight: 'bold', textTransform: 'capitalize' }}>{chatSenderLabel(message, props.mySlotIndex, props.room)}</span>
              <span style={{ opacity: 0.6 }}>: </span>
              <span>{message.text}</span>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={() => setOpen(true)} style={chatButtonStyle}>
        💬 CHAT
        {unread > 0 && <span style={badgeStyle}>{unread > 99 ? '99+' : unread}</span>}
      </button>
    </>
  );
}

// Same corner treatment as MatchScreen's END MATCH button, mirrored to the
// left edge; the two never overlap, and in the complete phase the centered
// BACK TO ROOMS button clears this one at any phone width.
const chatButtonStyle: CSSProperties = {
  position: 'absolute',
  bottom: 'max(16px, env(safe-area-inset-bottom))',
  left: 'max(16px, env(safe-area-inset-left))',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  fontSize: 11,
  fontFamily: 'monospace',
  fontWeight: 'bold',
  letterSpacing: 1,
  color: '#e8e2d4',
  background: 'rgba(20,22,28,0.75)',
  border: '1px solid rgba(232,226,212,0.4)',
  borderRadius: 5,
  cursor: 'pointer',
  pointerEvents: 'auto',
};

const badgeStyle: CSSProperties = {
  minWidth: 16,
  padding: '1px 5px',
  fontSize: 10,
  color: '#20242c',
  background: '#e0b030',
  borderRadius: 8,
};

const tickerStackStyle: CSSProperties = {
  position: 'absolute',
  left: 'max(16px, env(safe-area-inset-left))',
  bottom: 'calc(max(16px, env(safe-area-inset-bottom)) + 40px)',
  maxWidth: '70%',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  pointerEvents: 'none',
};

const tickerRowStyle: CSSProperties = {
  fontSize: 12,
  fontFamily: 'monospace',
  lineHeight: 1.4,
  color: '#e8e2d4',
  background: 'rgba(20,22,28,0.75)',
  padding: '4px 8px',
  borderRadius: 6,
  overflowWrap: 'anywhere',
  transition: `opacity ${CHAT_TICKER_FADE_MS}ms ease-out`,
};

const drawerStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  height: '45%',
  display: 'flex',
  flexDirection: 'column',
  boxSizing: 'border-box',
  background: 'rgba(20,22,28,0.94)',
  borderTop: '1px solid rgba(232,226,212,0.25)',
  borderRadius: '12px 12px 0 0',
  pointerEvents: 'auto',
  zIndex: 2,
};

const drawerHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px 4px',
};

const drawerTitleStyle: CSSProperties = {
  fontSize: 12,
  fontFamily: 'monospace',
  fontWeight: 'bold',
  letterSpacing: 1,
  color: '#e8e2d4',
};

const closeButtonStyle: CSSProperties = {
  fontSize: 16,
  lineHeight: 1,
  padding: '2px 10px',
  color: '#e8e2d4',
  background: 'transparent',
  border: '1px solid rgba(232,226,212,0.3)',
  borderRadius: 4,
  cursor: 'pointer',
};

const drawerBodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  padding: '0 12px calc(8px + env(safe-area-inset-bottom))',
  boxSizing: 'border-box',
};
