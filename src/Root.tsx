import { App } from './App';
import { useHashRoute } from './net/useHashRoute';
import { LandingScreen } from './ui/screens/LandingScreen';
import { RoomListScreen } from './ui/screens/RoomListScreen';
import { RoomScreen } from './ui/screens/RoomScreen';

export function Root() {
  const route = useHashRoute();

  switch (route.kind) {
    case 'local':
      return <App />;
    case 'roomList':
      return <RoomListScreen />;
    case 'room':
      return <RoomScreen roomId={route.roomId} />;
    case 'landing':
    default:
      return <LandingScreen />;
  }
}
