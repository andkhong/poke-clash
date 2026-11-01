import type { PlayModeKind } from '../../app/playMode';
import type { PlayRoomSummary } from '../../net/play/playProtocol';
import { PlusIcon } from './icons';
import { FACE_DOWN, FACE_LEFT, FACE_RIGHT, hasIdleSprite, idleSpriteClass, idleSpritesCss } from './courtSprites';
import type { PlayRoomsStatus } from './usePlayRooms';

interface OpenRoomsProps {
  rooms: PlayRoomSummary[];
  status: PlayRoomsStatus;
}

/** Local copy of PLAY_MODES' labels: app/playMode.ts pulls in the species
 * dataset, which must stay out of the landing bundle. */
function modeLabel(mode: PlayModeKind): string {
  return mode === 'ffa' ? 'FFA' : `${mode}v${mode}`;
}

/** The online Play Mode rooms, live. A lobby with an open seat offers JOIN
 * (take a seat); a room in battle or with every seat taken offers WATCH (join
 * the crowd) — joining either of those can only watch, so both are plain
 * `#/play/<id>` links. A "Start your own" card always closes the grid. */
export function OpenRooms({ rooms, status }: OpenRoomsProps) {
  return (
    <section id="rooms" className="lp-section lp-container" aria-labelledby="lp-rooms-title">
      <style>{roomSpritesCss(rooms)}</style>
      <div className="lp-section-head">
        <div className="lp-section-titles">
          <h2 id="lp-rooms-title" className="lp-h2">
            Live rooms
          </h2>
          <p className="lp-section-sub">Jump in as a fighter if a seat is open, or join the crowd and vote.</p>
        </div>
        <a className="lp-btn lp-btn-secondary lp-btn-md lp-hide-mobile" href="#/play">
          Create a room
        </a>
        <a className="lp-text-link lp-only-mobile" href="#/play">
          Create
        </a>
      </div>

      {status === 'loading' && (
        <p className="lp-note" role="status">
          Looking for open rooms…
        </p>
      )}
      {status === 'offline' && (
        <p className="lp-note" role="status">
          Online rooms are offline right now. Play now still works against bots.
        </p>
      )}
      {status === 'live' && rooms.length === 0 && <p className="lp-note">No rooms are open right now. Start one and bring a friend.</p>}

      {/* role="list" because Safari drops list semantics from a list-style:none list. */}
      <ul className="lp-room-grid" role="list">
        {rooms.map((room) => (
          <li key={room.id}>
            <RoomCard room={room} />
          </li>
        ))}
        <li className="lp-hide-mobile">
          <article className="lp-room lp-room-new">
            <div className="lp-room-thumb lp-room-thumb-new">
              <PlusIcon />
            </div>
            <div className="lp-room-body">
              <strong className="lp-room-name">Start your own</strong>
              <p className="lp-room-meta">Pick a mode, share the invite link. Bots hold the seats until friends arrive.</p>
              <a className="lp-btn lp-btn-secondary lp-btn-md" href="#/play">
                Create a room
              </a>
            </div>
          </article>
        </li>
      </ul>
    </section>
  );
}

function RoomCard({ room }: { room: PlayRoomSummary }) {
  const label = modeLabel(room.mode);
  const name = room.live ? `Live ${label}` : `Room ${room.id.toUpperCase()}`;
  const openSeats = room.seats - room.players;
  const canJoin = room.phase === 'lobby' && openSeats > 0;
  const meta = room.phase === 'battle' ? `In progress · ${room.players} playing` : `${room.players} of ${room.seats} seats taken`;

  return (
    <article className="lp-room">
      <div className="lp-room-thumb" aria-hidden="true">
        <span className="lp-court-inset" />
        <SeatTokens room={room} />
        <span className="lp-room-badge lp-hide-mobile">
          {room.phase === 'battle' ? (
            <>
              <span className="lp-live-dot" />
              LIVE
            </>
          ) : (
            'LOBBY'
          )}
        </span>
        {canJoin && (
          <span className="lp-room-badge lp-room-badge-open lp-hide-mobile">
            {openSeats} {openSeats === 1 ? 'SEAT' : 'SEATS'} OPEN
          </span>
        )}
      </div>
      <div className="lp-room-body">
        <div className="lp-room-title">
          <strong className="lp-room-name">{name}</strong>
          <span className="lp-chip">{room.mode === 'ffa' ? 'FFA 8' : label}</span>
        </div>
        <p className={canJoin ? 'lp-room-meta is-open' : 'lp-room-meta'}>{meta}</p>
        {canJoin ? (
          <a className="lp-btn lp-btn-primary lp-btn-md" href={`#/play/${room.id}`} aria-label={`Join ${name}, take a seat`}>
            <span className="lp-hide-mobile">Take a seat</span>
            <span className="lp-only-mobile">Join</span>
          </a>
        ) : (
          <a className="lp-btn lp-btn-crowd lp-btn-md" href={`#/play/${room.id}?watch`} aria-label={`Watch ${name}, join the crowd`}>
            <span className="lp-hide-mobile">Join the crowd</span>
            <span className="lp-only-mobile">Crowd</span>
          </a>
        )}
      </div>
    </article>
  );
}

/** Each seat's Pokémon (an empty marker for a seat nobody's in yet), laid
 * out by CSS: Ruby's column on the left facing right, Sapphire's on the
 * right facing left; FFA is a wrapped grid facing the viewer. */
function SeatTokens({ room }: { room: PlayRoomSummary }) {
  if (room.mode === 'ffa') {
    return (
      <span className="lp-seats lp-seats-ffa">
        {Array.from({ length: room.seats }, (_, i) => (
          <CourtFighter key={i} speciesId={room.fighters[i]?.speciesId} row={FACE_DOWN} marker={`lp-seat-ffa${i % 4}`} />
        ))}
      </span>
    );
  }
  const column = (team: 'teamA' | 'teamB') => {
    const picks = room.fighters.filter((f) => f.team === team);
    return (
      <span className="lp-seat-col">
        {Array.from({ length: room.seats / 2 }, (_, i) => (
          <CourtFighter
            key={i}
            speciesId={picks[i]?.speciesId}
            row={team === 'teamA' ? FACE_RIGHT : FACE_LEFT}
            marker={team === 'teamA' ? 'lp-seat-ruby' : 'lp-seat-sapphire'}
          />
        ))}
      </span>
    );
  };
  return (
    <span className="lp-seats">
      {column('teamA')}
      {column('teamB')}
    </span>
  );
}

function CourtFighter({ speciesId, row, marker }: { speciesId: number | undefined; row: number; marker: string }) {
  if (speciesId === undefined || !hasIdleSprite(speciesId)) return <span className={`lp-seat ${marker}`} />;
  return (
    <span className="lp-mini">
      <span className={`lp-mini-mark ${marker}`} />
      <span className={idleSpriteClass(speciesId, row)} />
    </span>
  );
}

/** Sprite rules for every fighter on the cards, matching CourtFighter's facings. */
function roomSpritesCss(rooms: readonly PlayRoomSummary[]): string {
  return idleSpritesCss(
    rooms.flatMap((room) =>
      room.fighters.map((f) => ({ id: f.speciesId, row: room.mode === 'ffa' ? FACE_DOWN : f.team === 'teamA' ? FACE_RIGHT : FACE_LEFT }))
    )
  );
}
