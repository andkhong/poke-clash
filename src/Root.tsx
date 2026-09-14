import { lazy, Suspense, type ReactNode } from 'react';
import { useHashRoute } from './net/useHashRoute';
import { LandingScreen } from './ui/screens/LandingScreen';

// Nearly every visit opens the landing page, so it's the only screen in the
// entry bundle: local play (App — the setup screens, the sim engine and the
// species/move dataset) and the room page load on demand, which lets the
// landing page paint without first downloading and running all of that.
const App = lazy(() => import('./App').then((m) => ({ default: m.App })));
const RoomScreen = lazy(() => import('./ui/screens/RoomScreen').then((m) => ({ default: m.RoomScreen })));

export function Root() {
  const route = useHashRoute();

  let screen: ReactNode;
  switch (route.kind) {
    case 'local':
      screen = <App />;
      break;
    // The landing page is the room browser now (see LandingScreen) — this
    // keeps any existing '#/rooms' link working as an alias rather than
    // 404-ing into a screen that no longer exists.
    case 'roomList':
      screen = <LandingScreen />;
      break;
    case 'room':
      screen = <RoomScreen roomId={route.roomId} />;
      break;
    case 'landing':
    default:
      screen = <LandingScreen />;
  }

  return <Suspense fallback={null}>{screen}</Suspense>;
}
