import { useEffect, useRef, useState } from 'react';
import type { RoomSummary } from '../../net/protocol';
import { FeaturedRoomPanel } from './FeaturedRoomPanel';
import { RoomCard } from './RoomCard';

interface ShowcaseStripProps {
  /** Every always-live showcase room the server currently lists (rooms.filter
   * (r => r.autoPlay) in LandingScreen), or [] while loading/offline. */
  rooms: RoomSummary[];
  loaded: boolean;
  offline: boolean;
  showViewerCount: boolean;
}

/** How much of a card must be in view before it's picked as the strip's one
 * live-embedded slot — high enough that scrolling past a card on the way to
 * another doesn't flicker it live for a frame. */
const ACTIVE_THRESHOLD = 0.6;

/** The landing page's showcase rooms, in a horizontally-scrollable strip.
 * Exactly one card at a time is a full live embed (FeaturedRoomPanel: a
 * Phaser canvas plus an SSE stream) — the one an IntersectionObserver finds
 * most visible as the strip is scrolled. Every other card renders as a
 * RoomCard, the same static-thumbnail tile used in the room grid below, so
 * visiting the landing page never pays for more than one concurrent live
 * embed regardless of how many showcase rooms exist. */
export function ShowcaseStrip({ rooms, loaded, offline, showViewerCount }: ShowcaseStripProps) {
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());

  // Falls back to the first room whenever there's no active pick yet, or the
  // previously-active room drops out of the list (never expected for these
  // always-live rooms, but cheap insurance).
  useEffect(() => {
    if (rooms.length === 0) return;
    if (!rooms.some((r) => r.id === activeRoomId)) setActiveRoomId(rooms[0].id);
  }, [rooms, activeRoomId]);

  // Re-observes only when the SET of showcase room ids changes (effectively
  // once, at load) — the polled `rooms` array gets a new object identity
  // every 2s, but the DOM nodes themselves don't remount (keyed by room.id),
  // so there's no need to tear down and recreate the observer that often.
  const roomIdsKey = rooms.map((r) => r.id).join(',');
  useEffect(() => {
    if (rooms.length === 0) return;
    const visibility = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.getAttribute('data-room-id');
          if (id) visibility.set(id, entry.intersectionRatio);
        }
        let bestId: string | null = null;
        let bestRatio = 0;
        for (const [id, ratio] of visibility) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = id;
          }
        }
        if (bestId !== null && bestRatio >= ACTIVE_THRESHOLD) setActiveRoomId(bestId);
      },
      { threshold: [0, 0.25, 0.5, ACTIVE_THRESHOLD, 0.75, 1] }
    );
    for (const el of itemRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
    // roomIdsKey (not `rooms`) is the intended dependency — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomIdsKey]);

  if (rooms.length === 0) {
    return (
      <div className="lp-featured-strip">
        <div className="lp-featured-strip-item">
          <FeaturedRoomPanel room={null} loaded={loaded} offline={offline} showViewerCount={showViewerCount} />
        </div>
      </div>
    );
  }

  return (
    <div className="lp-featured-strip" role="list">
      {rooms.map((room) => (
        <div
          key={room.id}
          className="lp-featured-strip-item"
          role="listitem"
          data-room-id={room.id}
          ref={(el) => {
            if (el) itemRefs.current.set(room.id, el);
            else itemRefs.current.delete(room.id);
          }}
        >
          {room.id === activeRoomId ? (
            <FeaturedRoomPanel room={room} loaded={loaded} offline={offline} showViewerCount={showViewerCount} />
          ) : (
            <RoomCard room={room} />
          )}
        </div>
      ))}
    </div>
  );
}
