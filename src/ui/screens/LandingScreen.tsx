import { useEffect, useState, type CSSProperties } from 'react';
import type { RoomMode, RoomSummary } from '../../net/protocol';
import { teamSizeForMode } from '../../net/protocol';
import { IS_MOBILE_DEVICE, resolveMatchArena } from '../../app/config';
import { useWideArenaPreference } from '../hooks/useWideArenaPreference';
import { FeaturedRoomPanel } from '../components/FeaturedRoomPanel';
import { RoomCard } from '../components/RoomCard';
import { ACCENT, BG, DESTRUCTIVE, FONT_MONO, PRIMARY, PRIMARY_TEXT, SECONDARY, TEXT, TEXT_MUTED, accentAlpha, secondaryAlpha, textAlpha } from '../theme';

// Reuses the in-battle Pokéball sprite (see pokeballAsset.ts) as the title
// mark — same URL-import trick Phaser's loader uses, since this project has
// no image module typings for a plain `import x from './x.png'`.
const pokeballUrl = new URL('../../render/sprites/assets/pokeball.png', import.meta.url).href;

const POLL_INTERVAL_MS = 2000;
const TEAM_MODES: RoomMode[] = ['team2', 'team3', 'team4'];

/** The landing page — a Twitch-style discovery homepage: the server's one
 * always-live showcase room featured up top (FeaturedRoomPanel), every real
 * room below it as a grid of RoomCards, and room creation folded in here too
 * (this replaces the old separate #/rooms screen — see Root.tsx, which now
 * aliases that route to this one). */
export function LandingScreen() {
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
          // isn't reachable — surface this instead of leaving the page stuck
          // with no featured room and no explanation.
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

  const featuredRoom = rooms.find((r) => r.autoPlay) ?? null;
  const gridRooms = rooms.filter((r) => !r.autoPlay);

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
      <header style={headerStyle}>
        <img src={pokeballUrl} alt="" aria-hidden="true" style={pokeballStyle} />
        <h1 style={titleStyle}>POKÉBETS ARENA</h1>
        <button onClick={() => (window.location.hash = '#/local')} style={soloPlayButton}>
          ⚔️ Solo Play
        </button>
      </header>

      {error && <p style={errorText}>{error}</p>}

      {featuredRoom ? (
        <FeaturedRoomPanel roomId={featuredRoom.id} viewerCount={featuredRoom.viewerCount} />
      ) : (
        !error && <p style={statusText}>Loading the live room…</p>
      )}

      <section style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <h2 style={sectionTitleStyle}>LIVE ROOMS</h2>
          {!IS_MOBILE_DEVICE && (
            <button onClick={() => setWideArena(!wideArena)} style={wideArenaToggle(wideArena)}>
              🖥️ Wide Arena {wideArena ? 'ON' : 'OFF'}
            </button>
          )}
        </div>

        <div style={gridStyle}>
          {gridRooms.map((room) => (
            <RoomCard key={room.id} room={room} />
          ))}
        </div>
        {gridRooms.length === 0 && !error && <p style={statusText}>No other rooms yet — create one below.</p>}

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
      </section>
    </div>
  );
}

const containerStyle: CSSProperties = {
  width: '100%',
  minHeight: '100dvh',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 20,
  padding: '20px 16px calc(24px + env(safe-area-inset-bottom))',
  fontFamily: FONT_MONO,
  color: TEXT,
  background: BG,
};

const headerStyle: CSSProperties = {
  width: '100%',
  maxWidth: 1100,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const pokeballStyle: CSSProperties = {
  width: 32,
  height: 32,
  imageRendering: 'pixelated',
  filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.4))',
};

const titleStyle: CSSProperties = {
  flex: 1,
  fontSize: 'clamp(14px, 3vw, 20px)',
  letterSpacing: 1,
  margin: 0,
};

const soloPlayButton: CSSProperties = {
  flexShrink: 0,
  padding: '8px 14px',
  fontSize: 12,
  fontFamily: 'monospace',
  fontWeight: 'bold',
  letterSpacing: 0.5,
  color: PRIMARY,
  background: 'transparent',
  border: `1px solid ${PRIMARY}`,
  borderRadius: 6,
  cursor: 'pointer',
};

const errorText: CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: DESTRUCTIVE,
  textAlign: 'center',
};

const statusText: CSSProperties = {
  margin: 0,
  fontSize: 12,
  opacity: 0.6,
  textAlign: 'center',
};

const sectionStyle: CSSProperties = {
  width: '100%',
  maxWidth: 1100,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const sectionHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  flexWrap: 'wrap',
};

const sectionTitleStyle: CSSProperties = {
  fontSize: 13,
  letterSpacing: 1,
  margin: 0,
  opacity: 0.85,
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
  gap: 14,
};

const primaryButton: CSSProperties = {
  marginTop: 8,
  padding: '12px 32px',
  fontSize: 16,
  fontFamily: 'monospace',
  fontWeight: 'bold',
  letterSpacing: 1,
  color: PRIMARY_TEXT,
  background: PRIMARY,
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
  color: ACCENT,
  background: accentAlpha(0.16),
  border: `1px solid ${ACCENT}`,
  borderRadius: 6,
  cursor: 'pointer',
};

const teamButton: CSSProperties = {
  marginTop: 8,
  padding: '8px 16px',
  fontSize: 13,
  fontFamily: 'monospace',
  fontWeight: 'bold',
  letterSpacing: 1,
  color: SECONDARY,
  background: secondaryAlpha(0.14),
  border: `1px solid ${SECONDARY}`,
  borderRadius: 6,
  cursor: 'pointer',
};

function wideArenaToggle(active: boolean): CSSProperties {
  return {
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: 'bold',
    padding: '5px 12px',
    borderRadius: 14,
    border: active ? `1px solid ${ACCENT}` : `1px solid ${textAlpha(0.2)}`,
    background: active ? accentAlpha(0.22) : textAlpha(0.05),
    color: active ? ACCENT : TEXT_MUTED,
    cursor: 'pointer',
  };
}
