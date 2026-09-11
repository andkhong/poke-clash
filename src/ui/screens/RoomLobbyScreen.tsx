import { useMemo, type CSSProperties } from 'react';
import { hasPmdSprite, listAllSpecies } from '../../data/loader';
import type { RoomSlotSummary, RoomSummary } from '../../net/protocol';
import { teamSizeForMode } from '../../net/protocol';
import { useCountdown } from '../../net/useCountdown';
import { resolveMatchArena } from '../../app/config';
import { SpeciesPicker } from '../components/SpeciesPicker';
import { ChatPanel, type ChatPanelProps } from '../chat/ChatPanel';
import { useWideArenaPreference } from '../hooks/useWideArenaPreference';
import { describeArenaShape } from '../arenaShape';
import { TEAM_A_COLOR_CSS, teamColorCss } from '../teamColors';

interface RoomLobbyScreenProps {
  room: RoomSummary;
  playerId: string | null;
  onJoin: () => void;
  onPick: (speciesId: number) => void;
  /** Room chat, shown inline under the seats. Only for the narrow/mobile
   * layout — on a wide viewport RoomScreen shows it as a sidebar beside
   * this screen instead and passes nothing here. */
  chat?: ChatPanelProps;
}

export function RoomLobbyScreen({ room, playerId, onJoin, onPick, chat }: RoomLobbyScreenProps) {
  const remainingMs = useCountdown(room.countdownEndsAtMs);
  const allSpecies = useMemo(() => listAllSpecies().filter((s) => hasPmdSprite(s.id)), []);

  // Guarded on playerId first — an open seat's playerId is null too, and
  // matching one would show a spectator the species picker during countdown.
  const mySlot = playerId === null ? null : (room.slots.find((s) => s.playerId === playerId) ?? null);
  // The always-on showcase room is spectate-only forever (see roomManager's
  // startAutoPlayCycle) — never offer a seat in it even if it's opened
  // directly at #/room/:id.
  const canJoin = !room.autoPlay && playerId === null && room.slots.some((s) => s.playerId === null);
  const teamSize = teamSizeForMode(room.mode);

  // The room's arena is whatever the session-opening join set (see
  // JoinRoomRequest.arena) — so an idle room's shape is still up for grabs,
  // and a viewer whose own choice differs is told the first seat decides.
  const roomArena = describeArenaShape(room.arena);
  const [wideArena] = useWideArenaPreference();
  const myArena = describeArenaShape(resolveMatchArena(wideArena));
  const joinFirstSwitchesArena = room.phase === 'idle' && canJoin && myArena.wide !== roomArena.wide;

  return (
    <div style={{ width: '100%', height: '100%', boxSizing: 'border-box', display: 'flex' }}>
      <div style={containerStyle}>
        <div style={{ width: '100%', maxWidth: 420, display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => (window.location.hash = '#/rooms')} style={backButton}>
            ← BACK
          </button>
          <h1 style={{ fontSize: 16, letterSpacing: 1, margin: 0, flex: 1 }}>{room.name}</h1>
          <span style={arenaTag(roomArena.wide)}>{roomArena.label}</span>
        </div>
        {joinFirstSwitchesArena && (
          <p style={statusText}>
            Nobody's seated yet — joining first switches this room to the {myArena.wide ? 'wide' : 'portrait'} arena.
          </p>
        )}

        {room.mode === 'boss' && <p style={bossBanner}>👹 BOSS MODE — your party of 4 vs. one amplified boss</p>}
        {teamSize !== null && (
          <p style={teamBanner}>
            🛡️ TEAM MODE — {teamSize}v{teamSize}, teammates never fight each other. Seats are assigned in join order.
          </p>
        )}

        {room.phase === 'idle' && !room.autoPlay && <p style={statusText}>Waiting for the first player to join…</p>}
        {room.phase === 'countdown' && <p style={statusText}>Starting in {Math.ceil(remainingMs / 1000)}s…</p>}

        {/* The always-on showcase room auto-fills every seat right as its
            battle starts (see roomManager's startAutoPlayCycle/startBattle) —
            between rounds every slot is briefly empty, so showing "Open
            seat" here would read as an invitation to join a room nobody can
            ever join. */}
        {!room.autoPlay &&
          (teamSize === null ? (
            <SlotList slots={room.slots} playerId={playerId} />
          ) : (
            <div style={{ width: '100%', maxWidth: 420, display: 'flex', gap: 12 }}>
              <TeamSlotColumn
                label="Team A"
                slots={room.slots.filter((s) => s.team === 'teamA')}
                playerId={playerId}
              />
              <TeamSlotColumn
                label="Team B"
                slots={room.slots.filter((s) => s.team === 'teamB')}
                playerId={playerId}
              />
            </div>
          ))}

        {chat && (
          <section style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={sectionLabel}>CHAT</span>
            <ChatPanel {...chat} listHeight={180} />
          </section>
        )}

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

function SlotCard({ slot, playerId, accentColor }: { slot: RoomSlotSummary; playerId: string | null; accentColor?: string }) {
  return (
    <div style={slotCardStyle(accentColor)}>
      <span style={{ flex: 1 }}>
        {slot.speciesName ?? (slot.playerId ? 'Picking…' : 'Open seat')}
        {slot.isAutoFilled ? ' (auto)' : ''}
      </span>
      {slot.playerId !== null && slot.playerId === playerId && <span style={youTag}>YOU</span>}
    </div>
  );
}

function SlotList({ slots, playerId }: { slots: RoomSlotSummary[]; playerId: string | null }) {
  return (
    <section style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {slots.map((slot) => (
        <SlotCard key={slot.slotIndex} slot={slot} playerId={playerId} />
      ))}
    </section>
  );
}

/** One side's seats in a Team Mode lobby — same card as the classic/boss
 * list, just grouped under a colored header and bordered to match, so it's
 * clear at a glance which seats end up fighting together. */
function TeamSlotColumn({ label, slots, playerId }: { label: string; slots: RoomSlotSummary[]; playerId: string | null }) {
  const color = teamColorCss(slots[0]?.team ?? undefined);
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 'bold', letterSpacing: 1, color }}>{label}</span>
      {slots.map((slot) => (
        <SlotCard key={slot.slotIndex} slot={slot} playerId={playerId} accentColor={color} />
      ))}
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

const bossBanner: CSSProperties = {
  margin: 0,
  fontSize: 12,
  fontWeight: 'bold',
  color: '#e0b030',
};

const teamBanner: CSSProperties = {
  margin: 0,
  fontSize: 12,
  fontWeight: 'bold',
  color: TEAM_A_COLOR_CSS,
  textAlign: 'center',
};

function slotCardStyle(accentColor?: string): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    padding: '10px 14px',
    borderRadius: 6,
    border: `1px solid ${accentColor ? `${accentColor}66` : 'rgba(255,255,255,0.15)'}`,
    background: 'rgba(255,255,255,0.05)',
  };
}

const sectionLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 'bold',
  letterSpacing: 1,
  opacity: 0.7,
};

function arenaTag(wide: boolean): CSSProperties {
  return {
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1,
    whiteSpace: 'nowrap',
    color: wide ? '#ffd700' : '#bbb',
    background: wide ? 'rgba(255,215,0,0.16)' : 'rgba(255,255,255,0.06)',
    border: `1px solid ${wide ? '#ffd700' : 'rgba(255,255,255,0.2)'}`,
    borderRadius: 3,
    padding: '2px 6px',
  };
}

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
