import { App } from './App';
import { useHashRoute } from './net/useHashRoute';
import { LandingScreen } from './ui/screens/LandingScreen';
import { RoomScreen } from './ui/screens/RoomScreen';

export function Root() {
  const route = useHashRoute();

  switch (route.kind) {
    case 'local':
      return <App />;
    // The landing page is the room browser now (see LandingScreen) — this
    // keeps any existing '#/rooms' link working as an alias rather than
    // 404-ing into a screen that no longer exists.
    case 'roomList':
      return <LandingScreen />;
    case 'room':
      return <RoomScreen roomId={route.roomId} />;
    case 'landing':
    default:
      return <LandingScreen />;
  }
}
