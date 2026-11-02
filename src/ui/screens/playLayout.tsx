import type { CSSProperties } from 'react';
import { useIntl } from 'react-intl';
import { FONT_BODY, FONT_UI, FRAME, GROUND, INFO_BOX, INK, INK_MUTED, OUTLINE, PANEL } from '../theme';

// The shell every Play screen shares (solo setup, online rooms, lobby): white top bar, one column, outlined cards.

export function TopBar({ title, subtitle, backHref }: { title: string; subtitle?: string; backHref: string }) {
  const intl = useIntl();
  return (
    <header style={topBarStyle}>
      <a href={backHref} aria-label={intl.formatMessage({ id: 'play.topBar.back', defaultMessage: 'Back' })} style={backButton}>
        ◀
      </a>
      <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <h1 style={{ margin: 0, fontFamily: FONT_UI, fontWeight: 700, fontSize: 28 }}>{title}</h1>
        {subtitle && <span style={{ fontSize: 14, color: INK_MUTED }}>{subtitle}</span>}
      </div>
    </header>
  );
}

export const pageStyle: CSSProperties = {
  width: '100%',
  minHeight: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 18,
  boxSizing: 'border-box',
  fontFamily: FONT_BODY,
  color: INK,
  background: GROUND,
  paddingBottom: 24,
};
export const topBarStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  flexWrap: 'wrap',
  padding: '10px 16px',
  background: PANEL,
  borderBottom: OUTLINE,
};
export const columnStyle: CSSProperties = {
  width: '100%',
  maxWidth: 640,
  padding: '0 16px',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};
export const cardStyle: CSSProperties = {
  borderRadius: 8,
  border: OUTLINE,
  background: PANEL,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};
export const headingStyle: CSSProperties = { margin: 0, fontFamily: FONT_UI, fontWeight: 700, fontSize: 22 };
export const bodyText: CSSProperties = { margin: 0, fontSize: 15, lineHeight: 1.45 };
export const backButton: CSSProperties = {
  width: 46,
  height: 46,
  flex: 'none',
  display: 'grid',
  placeItems: 'center',
  borderRadius: 8,
  border: OUTLINE,
  boxSizing: 'border-box',
  color: INK,
  textDecoration: 'none',
  fontSize: 16,
};
export const pickerSection: CSSProperties = {
  borderRadius: 8,
  background: PANEL,
  border: OUTLINE,
  boxShadow: `inset 0 0 0 3px ${PANEL}, inset 0 0 0 6px ${FRAME}`,
  padding: 18,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};
export const chosenPreview: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '4px 16px 4px 4px',
  borderRadius: 8,
  border: OUTLINE,
  background: INFO_BOX,
};
