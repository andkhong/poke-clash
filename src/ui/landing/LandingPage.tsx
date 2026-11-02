import { useState } from 'react';
import { useIntl } from 'react-intl';
import { ContactModal } from './ContactModal';
import { CrowdCalls } from './CrowdCalls';
import { LandingFooter } from './LandingFooter';
import { LandingHero } from './LandingHero';
import { LandingNav } from './LandingNav';
import { LiveShowcase } from './LiveShowcase';
import { LANDING_CSS } from './landingCss';
import { Modes } from './Modes';
import { OpenRooms } from './OpenRooms';
import { PlayIcon } from './icons';
import { usePlayRooms } from './usePlayRooms';
import { useScrollTo } from './useScrollTo';

/** The landing page for Play Mode: one always-live room playing in an
 * embed (arrows switch rooms), the live online-room list, the pitch (Play now / Play online /
 * Watch), the Crowd Calls explainer, modes, a closing CTA and the footer, plus a sticky Play now / Watch bar on phones. It owns
 * the room-list socket and the contact modal; the pieces are presentational,
 * and all styling comes from the one `<style>` here (see landingCss.ts).
 * Must not import src/data/loader: this is the entry bundle. */
export function LandingPage() {
  const intl = useIntl();
  const { rooms, status } = usePlayRooms();
  const [contactOpen, setContactOpen] = useState(false);
  const scrollTo = useScrollTo();
  const watch = () => scrollTo('rooms');
  const playersOnline = status === 'live' ? rooms.reduce((sum, room) => sum + room.players, 0) : null;
  const seatOpen = rooms.some((room) => room.phase === 'lobby' && room.players < room.seats);

  return (
    <div className="lp-root">
      <style>{LANDING_CSS}</style>
      <LandingNav onScrollTo={scrollTo} onContact={() => setContactOpen(true)} />
      <main>
        <LiveShowcase rooms={rooms} status={status} />
        <OpenRooms rooms={rooms} status={status} />
        <LandingHero playersOnline={playersOnline} onWatch={watch} />
        <CrowdCalls />
        <Modes />
        <section className="lp-container lp-cta-wrap" aria-labelledby="lp-cta-title">
          <div className="lp-cta lp-msgbox">
            <h2 id="lp-cta-title" className="lp-h2">
              {seatOpen
                ? intl.formatMessage({
                    id: 'landing.cta.seatOpen',
                    defaultMessage: 'A seat is open somewhere right now.',
                  })
                : intl.formatMessage({
                    id: 'landing.cta.nextMatch',
                    defaultMessage: 'Your next match starts in seconds.',
                  })}
            </h2>
            <a className="lp-btn lp-btn-primary lp-btn-xl" href="#/local">
              <PlayIcon />
              {intl.formatMessage({
                id: 'landing.cta.playNow',
                defaultMessage: 'Play now',
              })}
            </a>
          </div>
        </section>
      </main>
      <LandingFooter onContact={() => setContactOpen(true)} onBackToTop={() => scrollTo()} />
      <div className="lp-dock">
        <a className="lp-btn lp-btn-primary lp-dock-play" href="#/local">
          {intl.formatMessage({
            id: 'landing.dock.playNow',
            defaultMessage: 'Play now',
          })}
        </a>
        <button type="button" className="lp-btn lp-btn-crowd-outline lp-dock-watch" onClick={watch}>
          {intl.formatMessage({
            id: 'landing.dock.watch',
            defaultMessage: 'Watch',
          })}
        </button>
      </div>
      <ContactModal open={contactOpen} onClose={() => setContactOpen(false)} />
    </div>
  );
}
