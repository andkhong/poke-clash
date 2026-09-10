import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { RoomConnection } from '../../net/RoomConnection';
import { RemoteSimEngine } from '../../net/RemoteSimEngine';
import type { RoomSummary } from '../../net/protocol';
import type { SimState } from '../../sim/types';
import { createSimStore, type SimStore } from '../state/simStore';
import { MatchScreen } from './MatchScreen';
import { RoomLobbyScreen } from './RoomLobbyScreen';

interface RoomScreenProps {
  roomId: string;
}

function playerIdStorageKey(roomId: string): string {
  return `poke-clash:player:${roomId}`;
}

/** My slot's instance id in the battle roster — instance ids are `p${slotIndex}-${speciesId}`
 * (see matchSetup.ts), and game-server builds MatchConfig.speciesIds in slot order, so my
 * slot's index into `state.allInstanceIds` always points at my own Pokémon. */
function computeHighlightInstanceId(room: RoomSummary, playerId: string | null, state: SimState): string | null {
  if (playerId === null) return null;
  const mySlot = room.slots.find((s) => s.playerId === playerId);
  if (!mySlot) return null;
  return state.allInstanceIds[mySlot.slotIndex] ?? null;
}

export function RoomScreen({ roomId }: RoomScreenProps) {
  const [room, setRoom] = useState<RoomSummary | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(() => sessionStorage.getItem(playerIdStorageKey(roomId)));
  const [store, setStore] = useState<SimStore | null>(null);
  const [highlightInstanceId, setHighlightInstanceId] = useState<string | null>(null);
  const engineRef = useRef<RemoteSimEngine | null>(null);
  // The SSE handlers below are created once per roomId (see the effect's dep
  // array) and read this instead of the `playerId` state directly, so a join
  // that happens after the connection is already open doesn't get missed by
  // a stale closure.
  const playerIdRef = useRef(playerId);
  useEffect(() => {
    playerIdRef.current = playerId;
  }, [playerId]);

  useEffect(() => {
    setRoom(null);
    setStore(null);
    setHighlightInstanceId(null);
    engineRef.current = null;

    const conn = new RoomConnection(roomId, {
      onHello(payload) {
        setRoom(payload.room);
        if (payload.engineState) {
          const engine = new RemoteSimEngine(payload.engineState);
          engineRef.current = engine;
          setStore(createSimStore(engine));
          setHighlightInstanceId(computeHighlightInstanceId(payload.room, playerIdRef.current, payload.engineState));
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
        setHighlightInstanceId(computeHighlightInstanceId(payload.room, playerIdRef.current, payload.initialState));
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
        setHighlightInstanceId(null);
        engineRef.current = null;
      },
    });

    return () => conn.close();
  }, [roomId]);

  // A slot claimed in an earlier match in this room (before it looped back
  // to idle) no longer exists once the room resets — without this, a
  // returning player's remembered playerId matches no current slot, which
  // permanently hides the JOIN ROOM button (canJoin requires playerId ===
  // null) even though the room is actually empty.
  useEffect(() => {
    if (!room || playerId === null) return;
    if (!room.slots.some((s) => s.playerId === playerId)) {
      sessionStorage.removeItem(playerIdStorageKey(roomId));
      setPlayerId(null);
    }
  }, [room, playerId, roomId]);

  const handleJoin = () => {
    fetch(`/api/rooms/${roomId}/join`, { method: 'POST' })
      .then((res) =>
        res.json().then((data: { playerId?: string }) => {
          if (!res.ok || !data.playerId) return; // room filled/started first — stay a spectator, JOIN stays available
          sessionStorage.setItem(playerIdStorageKey(roomId), data.playerId);
          setPlayerId(data.playerId);
        })
      )
      .catch(() => {
        // transient network failure — JOIN ROOM stays visible to retry
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
          highlightInstanceId={highlightInstanceId}
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
  height: '100dvh',
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
