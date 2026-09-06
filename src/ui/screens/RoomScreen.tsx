import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { RoomConnection } from '../../net/RoomConnection';
import { RemoteSimEngine } from '../../net/RemoteSimEngine';
import type { RoomSummary } from '../../net/protocol';
import { createSimStore, type SimStore } from '../state/simStore';
import { MatchScreen } from './MatchScreen';
import { RoomLobbyScreen } from './RoomLobbyScreen';

interface RoomScreenProps {
  roomId: string;
}

function playerIdStorageKey(roomId: string): string {
  return `poke-clash:player:${roomId}`;
}

export function RoomScreen({ roomId }: RoomScreenProps) {
  const [room, setRoom] = useState<RoomSummary | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(() => sessionStorage.getItem(playerIdStorageKey(roomId)));
  const [store, setStore] = useState<SimStore | null>(null);
  const engineRef = useRef<RemoteSimEngine | null>(null);

  useEffect(() => {
    setRoom(null);
    setStore(null);
    engineRef.current = null;

    const conn = new RoomConnection(roomId, {
      onHello(payload) {
        setRoom(payload.room);
        if (payload.engineState) {
          const engine = new RemoteSimEngine(payload.engineState);
          engineRef.current = engine;
          setStore(createSimStore(engine));
        }
      },
      onRoomUpdate(summary) {
        setRoom(summary);
      },
      onBattleStart(payload) {
        setRoom(payload.room);
        const engine = new RemoteSimEngine(payload.initialState);
        engineRef.current = engine;
        setStore(createSimStore(engine));
      },
      onStateUpdate(payload) {
        engineRef.current?.applyServerUpdate(payload.state, payload.events);
      },
      onBattleComplete(payload) {
        engineRef.current?.applyServerUpdate(payload.finalState, []);
      },
      onLobbyReset(summary) {
        setRoom(summary);
        setStore(null);
        engineRef.current = null;
      },
    });

    return () => conn.close();
  }, [roomId]);

  const handleJoin = () => {
    fetch(`/api/rooms/${roomId}/join`, { method: 'POST' })
      .then((res) => res.json())
      .then((data: { playerId: string }) => {
        sessionStorage.setItem(playerIdStorageKey(roomId), data.playerId);
        setPlayerId(data.playerId);
      });
  };

  const handlePick = (speciesId: number) => {
    if (!playerId) return;
    void fetch(`/api/rooms/${roomId}/pick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, speciesId }),
    });
  };

  return (
    <div style={containerStyle}>
      {!room && <p style={loadingText}>Connecting…</p>}
      {room && store && (room.phase === 'battle' || room.phase === 'complete') && (
        <MatchScreen
          store={store}
          onExit={() => (window.location.hash = '#/rooms')}
          showEndMatchControl={false}
          completeButtonLabel="BACK TO ROOMS"
        />
      )}
      {room && !(store && (room.phase === 'battle' || room.phase === 'complete')) && (
        <RoomLobbyScreen room={room} playerId={playerId} onJoin={handleJoin} onPick={handlePick} />
      )}
    </div>
  );
}

const containerStyle: CSSProperties = {
  width: '100vw',
  height: '100vh',
  overflow: 'hidden',
};

const loadingText: CSSProperties = {
  width: '100%',
  height: '100%',
  margin: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'monospace',
  color: '#eee',
  background: '#20242c',
};
