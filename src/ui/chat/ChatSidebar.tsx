import { memo, useEffect, useState, type CSSProperties } from 'react';
import { ChatPanel, type ChatPanelProps } from './ChatPanel';
import { CHAT_SIDEBAR_WIDTH, countUnread, latestChatId } from './chatModel';
import { PredictionsPanel, type PredictionsPanelProps } from '../predictions/PredictionsPanel';
import { ShopPanel, type ShopPanelProps } from '../shop/ShopPanel';
import { CrowdCallPanel, type CrowdCallPanelProps } from '../crowd/CrowdCallPanel';
import { BG_ALT, CROWD, FONT_BODY, FONT_UI, INFO_BOX, INK, PRIMARY, PRIMARY_TEXT, SUCCESS, TEXT, textAlpha } from '../theme';

// Memoized here (ChatPanel itself isn't) so a vote/bet update re-rendering the sidebar leaves the chat list alone.
const MemoChatPanel = memo(ChatPanel);

const COLLAPSED_STORAGE_KEY = 'poke-clash:chat-sidebar-collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    // Private browsing / storage disabled — the choice just won't persist.
  }
}

export type ChatSidebarProps = ChatPanelProps & {
  /** The room's predictions pool, in the column's top region above the chat
   * (see PredictionsPanel). Omitted where a room has none to show. */
  predictions?: PredictionsPanelProps;
  /** The room's item shop, sharing that same region behind a tab rather than
   * stacking under it (see ShopPanel) — the region is capped so the chat
   * keeps its share of the column, and a third stacked panel would eat into
   * that every time an item is added. */
  shop?: ShopPanelProps;
  /** Play Mode's Crowd Call vote — the first tab of that same region. */
  vote?: CrowdCallPanelProps;
  /** Overrides CHAT_SIDEBAR_WIDTH — the landing page's embedded preview
   * passes a narrower one (see chatModel.ts's CHAT_SIDEBAR_EMBEDDED_WIDTH). */
  width?: number;
};

/** Which of the two panels the column's top region is showing. */
type TopTab = 'vote' | 'bets' | 'shop';

/** The web layout's stream-style right column, rendered by RoomScreen to the
 * right of the arena (lobby and match alike): the betting pool / item shop on
 * top, chat below. Collapsible to a narrow strip that keeps an unread badge,
 * like a stream page's "hide chat". */
