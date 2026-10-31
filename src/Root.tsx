import { lazy, Suspense, type ReactNode } from 'react';
import { useHashRoute } from './net/useHashRoute';
import { LandingPage } from './ui/landing/LandingPage';

// Nearly every visit opens the landing page, so it's the only screen in the
// entry bundle: solo Play Mode (App — the sim engine and the species/move
// dataset) and online play load on demand, which lets the landing page paint
// without first downloading and running all of that.
const App = lazy(() => import('./App').then((m) => ({ default: m.App })));
const PlayOnlineScreen = lazy(() => import('./ui/screens/PlayOnlineScreen').then((m) => ({ default: m.PlayOnlineScreen })));

export function Root() {
  const route = useHashRoute();

  let screen: ReactNode;
  switch (route.kind) {
    case 'local':
      screen = <App />;
      break;
    case 'play':
      screen = <PlayOnlineScreen roomId={route.roomId} watch={route.watch} />;
      break;
    case 'landing':
    default:
      screen = <LandingPage />;
  }

  return <Suspense fallback={null}>{screen}</Suspense>;
}
