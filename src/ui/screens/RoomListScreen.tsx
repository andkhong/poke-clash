import { useEffect, useState, type CSSProperties } from 'react';
import type { RoomMode, RoomPhase, RoomSummary } from '../../net/protocol';
import { teamSizeForMode } from '../../net/protocol';
import { useCountdown } from '../../net/useCountdown';
import { IS_MOBILE_DEVICE, resolveMatchArena } from '../../app/config';
import { useWideArenaPreference } from '../hooks/useWideArenaPreference';
import { TEAM_A_COLOR_CSS } from '../teamColors';

const POLL_INTERVAL_MS = 2000;
const TEAM_MODES: RoomMode[] = ['team2', 'team3', 'team4', 'team8'];

const PHASE_LABEL: Record<RoomPhase, string> = {
  idle: 'OPEN',
  countdown: 'STARTING',
  battle: 'IN BATTLE',
  complete: 'FINISHED',
};

export function RoomListScreen() {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [wideArena, setWideArena] = useWideArenaPreference();

  useEffect(() => {
    let cancelled = false;
    const fetchRooms = () => {
      fetch('/api/rooms')
        .then((res) => res.json())
        .then((data: { rooms: RoomSummary[] }) => {
          if (!cancelled) {
            setRooms(data.rooms);
            setError(null);
          }
        })
        .catch(() => {
          // The game-server (npm run game-server:serve, or npm run dev:all)
          // isn't reachable — surface this instead of leaving the list stuck
          // empty with no explanation.
          if (!cancelled) setError('Can’t reach the multiplayer server. Is game-server running?');
        });
    };
    fetchRooms();
    const interval = setInterval(fetchRooms, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const createRoom = (mode: RoomMode) => {
    fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, arena: resolveMatchArena(wideArena) }),
    })
      .then((res) => res.json())
      .then((data: { room: RoomSummary }) => {
        window.location.hash = `#/room/${data.room.id}`;
      })
      .catch(() => {
        setError('Couldn’t create a room — the multiplayer server isn’t reachable.');
      });
  };

  return (
    <div style={containerStyle}>
      <div style={{ width: '100%', maxWidth: 420, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => (window.location.hash = '#/')} style={backButton}>
          ← BACK
        </button>
        <h1 style={{ fontSize: 16, letterSpacing: 1, margin: 0, flex: 1 }}>MULTIPLAYER ROOMS</h1>
      </div>

      {error && <p style={errorText}>{error}</p>}

      <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rooms.map((room) => (
          <RoomRow key={room.id} room={room} />
        ))}
        {rooms.length === 0 && !error && <p style={{ fontSize: 12, opacity: 0.6 }}>No rooms yet — create one below.</p>}
      </div>

      {!IS_MOBILE_DEVICE && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <button onClick={() => setWideArena(!wideArena)} style={wideArenaToggle(wideArena)}>
            🖥️ Wide Arena {wideArena ? 'ON' : 'OFF'}
          </button>
          <p style={{ margin: 0, fontSize: 10, opacity: 0.5, textAlign: 'center' }}>
            Applies to rooms you create below — everyone in the room plays on it.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button onClick={() => createRoom('classic')} style={primaryButton}>
          + CLASSIC ROOM
        </button>
        <button onClick={() => createRoom('boss')} style={bossButton}>
          + BOSS ROOM 👹
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
        {TEAM_MODES.map((mode) => {
          const size = teamSizeForMode(mode)!;
          return (
            <button key={mode} onClick={() => createRoom(mode)} style={teamButton}>
              + TEAM {size}v{size} 🛡️
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RoomRow({ room }: { room: RoomSummary }) {
  const remainingMs = useCountdown(room.countdownEndsAtMs);
  const filled = room.slots.filter((s) => s.playerId !== null).length;
  const teamSize = teamSizeForMode(room.mode);

  return (
    <button onClick={() => (window.location.hash = `#/room/${room.id}`)} style={roomRowStyle}>
      <span style={{ flex: 1, textAlign: 'left' }}>{room.name}</span>
      {room.mode === 'boss' && <span style={bossTag}>👹 BOSS</span>}
      {teamSize !== null && (
        <span style={teamTag}>
          🛡️ {teamSize}v{teamSize}
        </span>
      )}
      <span style={{ fontSize: 10, opacity: 0.7 }}>{PHASE_LABEL[room.phase]}</span>
      <span style={{ fontSize: 10, opacity: 0.7 }}>
        {filled}/{room.capacity}
      </span>
      {room.phase === 'countdown' && <span style={{ fontSize: 10, opacity: 0.7 }}>{Math.ceil(remainingMs / 1000)}s</span>}
    </button>
  );
}

const containerStyle: CSSProperties = {
  width: '100vw',
  height: '100dvh',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 20,
  padding: 24,
  overflowY: 'auto',
  fontFamily: 'monospace',
  color: '#eee',
  background: '#20242c',
};

const errorText: CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: '#e06060',
  textAlign: 'center',
};

const backButton: CSSProperties = {
  fontSize: 11,
  fontFamily: 'monospace',
  padding: '5px 10px',
  borderRadius: 5,
  border: '1px solid rgba(255,255,255,0.2)',
  background: 'rgba(255,255,255,0.05)',
  color: '#ddd',
  cursor: 'pointer',
};

const primaryButton: CSSProperties = {
  marginTop: 8,
  padding: '12px 32px',
  fontSize: 16,
  fontFamily: 'monospace',
  fontWeight: 'bold',
  letterSpacing: 1,
  color: '#20242c',
  background: '#e0b030',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
};

const bossButton: CSSProperties = {
  marginTop: 8,
  padding: '12px 32px',
  fontSize: 16,
  fontFamily: 'monospace',
  fontWeight: 'bold',
  letterSpacing: 1,
  color: '#e0b030',
  background: 'rgba(224,176,48,0.16)',
  border: '1px solid #e0b030',
  borderRadius: 6,
  cursor: 'pointer',
};

const bossTag: CSSProperties = {
  fontSize: 9,
  fontWeight: 'bold',
  color: '#e0b030',
  background: 'rgba(224,176,48,0.16)',
  border: '1px solid #e0b030',
  borderRadius: 3,
  padding: '2px 6px',
};

const teamButton: CSSProperties = {
  marginTop: 8,
  padding: '8px 16px',
  fontSize: 13,
  fontFamily: 'monospace',
  fontWeight: 'bold',
  letterSpacing: 1,
  color: TEAM_A_COLOR_CSS,
  background: 'rgba(74,157,224,0.14)',
  border: `1px solid ${TEAM_A_COLOR_CSS}`,
  borderRadius: 6,
  cursor: 'pointer',
};

function wideArenaToggle(active: boolean): CSSProperties {
  return {
    fontSize: 12,
    fontFamily: 'monospace',
    fontWeight: 'bold',
    padding: '6px 14px',
    borderRadius: 16,
    border: active ? '1px solid #ffd700' : '1px solid rgba(255,255,255,0.2)',
    background: active ? 'rgba(255,215,0,0.22)' : 'rgba(255,255,255,0.05)',
    color: active ? '#ffd700' : '#ddd',
    cursor: 'pointer',
  };
}

const teamTag: CSSProperties = {
  fontSize: 9,
  fontWeight: 'bold',
  color: TEAM_A_COLOR_CSS,
  background: 'rgba(74,157,224,0.16)',
  border: `1px solid ${TEAM_A_COLOR_CSS}`,
  borderRadius: 3,
  padding: '2px 6px',
};

const roomRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  fontSize: 12,
  fontFamily: 'monospace',
  padding: '10px 14px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.15)',
  background: 'rgba(255,255,255,0.05)',
  color: '#ddd',
  cursor: 'pointer',
};