export function ChatSidebar({ vote, predictions, shop, width = CHAT_SIDEBAR_WIDTH, ...props }: ChatSidebarProps) {
  const { messages, room } = props;
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [lastSeenId, setLastSeenId] = useState(() => latestChatId(messages));
  const [topTab, setTopTab] = useState<TopTab>(vote ? 'vote' : 'bets');

  // While expanded everything is "seen"; the badge only accrues while hidden.
  useEffect(() => {
    if (!collapsed) setLastSeenId(latestChatId(messages));
  }, [collapsed, messages]);

  const toggle = () => {
    setCollapsed((current) => {
      writeCollapsed(!current);
      return !current;
    });
  };

  if (collapsed) {
    const unread = countUnread(messages, lastSeenId);
    return (
      <aside style={stripStyle}>
        <button type="button" onClick={toggle} title="Show chat" aria-label="Show chat" style={stripButtonStyle}>
          💬
          {unread > 0 && <span style={badgeStyle}>{unread > 99 ? '99+' : unread}</span>}
        </button>
      </aside>
    );
  }

  const seated = room ? room.slots.filter((s) => s.occupied).length : 0;
  // With only one panel to show there's no tab row, so whichever exists
  // simply fills the region.
  const tabs = (
    [
      ['vote', vote, 'VOTE'],
      ['bets', predictions, 'BETS'],
      ['shop', shop, 'ITEMS'],
    ] as const
  ).filter(([, panel]) => panel !== undefined);
  const shown = tabs.some(([id]) => id === topTab) ? topTab : tabs[0]?.[0];
  const shopHasStock = Object.values(shop?.shop?.stockLeft ?? {}).some((left) => left > 0);

  return (
    <aside style={{ ...sidebarStyle, width }}>
      {tabs.length > 0 && (
        <div style={topRegionStyle}>
          {tabs.length > 1 && (
            <div role="tablist" style={topTabRowStyle}>
              {tabs.map(([id, , label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={shown === id}
                  onClick={() => setTopTab(id)}
                  style={topTabStyle(shown === id, id === 'vote')}
                >
                  {label}
                  {id === 'shop' && shopHasStock && <span style={dotStyle} aria-hidden />}
                </button>
              ))}
            </div>
          )}
          <div style={topBodyStyle}>
            {shown === 'vote' && vote ? (
              <CrowdCallPanel {...vote} />
            ) : shown === 'shop' && shop ? (
              <ShopPanel {...shop} />
            ) : predictions ? (
              <PredictionsPanel {...predictions} />
            ) : null}
          </div>
        </div>
      )}
      <header style={headerStyle}>
        <button type="button" onClick={toggle} title="Hide chat" aria-label="Hide chat" style={headerButtonStyle}>
          ⇥
        </button>
        <span style={titleStyle}>CHAT</span>
        {room && (
          <span style={roomMetaStyle}>
            {room.name} · {seated}/{room.capacity}
          </span>
        )}
      </header>
      <div style={bodyStyle}>
        <MemoChatPanel {...props} listHeight="flex" showTimestamps />
      </div>
    </aside>
  );
}

const sidebarStyle: CSSProperties = {
  width: CHAT_SIDEBAR_WIDTH,
  flex: 'none',
  height: '100%',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  background: BG_ALT,
  borderLeft: `3px solid ${INK}`,
  fontFamily: FONT_BODY,
  color: TEXT,
};

// Capped so an 8-fighter showcase pool can't crowd the chat out entirely —
// past the cap the panel scrolls within itself and the chat keeps its share.
// The cap is on the region, not on either panel, which is the point of
// tabbing the two rather than stacking them: adding the shop (and later,
// items to it) costs the chat nothing.
const topRegionStyle: CSSProperties = {
  flex: 'none',
  display: 'flex',
  flexDirection: 'column',
  maxHeight: '58%',
  minHeight: 0,
};

const topTabRowStyle: CSSProperties = {
  display: 'grid',
  gridAutoFlow: 'column',
  gridAutoColumns: 'minmax(0, 1fr)',
  flex: 'none',
  background: INFO_BOX,
  borderBottom: `3px solid ${INK}`,
};

/** Mock tabs: the selected one goes white with a bottom bar — crowd green for VOTE, gold otherwise. */
function topTabStyle(active: boolean, crowd: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minHeight: 46,
    fontSize: 18,
    fontFamily: FONT_UI,
    fontWeight: active ? 700 : 500,
    color: INK,
    background: active ? BG_ALT : 'transparent',
    border: 'none',
    boxShadow: active ? `inset 0 -4px 0 ${crowd ? CROWD : PRIMARY}` : 'none',
    cursor: 'pointer',
  };
}

const topBodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  borderBottom: `1px solid ${textAlpha(0.12)}`,
};

/** Marks a shelf that still has stock — the shop has nothing to count. */
const dotStyle: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: SUCCESS,
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  borderBottom: `1px solid ${textAlpha(0.12)}`,
};

const titleStyle: CSSProperties = {
  fontSize: 18,
  fontFamily: FONT_UI,
  fontWeight: 700,
};

const roomMetaStyle: CSSProperties = {
  marginLeft: 'auto',
  fontSize: 11,
  opacity: 0.6,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const headerButtonStyle: CSSProperties = {
  fontSize: 16,
  lineHeight: 1,
  minWidth: 44,
  minHeight: 44,
  color: TEXT,
  background: 'transparent',
  border: `1px solid ${textAlpha(0.15)}`,
  borderRadius: 4,
  cursor: 'pointer',
};

const bodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  padding: 10,
  boxSizing: 'border-box',
};

const stripStyle: CSSProperties = {
  width: 40,
  flex: 'none',
  height: '100%',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  paddingTop: 8,
  background: BG_ALT,
  borderLeft: `1px solid ${textAlpha(0.12)}`,
};

const stripButtonStyle: CSSProperties = {
  position: 'relative',
  fontSize: 16,
  lineHeight: 1,
  padding: '6px 4px',
  background: 'transparent',
  border: `1px solid ${textAlpha(0.15)}`,
  borderRadius: 4,
  cursor: 'pointer',
};

const badgeStyle: CSSProperties = {
  position: 'absolute',
  top: -6,
  right: -8,
  minWidth: 16,
  padding: '1px 4px',
  fontSize: 10,
  fontFamily: FONT_BODY,
  fontWeight: 'bold',
  color: PRIMARY_TEXT,
  background: PRIMARY,
  borderRadius: 8,
};
