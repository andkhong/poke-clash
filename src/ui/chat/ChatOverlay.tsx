import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ChatMessage } from '../../net/protocol';
import { ChatPanel, type ChatPanelProps } from './ChatPanel';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { CHAT_TICKER_FADE_MS, CHAT_TICKER_MAX, CHAT_TICKER_MS, chatSenderColor, chatSenderLabel, countUnread, isSystemMessage, latestChatId } from './chatModel';
import { PredictionsPanel, type PredictionsPanelProps } from '../predictions/PredictionsPanel';
import { ShopPanel, type ShopPanelProps } from '../shop/ShopPanel';
import { PRIMARY, PRIMARY_TEXT, SUCCESS, TEXT, bgAlpha, textAlpha } from '../theme';

export type ChatOverlayProps = Omit<ChatPanelProps, 'listHeight' | 'showTimestamps'> & {
  /** The room's predictions pool — gets its own 🔮 BET button beside 💬 CHAT
   * and its own tab in the drawer (see PredictionsPanel). */
  predictions?: PredictionsPanelProps;
  /** The room's item shop — a third tab beside CHAT and BETS, and a 🎒
   * button when collapsed (see ShopPanel). */
  shop?: ShopPanelProps;
};

type DrawerTab = 'chat' | 'bets' | 'shop';

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
 *
 * Memoized: MatchScreen re-renders on every HUD tick (10 Hz, see
 * useSimSnapshot) and none of this overlay's props come from the sim, so
 * without this the whole message list was re-rendered ten times a second.
 */
