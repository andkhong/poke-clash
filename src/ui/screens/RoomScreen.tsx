import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { RoomConnection } from '../../net/RoomConnection';
import { RemoteSimEngine } from '../../net/RemoteSimEngine';
import type { ChatMessage, ChatRequest, JoinRoomRequest, RoomSummary } from '../../net/protocol';
import type { SimState } from '../../sim/types';
import { resolveMatchArena } from '../../app/config';
import { SPECTATOR_NAME } from '../../net/spectatorIdentity';
import { createSimStore, type SimStore } from '../state/simStore';
import { ChatSidebar } from '../chat/ChatSidebar';
import type { ChatPanelProps } from '../chat/ChatPanel';
import { appendChatMessage, CHAT_SIDEBAR_MEDIA_QUERY } from '../chat/chatModel';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useWideArenaPreference } from '../hooks/useWideArenaPreference';
import { useRoomThumbnailCapture } from '../hooks/useRoomThumbnailCapture';
import { MatchScreen } from './MatchScreen';
import { RoomLobbyScreen } from './RoomLobbyScreen';

interface RoomScreenProps {
  roomId: string;
  /** True when mounted inside the landing page's featured panel rather than
   * at its own full route — suppresses the "← BACK" control during the
   * brief connecting flash, since there's no separate rooms page to go back
   * to from there. */
  embedded?: boolean;
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

export function RoomScreen({ roomId, embedded = false }: RoomScreenProps) {
  const [room, setRoom] = useState<RoomSummary | null>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(() => sessionStorage.getItem(playerIdStorageKey(roomId)));
  const [store, setStore] = useState<SimStore | null>(null);
  const [highlightInstanceId, setHighlightInstanceId] = useState<string | null>(null);
  // Plain state is enough for chat: even a full room mashing quick reactions
  // is a few renders a second, well under the HUD's own 10 Hz refresh.
  const [chatLog, setChatLog] = useState<ChatMessage[]>([]);
  // The stream failed to (re)open — shown instead of a bare "Connecting…"
  // that would otherwise sit there forever for a dead server or a stale
  // room link, with no way out. EventSource retries by itself; a `hello`
  // clears this.
  const [connectionError, setConnectionError] = useState(false);
  const [wideArena] = useWideArenaPreference();
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
    setChatLog([]);
    setConnectionError(false);
    engineRef.current = null;

    const conn = new RoomConnection(roomId, {
      onHello(payload) {
        setConnectionError(false);
        setRoom(payload.room);
        // Replaced wholesale, not merged: hello arrives on every EventSource
        // (re)connect and the server's backlog is the authority on what was
        // said while this client was away.
        setChatLog(payload.chatLog);
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
        setChatLog([]);
        engineRef.current = null;
      },
      onChat(message) {
        setChatLog((log) => appendChatMessage(log, message));
      },
      onError() {
        setConnectionError(true);
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
    // My own arena choice rides along: if this join is what gets the room
    // going, the room takes it (see JoinRoomRequest.arena) — so the Wide
    // Arena toggle applies to a pre-seeded room too, not only to rooms I
    // created myself.
    const body: JoinRoomRequest = { arena: resolveMatchArena(wideArena) };
    fetch(`/api/rooms/${roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
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

  const handleSendChat = async (text: string): Promise<string | null> => {
    // Read from render scope, not playerIdRef — this runs on a tap, never
    // from inside the once-per-room SSE closures the ref exists for.
    // Every room supports chat, seat or no seat (see spectatorIdentity.ts) —
    // a seat's playerId is used when there is one, this tab's generated
    // display name otherwise.
    const request: ChatRequest =
      playerId !== null ? { playerId, text } : { spectatorName: SPECTATOR_NAME, text };
    try {
      const res = await fetch(`/api/rooms/${roomId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (res.ok) return null;
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return body?.error ?? 'send_failed';
    } catch {
      return 'send_failed';
    }
  };

  // "You" is whichever slot holds my playerId when I'm seated, otherwise
  // this tab's generated spectator identity — both fall out of `room` +
  // `playerId` each render, so the stale-playerId cleanup effect above
  // keeps them right after a room reset too. Every room supports chat now
  // (see spectatorIdentity.ts), seated or not, so canSend is unconditional.
  // (mySlotIndex is guarded on playerId first: an open seat's playerId is
  // null too, so a bare `s.playerId === playerId` would match a spectator
  // against the first empty seat.)
  const mySlotIndex = playerId === null ? null : (room?.slots.find((s) => s.playerId === playerId)?.slotIndex ?? null);
  const chat: ChatPanelProps = {
    messages: chatLog,
    mySlotIndex,
    mySpectatorName: SPECTATOR_NAME,
    room,
    canSend: true,
    onSend: handleSendChat,
  };

  // One log, two presentations. Wide viewport: a stream-style chat column
  // beside whatever this screen is showing (lobby or match). Narrow: the
  // lobby embeds the panel inline and the match draws it over the arena.
  const sidebar = useMediaQuery(CHAT_SIDEBAR_MEDIA_QUERY);
  const inMatch = room !== null && store !== null && (room.phase === 'battle' || room.phase === 'complete');

  // Only a room nobody needs a thumbnail for skips this — see
  // useRoomThumbnailCapture's own doc for why every other watching client
  // (player or spectator) contributes one.
  useRoomThumbnailCapture(roomId, room?.phase, canvas, room !== null && !room.autoPlay);

  return (
    <div style={containerStyle(embedded)}>
      <div style={mainRegionStyle}>
        {!room && (
          <div style={connectingStyle}>
            {!embedded && (
              <button onClick={() => (window.location.hash = '#/rooms')} style={backButton}>
                ← BACK
              </button>
            )}
            <p style={{ margin: 0, textAlign: 'center' }}>
              {connectionError ? 'Can’t reach this room — is the multiplayer server running? Retrying…' : 'Connecting…'}
            </p>
          </div>
        )}
        {room && store && inMatch && (
          <MatchScreen
            store={store}
            onExit={() => (window.location.hash = '#/rooms')}
            showEndMatchControl={false}
            leaveControlLabel={embedded ? undefined : 'LEAVE ROOM'}
            completeButtonLabel="BACK TO ROOMS"
            highlightInstanceId={highlightInstanceId}
            onCanvasReady={setCanvas}
            chat={sidebar ? undefined : chat}
          />
        )}
        {room && !inMatch && (
          <RoomLobbyScreen room={room} playerId={playerId} onJoin={handleJoin} onPick={handlePick} chat={sidebar ? undefined : chat} />
        )}
      </div>
      {room && sidebar && <ChatSidebar {...chat} />}
    </div>
  );
}

// Viewport units at the full route (`#/room/:id`); embedded in the landing
// page's featured panel this needs to fill whatever box its parent gives it
// instead, or it'd break out of that box to the actual viewport size.
function containerStyle(embedded: boolean): CSSProperties {
  return {
    width: embedded ? '100%' : '100vw',
    height: embedded ? '100%' : '100dvh',
    overflow: 'hidden',
    display: 'flex',
  };
}

const mainRegionStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: '100%',
  position: 'relative',
};

const connectingStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  boxSizing: 'border-box',
  padding: 24,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 16,
  fontFamily: 'monospace',
  fontSize: 13,
  color: '#eee',
  background: '#20242c',
};

const backButton: CSSProperties = {
  fontSize: 11,
  fontFamily: 'monospace',
  padding: '5px 10px',
  borderRadius: 5,
  border: '1px solid rgba(255,255,255,0.2)',
  background: 'rgba(255,255,255,0.05)',
  color: '#ddd',
  cursor: 'pointer',
};
