import { useEffect, useState, type CSSProperties } from 'react';
import { ChatPanel, type ChatPanelProps } from './ChatPanel';
import { CHAT_SIDEBAR_WIDTH, countUnread, latestChatId } from './chatModel';
import { PredictionsPanel, type PredictionsPanelProps } from '../predictions/PredictionsPanel';
import { BG_ALT, PRIMARY, PRIMARY_TEXT, TEXT, textAlpha } from '../theme';

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
  /** The room's predictions pool, stacked above the chat in the same column
   * (see PredictionsPanel). Omitted where a room has none to show. */
  predictions?: PredictionsPanelProps;
};

/** The web layout's stream-style right column, rendered by RoomScreen to the
 * right of the arena (lobby and match alike): the predictions pool on top,
 * chat below. Collapsible to a narrow strip that keeps an unread badge, like
 * a stream page's "hide chat". */
export function ChatSidebar({ predictions, ...props }: ChatSidebarProps) {
  const { messages, room } = props;
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [lastSeenId, setLastSeenId] = useState(() => latestChatId(messages));

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

  return (
    <aside style={sidebarStyle}>
      {predictions && (
        <div style={predictionsWrapStyle}>
          <PredictionsPanel {...predictions} />
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
        <ChatPanel {...props} listHeight="flex" showTimestamps />
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
  borderLeft: `1px solid ${textAlpha(0.12)}`,
  fontFamily: 'monospace',
  color: TEXT,
};

// Capped so an 8-fighter showcase pool can't crowd the chat out entirely —
// past the cap the pool scrolls within itself and the chat keeps its share.
const predictionsWrapStyle: CSSProperties = {
  flex: 'none',
  maxHeight: '58%',
  overflowY: 'auto',
  overscrollBehavior: 'contain',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  borderBottom: `1px solid ${textAlpha(0.12)}`,
};

const titleStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 'bold',
  letterSpacing: 1,
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
  fontSize: 14,
  lineHeight: 1,
  padding: '4px 6px',
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
  fontFamily: 'monospace',
  fontWeight: 'bold',
  color: PRIMARY_TEXT,
  background: PRIMARY,
  borderRadius: 8,
};
