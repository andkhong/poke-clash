import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useIntl } from 'react-intl';
import type { ChatMessage } from '../../net/protocol';
import { ChatPanel, type ChatPanelProps } from './ChatPanel';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import {
  CHAT_TICKER_FADE_MS,
  CHAT_TICKER_MAX,
  CHAT_TICKER_MS,
  chatSenderColor,
  chatSenderLabel,
  countUnread,
  isSystemMessage,
  latestChatId,
} from './chatModel';
import { PredictionsPanel, type PredictionsPanelProps } from '../predictions/PredictionsPanel';
import { ShopPanel, type ShopPanelProps } from '../shop/ShopPanel';
import { CrowdCallPanel, type CrowdCallPanelProps } from '../crowd/CrowdCallPanel';
import { useCrowdCalls, type CrowdCallsStore } from '../crowd/crowdModel';
import { CROWD, FONT_BODY, FONT_UI, INFO_BOX, INK, PANEL, PRIMARY, PRIMARY_TEXT, SUCCESS, TEXT, bgAlpha } from '../theme';

export type ChatOverlayProps = Omit<ChatPanelProps, 'listHeight' | 'showTimestamps'> & {
  /** The room's predictions pool — gets its own 🔮 BET button beside 💬 CHAT
   * and its own tab in the drawer (see PredictionsPanel). */
  predictions?: PredictionsPanelProps;
  /** The room's item shop — a third tab beside CHAT and BETS, and a 🎒
   * button when collapsed (see ShopPanel). */
  shop?: ShopPanelProps;
  /** Play Mode's Crowd Call vote — the drawer's first tab, and a VOTE button that dots while a call is open. */
  vote?: CrowdCallPanelProps;
};