export const ChatOverlay = memo(function ChatOverlay({ predictions, shop, ...props }: ChatOverlayProps) {
  const { messages } = props;
  // Which drawer tab is showing, or null while the drawer is closed.
  const [openTab, setOpenTab] = useState<DrawerTab | null>(null);
  const open = openTab !== null;
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

  if (openTab !== null) {
    return (
      <div style={{ ...drawerStyle, bottom: keyboardInset, maxHeight: `calc(100% - ${keyboardInset}px)` }}>
        <div style={drawerHeaderStyle}>
          <div style={tabRowStyle}>
            <button type="button" onClick={() => setOpenTab('chat')} style={tabStyle(openTab === 'chat')}>
              💬 CHAT
            </button>
            {predictions && (
              <button type="button" onClick={() => setOpenTab('bets')} style={tabStyle(openTab === 'bets')}>
                🔮 BETS
              </button>
            )}
            {shop && (
              <button type="button" onClick={() => setOpenTab('shop')} style={tabStyle(openTab === 'shop')}>
                🎒 SHOP
              </button>
            )}
          </div>
          <button type="button" onClick={() => setOpenTab(null)} title="Close" aria-label="Close" style={closeButtonStyle}>
            ▾
          </button>
        </div>
        {openTab === 'bets' && predictions ? (
          <div style={panelBodyStyle}>
            <PredictionsPanel {...predictions} />
          </div>
        ) : openTab === 'shop' && shop ? (
          <div style={panelBodyStyle}>
            <ShopPanel {...shop} />
          </div>
        ) : (
          <div style={drawerBodyStyle}>
            <ChatPanel {...props} listHeight="flex" />
          </div>
        )}
      </div>
    );
  }

  const unread = countUnread(messages, lastSeenId);
  const betStatus = predictions?.prediction?.status ?? null;
  const shopHasStock = Object.values(shop?.shop?.stockLeft ?? {}).some((left) => left > 0);
  /** Three labelled buttons don't fit: the portrait arena's stage is only
   * ~360px wide on a phone, and `💬 CHAT` + `🔮 BET OPEN` + `🎒` measured
   * 255px against the ~218px the row has before it runs into MatchScreen's
   * bottom-right LEAVE ROOM control. With all three present they drop to
   * icons (and the bet badge to a dot), which is how a phone toolbar reads
   * anyway; with only two, the labels stay exactly as they were. */
  const compact = predictions !== undefined && shop !== undefined;

  return (
    <>
      {ticker.length > 0 && (
        <div style={tickerStackStyle}>
          {ticker.map(({ message, fading }) => (
            <div key={message.id} style={{ ...tickerRowStyle, opacity: fading ? 0 : 1 }}>
              {isSystemMessage(message) ? (
                // No sender — a shop announcement the server wrote.
                <span style={{ color: SUCCESS, fontStyle: 'italic' }}>{message.text}</span>
              ) : (
                <>
                  <span style={{ color: chatSenderColor(message), fontWeight: 'bold', textTransform: 'capitalize' }}>{chatSenderLabel(message, props.mySlotIndex, props.room, props.mySpectatorName)}</span>
                  <span style={{ opacity: 0.6 }}>: </span>
                  <span>{message.text}</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <div style={buttonRowStyle}>
        <button type="button" onClick={() => setOpenTab('chat')} title="Chat" aria-label="Chat" style={chatButtonStyle}>
          {compact ? '💬' : '💬 CHAT'}
          {unread > 0 && <span style={badgeStyle}>{unread > 99 ? '99+' : unread}</span>}
        </button>
        {predictions && (
          <button type="button" onClick={() => setOpenTab('bets')} title="Predictions" aria-label="Predictions" style={chatButtonStyle}>
            {compact ? '🔮' : '🔮 BET'}
            {betStatus === 'open' && (compact ? <span style={dotStyle} aria-hidden /> : <span style={badgeStyle}>OPEN</span>)}
          </button>
        )}
        {shop && (
          <button type="button" onClick={() => setOpenTab('shop')} title="Item shop" aria-label="Item shop" style={chatButtonStyle}>
            🎒
            {shopHasStock && <span style={dotStyle} aria-hidden />}
          </button>
        )}
      </div>
    </>
  );
});

// Same corner treatment as MatchScreen's END MATCH button, mirrored to the
// left edge; the two never overlap, and in the complete phase the centered
// BACK TO ROOMS button clears these at any phone width.
const buttonRowStyle: CSSProperties = {
  position: 'absolute',
  bottom: 'max(16px, env(safe-area-inset-bottom))',
  left: 'max(16px, env(safe-area-inset-left))',
  display: 'flex',
  gap: 8,
  pointerEvents: 'none',
};

const chatButtonStyle: CSSProperties = {
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
  color: PRIMARY_TEXT,
  background: PRIMARY,
  borderRadius: 8,
};

/** A bare dot instead of a count — the shop has nothing to count, only
 * "there is still something on the shelf". */
const dotStyle: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: SUCCESS,
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
  background: bgAlpha(0.97),
  borderTop: `1px solid ${textAlpha(0.2)}`,
  borderRadius: '12px 12px 0 0',
  pointerEvents: 'auto',
  zIndex: 2,
};

/** A drawer body holding a panel rather than the chat list: panels lay
 * themselves out and scroll as one block, and need the safe-area padding the
 * chat's own composer would otherwise provide. */
const panelBodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  padding: '0 4px calc(8px + env(safe-area-inset-bottom))',
};

const drawerHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px 4px',
};

const tabRowStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
};

function tabStyle(active: boolean): CSSProperties {
  return {
    fontSize: 12,
    fontFamily: 'monospace',
    fontWeight: 'bold',
    letterSpacing: 1,
    padding: '4px 10px',
    color: active ? PRIMARY_TEXT : TEXT,
    background: active ? PRIMARY : 'transparent',
    border: `1px solid ${active ? PRIMARY : textAlpha(0.25)}`,
    borderRadius: 4,
    cursor: 'pointer',
  };
}

const closeButtonStyle: CSSProperties = {
  fontSize: 16,
  lineHeight: 1,
  padding: '2px 10px',
  color: TEXT,
  background: 'transparent',
  border: `1px solid ${textAlpha(0.25)}`,
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
