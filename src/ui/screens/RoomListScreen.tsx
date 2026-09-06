import { useEffect, useState, type CSSProperties } from 'react';
import type { RoomPhase, RoomSummary } from '../../net/protocol';
import { useCountdown } from '../../net/useCountdown';

const POLL_INTERVAL_MS = 2000;

const PHASE_LABEL: Record<RoomPhase, string> = {
  idle: 'OPEN',
  countdown: 'STARTING',
  battle: 'IN BATTLE',
  complete: 'FINISHED',
};

export function RoomListScreen() {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    const fetchRooms = () => {
      fetch('/api/rooms')
        .then((res) => res.json())
        .then((data: { rooms: RoomSummary[] }) => {
          if (!cancelled) setRooms(data.rooms);
        })
        .catch(() => {
          // transient fetch failure — the next poll tick will retry
        });
    };
    fetchRooms();
    const interval = setInterval(fetchRooms, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const createRoom = () => {
    fetch('/api/rooms', { method: 'POST' })
      .then((res) => res.json())
      .then((data: { room: RoomSummary }) => {
        window.location.hash = `#/room/${data.room.id}`;
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

      <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rooms.map((room) => (
          <RoomRow key={room.id} room={room} />
        ))}
        {rooms.length === 0 && <p style={{ fontSize: 12, opacity: 0.6 }}>No rooms yet — create one below.</p>}
      </div>

      <button onClick={createRoom} style={primaryButton}>
        + CREATE ROOM
      </button>
    </div>
  );
}

function RoomRow({ room }: { room: RoomSummary }) {
  const remainingMs = useCountdown(room.countdownEndsAtMs);
  const filled = room.slots.filter((s) => s.playerId !== null).length;

  return (
    <button onClick={() => (window.location.hash = `#/room/${room.id}`)} style={roomRowStyle}>
      <span style={{ flex: 1, textAlign: 'left' }}>{room.name}</span>
      <span style={{ fontSize: 10, opacity: 0.7 }}>{PHASE_LABEL[room.phase]}</span>
      <span style={{ fontSize: 10, opacity: 0.7 }}>{filled}/4</span>
      {room.phase === 'countdown' && <span style={{ fontSize: 10, opacity: 0.7 }}>{Math.ceil(remainingMs / 1000)}s</span>}
    </button>
  );
}

const containerStyle: CSSProperties = {
  width: '100vw',
  height: '100vh',
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
