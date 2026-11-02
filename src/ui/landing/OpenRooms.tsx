import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import type { PlayRoomSummary } from '../../net/play/playProtocol';
import { ChevronIcon } from './icons';
import { modeLabel } from './modeLabel';
import { FACE_DOWN, FACE_LEFT, FACE_RIGHT, hasIdleSprite, idleSpriteClass, idleSpritesCss } from './courtSprites';
import type { PlayRoomsStatus } from './usePlayRooms';

interface OpenRoomsProps {
  rooms: PlayRoomSummary[];
  status: PlayRoomsStatus;
}

/** The online Play Mode rooms, live. A lobby with an open seat offers JOIN
 * (take a seat); a room in battle or with every seat taken offers WATCH (join
 * the crowd) — joining either of those can only watch, so both are plain
 * `#/play/<id>` links. */
export function OpenRooms({ rooms, status }: OpenRoomsProps) {
  const intl = useIntl();
  const track = useRef<HTMLUListElement>(null);
  // Which ends of the carousel are showing; both true means every card fits and the arrows hide.
  const [atEdge, setAtEdge] = useState({ start: true, end: true });
  const measure = useCallback(() => {
    const el = track.current;
    if (el) setAtEdge({ start: el.scrollLeft <= 1, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 });
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure, rooms.length]);
  const slide = (direction: 1 | -1) => {
    const el = track.current;
    const card = el?.firstElementChild as HTMLElement | null;
    if (!el || !card) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: direction * (card.offsetWidth + parseFloat(getComputedStyle(el).columnGap)), behavior: reduce ? 'auto' : 'smooth' });
  };
  const scrolls = !(atEdge.start && atEdge.end);

  return (
    <section id="rooms" className="lp-section lp-container" aria-labelledby="lp-rooms-title">
      <style>{roomSpritesCss(rooms)}</style>
      <div className="lp-section-head">
        <div className="lp-section-titles">
          <h2 id="lp-rooms-title" className="lp-h2">
            {intl.formatMessage({
              id: 'landing.rooms.title',
              defaultMessage: 'Live rooms',
            })}
          </h2>
          <p className="lp-section-sub">
            {intl.formatMessage({
              id: 'landing.rooms.sub',
              defaultMessage: 'Jump in as a fighter if a seat is open, or join the crowd and vote.',
            })}
          </p>
        </div>
        <div className="lp-section-actions lp-hide-mobile">
          {scrolls && (
            <>
              <button
                type="button"
                className="lp-btn lp-btn-secondary lp-carousel-btn lp-carousel-prev"
                onClick={() => slide(-1)}
                disabled={atEdge.start}
                aria-label={intl.formatMessage({ id: 'landing.rooms.prev', defaultMessage: 'Previous rooms' })}
              >
                <ChevronIcon />
              </button>
              <button
                type="button"
                className="lp-btn lp-btn-secondary lp-carousel-btn lp-carousel-next"
                onClick={() => slide(1)}
                disabled={atEdge.end}
                aria-label={intl.formatMessage({ id: 'landing.rooms.next', defaultMessage: 'Next rooms' })}
              >
                <ChevronIcon />
              </button>
            </>
          )}
          <a className="lp-btn lp-btn-secondary lp-btn-md" href="#/play">
            {intl.formatMessage({
              id: 'landing.rooms.create',
              defaultMessage: 'Create a room',
            })}
          </a>
        </div>
        <a className="lp-text-link lp-only-mobile" href="#/play">
          {intl.formatMessage({
            id: 'landing.rooms.createShort',
            defaultMessage: 'Create',
          })}
        </a>
      </div>

      {status === 'loading' && (
        <p className="lp-note" role="status">
          {intl.formatMessage({
            id: 'landing.rooms.loading',
            defaultMessage: 'Looking for open rooms…',
          })}
        </p>
      )}
      {status === 'offline' && (
        <p className="lp-note" role="status">
          {intl.formatMessage({
            id: 'landing.rooms.offline',
            defaultMessage: 'Online rooms are offline right now. Play now still works against bots.',
          })}
        </p>
      )}
      {status === 'live' && rooms.length === 0 && (
        <p className="lp-note">
          {intl.formatMessage({
            id: 'landing.rooms.empty',
            defaultMessage: 'No rooms are open right now. Start one and bring a friend.',
          })}
        </p>
      )}

      {/* role="list" because Safari drops list semantics from a list-style:none list. A swipeable row: arrows above on desktop. */}
      <ul className="lp-room-grid" role="list" ref={track} onScroll={measure}>
        {rooms.map((room) => (
          <li key={room.id}>
            <RoomCard room={room} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function RoomCard({ room }: { room: PlayRoomSummary }) {
  const intl = useIntl();
  const label = modeLabel(room.mode);
  const name = room.live
    ? intl.formatMessage({ id: 'landing.rooms.card.liveName', defaultMessage: 'Live {mode}' }, { mode: label })
    : intl.formatMessage({ id: 'landing.rooms.card.roomName', defaultMessage: 'Room {id}' }, { id: room.id.toUpperCase() });
  const openSeats = room.seats - room.players;
  const canJoin = room.phase === 'lobby' && openSeats > 0;
  const meta =
    room.phase === 'battle'
      ? intl.formatMessage(
          {
            id: 'landing.rooms.card.inProgress',
            defaultMessage: 'In progress · {players} playing',
          },
          { players: room.players }
        )
      : intl.formatMessage(
          {
            id: 'landing.rooms.card.seatsTaken',
            defaultMessage: '{players} of {seats} seats taken',
          },
          { players: room.players, seats: room.seats }
        );

  return (
    <article className="lp-room">
      <div className="lp-room-thumb" aria-hidden="true">
        <span className="lp-court-inset" />
        <SeatTokens room={room} />
        <span className="lp-room-badge lp-hide-mobile">
          {room.phase === 'battle' ? (
            <>
              <span className="lp-live-dot" />
              {intl.formatMessage({
                id: 'landing.rooms.card.live',
                defaultMessage: 'LIVE',
              })}
            </>
          ) : (
            intl.formatMessage({
              id: 'landing.rooms.card.lobby',
              defaultMessage: 'LOBBY',
            })
          )}
        </span>
        {canJoin && (
          <span className="lp-room-badge lp-room-badge-open lp-hide-mobile">
            {intl.formatMessage(
              {
                id: 'landing.rooms.card.seatsOpen',
                defaultMessage: '{count, plural, one {# SEAT OPEN} other {# SEATS OPEN}}',
              },
              { count: openSeats }
            )}
          </span>
        )}
      </div>
      <div className="lp-room-body">
        <div className="lp-room-title">
          <strong className="lp-room-name">{name}</strong>
          {/* A live room's name already says its mode. */}
          {!room.live && <span className="lp-chip">{room.mode === 'ffa' ? 'Brawl 8' : label}</span>}
        </div>
        <p className={canJoin ? 'lp-room-meta is-open' : 'lp-room-meta'}>{meta}</p>
        {canJoin ? (
          <a
            className="lp-btn lp-btn-primary lp-btn-md"
            href={`#/play/${room.id}`}
            aria-label={intl.formatMessage(
              {
                id: 'landing.rooms.card.joinLabel',
                defaultMessage: 'Join {name}, take a seat',
              },
              { name }
            )}
          >
            <span className="lp-hide-mobile">
              {intl.formatMessage({
                id: 'landing.rooms.card.takeSeat',
                defaultMessage: 'Take a seat',
              })}
            </span>
            <span className="lp-only-mobile">
              {intl.formatMessage({
                id: 'landing.rooms.card.join',
                defaultMessage: 'Join',
              })}
            </span>
          </a>
        ) : (
          <a
            className="lp-btn lp-btn-crowd lp-btn-md"
            href={`#/play/${room.id}?watch`}
            aria-label={intl.formatMessage(
              {
                id: 'landing.rooms.card.watchLabel',
                defaultMessage: 'Watch {name}, join the crowd',
              },
              { name }
            )}
          >
            <span className="lp-hide-mobile">
              {intl.formatMessage({
                id: 'landing.rooms.card.joinCrowd',
                defaultMessage: 'Join the crowd',
              })}
            </span>
            <span className="lp-only-mobile">
              {intl.formatMessage({
                id: 'landing.rooms.card.watch',
                defaultMessage: 'Watch',
              })}
            </span>
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
      room.fighters.map((f) => ({
        id: f.speciesId,
        row: room.mode === 'ffa' ? FACE_DOWN : f.team === 'teamA' ? FACE_RIGHT : FACE_LEFT,
      }))
    )
  );
}

