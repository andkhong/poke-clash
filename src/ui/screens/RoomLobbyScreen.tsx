import { useMemo, type CSSProperties } from 'react';
import { hasPmdSprite, listAllSpecies } from '../../data/loader';
import type { RoomSummary } from '../../net/protocol';
import { useCountdown } from '../../net/useCountdown';
import { SpeciesPicker } from '../components/SpeciesPicker';

interface RoomLobbyScreenProps {
  room: RoomSummary;
  playerId: string | null;
  onJoin: () => void;
  onPick: (speciesId: number) => void;
}

export function RoomLobbyScreen({ room, playerId, onJoin, onPick }: RoomLobbyScreenProps) {
  const remainingMs = useCountdown(room.countdownEndsAtMs);
  const allSpecies = useMemo(() => listAllSpecies().filter((s) => hasPmdSprite(s.id)), []);

  const mySlot = room.slots.find((s) => s.playerId === playerId) ?? null;
  const canJoin = playerId === null && room.slots.some((s) => s.playerId === null);

  return (
    <div style={{ width: '100%', height: '100%', boxSizing: 'border-box', display: 'flex' }}>
      <div style={containerStyle}>
        <div style={{ width: '100%', maxWidth: 420, display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => (window.location.hash = '#/rooms')} style={backButton}>
            ← BACK
          </button>
          <h1 style={{ fontSize: 16, letterSpacing: 1, margin: 0, flex: 1 }}>{room.name}</h1>
        </div>

        {room.phase === 'idle' && <p style={statusText}>Waiting for the first player to join…</p>}
        {room.phase === 'countdown' && <p style={statusText}>Starting in {Math.ceil(remainingMs / 1000)}s…</p>}

        <section style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {room.slots.map((slot) => (
            <div key={slot.slotIndex} style={slotCardStyle}>
              <span style={{ flex: 1 }}>
                {slot.speciesName ?? (slot.playerId ? 'Picking…' : 'Open seat')}
                {slot.isAutoFilled ? ' (auto)' : ''}
              </span>
              {slot.playerId !== null && slot.playerId === playerId && <span style={youTag}>YOU</span>}
            </div>
          ))}
        </section>

        {canJoin && (
          <button onClick={onJoin} style={primaryButton}>
            JOIN ROOM
          </button>
        )}

        {mySlot && room.phase === 'countdown' && (
          <section style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {mySlot.speciesId !== null && <p style={statusText}>Current pick: {mySlot.speciesName}</p>}
            <SpeciesPicker
              allSpecies={allSpecies}
              excludeSpeciesIds={room.slots
                .filter((s) => s.slotIndex !== mySlot.slotIndex)
                .map((s) => s.speciesId)
                .filter((id): id is number => id !== null)}
              onPick={onPick}
            />
          </section>
        )}
      </div>
    </div>
  );
}

const containerStyle: CSSProperties = {
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 20,
  padding: 24,
  boxSizing: 'border-box',
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

const statusText: CSSProperties = {
  margin: 0,
  fontSize: 13,
  opacity: 0.8,
};

const slotCardStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  padding: '10px 14px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.15)',
  background: 'rgba(255,255,255,0.05)',
};

const youTag: CSSProperties = {
  fontSize: 10,
  fontWeight: 'bold',
  color: '#e0b030',
};

const primaryButton: CSSProperties = {
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