type DrawerTab = 'vote' | 'chat' | 'bets' | 'shop';

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
export const ChatOverlay = memo(function ChatOverlay({ vote, predictions, shop, ...props }: ChatOverlayProps) {
  const intl = useIntl();
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

  const closeLabel = intl.formatMessage({ id: 'chat.overlay.close', defaultMessage: 'Close' });
  if (openTab !== null) {
    return (
      <div style={{ ...drawerStyle, bottom: keyboardInset, maxHeight: `calc(100% - ${keyboardInset}px)` }}>
        <div style={drawerHeaderStyle}>
          <div role="tablist" style={tabRowStyle}>
            {vote && (
              <button
                type="button"
                role="tab"
                aria-selected={openTab === 'vote'}
                onClick={() => setOpenTab('vote')}
                style={tabStyle(openTab === 'vote', true)}
              >
                {intl.formatMessage({ id: 'chat.overlay.tab.vote', defaultMessage: 'Vote' })}
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={openTab === 'chat'}
              onClick={() => setOpenTab('chat')}
              style={tabStyle(openTab === 'chat')}
            >
              {intl.formatMessage({ id: 'chat.overlay.tab.chat', defaultMessage: 'Chat' })}
            </button>
            {predictions && (
              <button
                type="button"
                role="tab"
                aria-selected={openTab === 'bets'}
                onClick={() => setOpenTab('bets')}
                style={tabStyle(openTab === 'bets')}
              >
                {intl.formatMessage({ id: 'chat.overlay.tab.bet', defaultMessage: 'Bet' })}
              </button>
            )}
            {shop && (
              <button
                type="button"
                role="tab"
                aria-selected={openTab === 'shop'}
                onClick={() => setOpenTab('shop')}
                style={tabStyle(openTab === 'shop')}
              >
                {intl.formatMessage({ id: 'chat.overlay.tab.items', defaultMessage: 'Items' })}
              </button>
            )}
          </div>
          <button type="button" onClick={() => setOpenTab(null)} title={closeLabel} aria-label={closeLabel} style={closeButtonStyle}>
            ▾
          </button>
        </div>
        {openTab === 'vote' && vote ? (
          <div style={panelBodyStyle}>
            <CrowdCallPanel {...vote} />
          </div>
        ) : openTab === 'bets' && predictions ? (
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
  const voteLabel = intl.formatMessage({ id: 'chat.overlay.voteLabel', defaultMessage: 'Crowd Call vote' });
  const chatLabel = intl.formatMessage({ id: 'chat.overlay.chatLabel', defaultMessage: 'Chat' });
  const betsLabel = intl.formatMessage({ id: 'chat.overlay.betsLabel', defaultMessage: 'Predictions' });
  const shopLabel = intl.formatMessage({ id: 'chat.overlay.shopLabel', defaultMessage: 'Item shop' });
  const compact = [vote, predictions, shop].filter((panel) => panel !== undefined).length >= 2;

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
                  <span style={{ color: chatSenderColor(message), fontWeight: 'bold', textTransform: 'capitalize' }}>
                    {chatSenderLabel(message, props.mySpectatorName)}
                  </span>
                  <span style={{ opacity: 0.6 }}>: </span>
                  <span>{message.text}</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <div style={buttonRowStyle}>
        {vote && (
          <button
            type="button"
            onClick={() => setOpenTab('vote')}
            title={voteLabel}
            aria-label={voteLabel}
            style={{ ...chatButtonStyle, color: PANEL, background: CROWD }}
          >
            {intl.formatMessage({ id: 'chat.overlay.voteButton', defaultMessage: 'VOTE' })}
            <VotingDot calls={vote.calls} />
          </button>
        )}
        <button type="button" onClick={() => setOpenTab('chat')} title={chatLabel} aria-label={chatLabel} style={chatButtonStyle}>
          {compact ? '💬' : `💬 ${intl.formatMessage({ id: 'chat.overlay.chatButton', defaultMessage: 'CHAT' })}`}
          {unread > 0 && <span style={badgeStyle}>{unread > 99 ? '99+' : unread}</span>}
        </button>
        {predictions && (
          <button type="button" onClick={() => setOpenTab('bets')} title={betsLabel} aria-label={betsLabel} style={chatButtonStyle}>
            {compact ? '🔮' : `🔮 ${intl.formatMessage({ id: 'chat.overlay.betButton', defaultMessage: 'BET' })}`}
            {betStatus === 'open' && (compact ? <span style={dotStyle} aria-hidden /> : <span style={badgeStyle}>{intl.formatMessage({ id: 'chat.overlay.betOpen', defaultMessage: 'OPEN' })}</span>)}
          </button>
        )}
        {shop && (
          <button type="button" onClick={() => setOpenTab('shop')} title={shopLabel} aria-label={shopLabel} style={chatButtonStyle}>
            🎒
            {shopHasStock && <span style={dotStyle} aria-hidden />}
          </button>
        )}
      </div>
    </>
  );
});

/** Lights while a Crowd Call is taking votes; subscribes on its own so the overlay doesn't re-render at 4 Hz. */
function VotingDot({ calls }: { calls: CrowdCallsStore }) {
  const { current } = useCrowdCalls(calls);
  return current?.phase === 'voting' ? <span style={{ ...dotStyle, background: PANEL, width: 8, height: 8 }} aria-hidden /> : null;
}

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
  minHeight: 44,
  minWidth: 44,
  justifyContent: 'center',
  padding: '0 12px',
  fontSize: 18,
  fontFamily: FONT_UI,
  fontWeight: 700,
  color: INK,
  background: PANEL,
  border: `3px solid ${INK}`,
  borderRadius: 8,
  boxSizing: 'border-box',
  cursor: 'pointer',
  pointerEvents: 'auto',
};

const badgeStyle: CSSProperties = {
  minWidth: 16,
  padding: '1px 5px',
  fontSize: 10,
  color: PRIMARY_TEXT,
  background: PRIMARY,
  border: `1px solid ${INK}`,
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
  bottom: 'calc(max(16px, env(safe-area-inset-bottom)) + 52px)',
  maxWidth: '70%',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  pointerEvents: 'none',
};

const tickerRowStyle: CSSProperties = {
  fontSize: 12,
  fontFamily: FONT_BODY,
  lineHeight: 1.4,
  color: '#dee6ee',
  background: 'rgba(16,32,57,0.78)',
  padding: '4px 8px',
  borderRadius: 6,
  overflowWrap: 'anywhere',
  transition: `opacity ${CHAT_TICKER_FADE_MS}ms ease-out`,
};

const drawerStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  height: '55%',
  display: 'flex',
  flexDirection: 'column',
  boxSizing: 'border-box',
  background: bgAlpha(0.97),
  borderTop: `3px solid ${INK}`,
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
  alignItems: 'stretch',
  background: INFO_BOX,
  borderBottom: `3px solid ${INK}`,
  borderRadius: '12px 12px 0 0',
  overflow: 'hidden',
};

const tabRowStyle: CSSProperties = {
  flex: 1,
  display: 'grid',
  gridAutoFlow: 'column',
  gridAutoColumns: 'minmax(0, 1fr)',
};

/** Mock tabs: the selected one goes white with a bottom bar — crowd green for Vote, gold otherwise. */
function tabStyle(active: boolean, crowd = false): CSSProperties {
  return {
    minHeight: 50,
    fontSize: 19,
    fontFamily: FONT_UI,
    fontWeight: active ? 700 : 500,
    color: INK,
    background: active ? PANEL : 'transparent',
    border: 'none',
    boxShadow: active ? `inset 0 -4px 0 ${crowd ? CROWD : PRIMARY}` : 'none',
    cursor: 'pointer',
  };
}

const closeButtonStyle: CSSProperties = {
  width: 50,
  fontSize: 18,
  lineHeight: 1,
  color: TEXT,
  background: 'transparent',
  border: 'none',
  borderLeft: `3px solid ${INK}`,
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
