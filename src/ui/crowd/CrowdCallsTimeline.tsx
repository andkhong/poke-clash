import type { CrowdCallView } from '../../net/play/playProtocol';
import { FONT_BODY, FONT_UI, INK, INK_MUTED } from '../theme';
import { TEAM_A_COLOR_CSS, TEAM_B_COLOR_CSS } from '../teamColors';
import { formatClock, winnerLabel } from './crowdModel';

/** Results' "Crowd Calls this match": when each call landed and what each side got. */
export function CrowdCallsTimeline({ history }: { history: CrowdCallView[] }) {
  const landed = history.filter((c) => c.sides.teamA.winner || c.sides.teamB.winner);
  const votes = landed.reduce(
    (sum, c) =>
      sum +
      Object.values(c.sides.teamA.votes).reduce((a, b) => a + (b ?? 0), 0) +
      Object.values(c.sides.teamB.votes).reduce((a, b) => a + (b ?? 0), 0),
    0
  );
  return (
    <section
      aria-label="Crowd Calls this match"
      style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: FONT_BODY, color: INK }}
    >
      <h3 style={{ margin: 0, fontFamily: FONT_UI, fontSize: 20 }}>Crowd Calls this match</h3>
      {landed.length === 0 ? (
        <p style={{ margin: 0, fontSize: 14, color: INK_MUTED }}>No calls landed this match.</p>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 15 }}>
          <li style={{ ...row, color: INK_MUTED, fontSize: 13 }}>
            <span />
            <span>Ruby</span>
            <span>Sapphire</span>
          </li>
          {landed.map((c) => (
            <li key={c.index} style={row}>
              <span style={{ fontFamily: FONT_UI, color: INK_MUTED }}>{formatClock(c.landsAtMs)}</span>
              <span style={{ color: TEAM_A_COLOR_CSS, fontWeight: 700 }}>{winnerLabel(c.sides.teamA) ?? '—'}</span>
              <span style={{ color: TEAM_B_COLOR_CSS, fontWeight: 700 }}>{winnerLabel(c.sides.teamB) ?? '—'}</span>
            </li>
          ))}
        </ol>
      )}
      <span style={{ fontSize: 13, color: INK_MUTED }}>{votes} votes cast</span>
    </section>
  );
}

const row = { display: 'grid', gridTemplateColumns: '44px 1fr 1fr', gap: 8, alignItems: 'center', padding: '2px 4px' } as const;
