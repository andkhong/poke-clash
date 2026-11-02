import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import type { PlayRoomSummary } from '../../net/play/playProtocol';
import { pokeballUrl } from './assets';
import { ChevronIcon } from './icons';
import { modeLabel } from './modeLabel';
import type { PlayRoomsStatus } from './usePlayRooms';

// The embed brings the sim, Phaser and the species dataset — most of the app —
// so it loads on demand and the rest of the landing page paints first.
const LiveRoomEmbed = lazy(() => import('../screens/LiveRoomEmbed').then((m) => ({ default: m.LiveRoomEmbed })));

interface LiveShowcaseProps {
  rooms: PlayRoomSummary[];
  status: PlayRoomsStatus;
}

/** Brawl first, then 1v1 → 4v4. */
const showcaseOrder = (room: PlayRoomSummary) => (room.mode === 'ffa' ? 0 : room.mode);

/** The always-live rooms, playing right on the landing page — one at a time:
 * a view-only embed of the shown room's match, with arrows and tabs to switch
 * to another live room (the old room's stream closes as the new one opens).
 * The frame is one link into the shown room; the embed is `inert` and
 * `aria-hidden`, so Tab and screen readers meet only the link and the
 * switcher. Hidden while online play is down. */
export function LiveShowcase({ rooms, status }: LiveShowcaseProps) {
  const intl = useIntl();
  const embedRef = useRef<HTMLDivElement>(null);
  const live = rooms.filter((r) => r.live).sort((a, b) => showcaseOrder(a) - showcaseOrder(b));
  const [shownId, setShownId] = useState<string | null>(null);
  const index = Math.max(0, live.findIndex((r) => r.id === shownId));
  const room = live[index] ?? null;

  // React 18's DOM typings have no `inert` prop, so it's set by hand; the wrapper remounts with each room.
  useEffect(() => {
    embedRef.current?.setAttribute('inert', '');
  }, [room?.id]);

  if (status === 'offline' || (status === 'live' && !room)) return null;

  const show = (step: 1 | -1) => setShownId(live[(index + step + live.length) % live.length].id);
  const nameOf = (r: PlayRoomSummary) =>
    intl.formatMessage({ id: 'landing.rooms.card.liveName', defaultMessage: 'Live {mode}' }, { mode: modeLabel(r.mode) });
  const connecting = (
    <div className="lp-frame-state" role="status">
      <img className="lp-bob" src={pokeballUrl} alt="" width={60} height={60} />
      <p>{intl.formatMessage({ id: 'landing.liveBrawl.connecting', defaultMessage: 'Connecting to the live arena…' })}</p>
    </div>
  );
  // In the break a plain join takes a seat, as the caption offers; mid-match it can only watch.
  const href = !room ? '#/play' : room.phase === 'battle' ? `#/play/${room.id}?watch` : `#/play/${room.id}`;
  const meta = room
    ? room.phase === 'battle'
      ? intl.formatMessage(
          {
            id: 'landing.liveBrawl.battle',
            defaultMessage: '{seats} fighters · {players, plural, =0 {all bots right now} other {# playing}}',
          },
          { seats: room.seats, players: room.players }
        )
      : intl.formatMessage({ id: 'landing.liveBrawl.break', defaultMessage: 'Next match starting · take a seat' })
    : null;

  return (
    <section className="lp-section lp-container lp-featured-wrap" aria-labelledby="lp-featured-title">
      <div className="lp-featured">
        <div className="lp-featured-frame">
          {room ? (
            <>
              <div key={room.id} className="lp-featured-embed" ref={embedRef} aria-hidden="true">
                <Suspense fallback={connecting}>
                  <LiveRoomEmbed roomId={room.id} fallback={connecting} />
                </Suspense>
              </div>
              <a
                className="lp-featured-overlay"
                href={href}
                aria-label={intl.formatMessage({ id: 'landing.liveBrawl.enterLabel', defaultMessage: 'Watch {name}, vote and chat' }, { name: nameOf(room) })}
              >
                <span className="lp-room-badge">
                  <span className="lp-live-dot" />
                  {intl.formatMessage({ id: 'landing.rooms.card.live', defaultMessage: 'LIVE' })}
                </span>
              </a>
              {live.length > 1 && (
                <>
                  <button
                    type="button"
                    className="lp-btn lp-btn-secondary lp-carousel-btn lp-featured-arrow lp-carousel-prev"
                    onClick={() => show(-1)}
                    aria-label={intl.formatMessage({ id: 'landing.featured.prev', defaultMessage: 'Previous live game' })}
                  >
                    <ChevronIcon />
                  </button>
                  <button
                    type="button"
                    className="lp-btn lp-btn-secondary lp-carousel-btn lp-featured-arrow lp-carousel-next"
                    onClick={() => show(1)}
                    aria-label={intl.formatMessage({ id: 'landing.featured.next', defaultMessage: 'Next live game' })}
                  >
                    <ChevronIcon />
                  </button>
                </>
              )}
            </>
          ) : (
            connecting
          )}
        </div>
        <div className="lp-featured-caption">
          <div className="lp-featured-caption-text">
            <h2 id="lp-featured-title" className="lp-h3">
              {room ? nameOf(room) : intl.formatMessage({ id: 'landing.featured.title', defaultMessage: 'Live games' })}
            </h2>
            {meta && <p className="lp-note">{meta}</p>}
          </div>
          {live.length > 1 && (
            <div className="lp-featured-tabs" role="group" aria-label={intl.formatMessage({ id: 'landing.featured.title', defaultMessage: 'Live games' })}>
              {live.map((r) => (
                <button key={r.id} type="button" className="lp-featured-tab" aria-pressed={r.id === room?.id} onClick={() => setShownId(r.id)}>
                  {modeLabel(r.mode)}
                </button>
              ))}
            </div>
          )}
          {room?.phase === 'lobby' ? (
            <a className="lp-btn lp-btn-primary lp-btn-md" href={href}>
              {intl.formatMessage({ id: 'landing.rooms.card.join', defaultMessage: 'Join' })}
            </a>
          ) : (
            <a className="lp-btn lp-btn-crowd lp-btn-md" href={href}>
              {intl.formatMessage({ id: 'landing.rooms.card.watch', defaultMessage: 'Watch' })}
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
