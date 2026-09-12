import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { RoomConnection } from '../../net/RoomConnection';
import { RemoteSimEngine } from '../../net/RemoteSimEngine';
import type {
  BetRequest,
  BetResponse,
  BuyItemRequest,
  BuyItemResponse,
  ChatMessage,
  ChatRequest,
  JoinRoomRequest,
  JoinRoomResponse,
  MyBet,
  PredictionSummary,
  RoomSummary,
  ShopSummary,
  WalletEventPayload,
} from '../../net/protocol';
import type { ItemId } from '../../net/shop';
import { resolveMatchArena } from '../../app/config';
import { SPECTATOR_NAME } from '../../net/spectatorIdentity';
import { SESSION_ID } from '../../net/sessionIdentity';
import { createSimStore, type SimStore } from '../state/simStore';
import { ChatSidebar } from '../chat/ChatSidebar';
import type { ChatPanelProps } from '../chat/ChatPanel';
import { appendChatMessage, CHAT_SIDEBAR_MEDIA_QUERY } from '../chat/chatModel';
import type { PredictionsPanelProps } from '../predictions/PredictionsPanel';
import type { ShopPanelProps } from '../shop/ShopPanel';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useWideArenaPreference } from '../hooks/useWideArenaPreference';
import { useRoomThumbnailCapture } from '../hooks/useRoomThumbnailCapture';
import { useCountdown } from '../../net/useCountdown';
import { MatchScreen } from './MatchScreen';
import { RoomLobbyScreen } from './RoomLobbyScreen';
import { BG, TEXT, textAlpha } from '../theme';

interface RoomScreenProps {
  roomId: string;
  /** True when mounted inside the landing page's featured panel rather than
   * at its own full route — suppresses the "← BACK" control during the
   * brief connecting flash, since there's no separate rooms page to go back
   * to from there, and marks the predictions panel read-only (the embed is
   * covered by a click-through button anyway). */
  embedded?: boolean;
}

function playerIdStorageKey(roomId: string): string {
  return `poke-clash:player:${roomId}`;
}

export function RoomScreen({ roomId, embedded = false }: RoomScreenProps) {
  const [room, setRoom] = useState<RoomSummary | null>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  // The seat's bearer token (for pick/chat), remembered per room so a reload
  // keeps the seat. Which seat it is comes from the server (HelloPayload.me /
  // JoinRoomResponse.slotIndex) — seat tokens are never broadcast.
  const [playerId, setPlayerId] = useState<string | null>(() => sessionStorage.getItem(playerIdStorageKey(roomId)));
  const [mySlotIndex, setMySlotIndex] = useState<number | null>(null);
  const [store, setStore] = useState<SimStore | null>(null);
  // Plain state is enough for chat: even a full room mashing quick reactions
  // is a few renders a second, well under the HUD's own 10 Hz refresh.
  const [chatLog, setChatLog] = useState<ChatMessage[]>([]);
  // The predictions pool and this tab's own wallet view of it. `prediction`
  // is kept through a lobby reset (so the settled result stays readable
  // until the next battle opens a fresh pool) but replaced wholesale by
  // every hello, same as the chat backlog.
  const [prediction, setPrediction] = useState<PredictionSummary | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [myBet, setMyBet] = useState<MyBet | null>(null);
  const [settled, setSettled] = useState<WalletEventPayload['settled'] | null>(null);
  // The room's item shop for the running match, and how much of this tab's
  // per-match allowance is spent (see SessionPrivate.myItemUses).
  const [shop, setShop] = useState<ShopSummary | null>(null);
  const [myItemUses, setMyItemUses] = useState(0);
  // The stream failed to (re)open — shown instead of a bare "Connecting…"
  // that would otherwise sit there forever for a dead server or a stale
  // room link, with no way out. EventSource retries by itself; a `hello`
  // clears this.
  const [connectionError, setConnectionError] = useState(false);
  const [wideArena] = useWideArenaPreference();
  // The live engine behind `store`, for the 10 Hz stateUpdate handler to
  // feed without going through React state at all.
  const engineRef = useRef<RemoteSimEngine | null>(null);
  /** The match the shop frames seen so far belong to — a change means a new
   * round, which resets this tab's per-match item allowance. A ref rather
   * than state because it's only ever read inside the handler that sets it. */
  const shopMatchNoRef = useRef<number | null>(null);

  const forgetSeat = useCallback(() => {
    sessionStorage.removeItem(playerIdStorageKey(roomId));
    setPlayerId(null);
    setMySlotIndex(null);
  }, [roomId]);

  useEffect(() => {
    setRoom(null);
    setStore(null);
    setMySlotIndex(null);
    setChatLog([]);
    setPrediction(null);
    setBalance(null);
    setMyBet(null);
    setSettled(null);
    setConnectionError(false);
    engineRef.current = null;

    const conn = new RoomConnection(roomId, SESSION_ID, {
      onHello(payload) {
        setConnectionError(false);
        setRoom(payload.room);
        // Replaced wholesale, not merged: hello arrives on every EventSource
        // (re)connect and the server's backlog is the authority on what was
        // said while this client was away.
        setChatLog(payload.chatLog);
        setPrediction(payload.prediction);
        setShop(payload.shop);
        if (payload.me) {
          setBalance(payload.me.balance);
          setMyBet(payload.me.myBet);
          setMyItemUses(payload.me.myItemUses);
          setMySlotIndex(payload.me.mySlotIndex);
          // A seat remembered from an earlier session in this room no longer
          // exists once the room has reset — without this, the stale token
          // would permanently hide JOIN ROOM (canJoin needs no seat) even
          // though the room is actually empty.
          if (payload.me.mySlotIndex === null) forgetSeat();
        }
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
        setSettled(null);
      },
      onStateUpdate(payload) {
        engineRef.current?.applyServerUpdate(payload.state, payload.events);
      },
      onBattleComplete(payload) {
        engineRef.current?.applyServerUpdate(payload.finalState, payload.events);
      },
      onLobbyReset(summary) {
        setRoom(summary);
        setChatLog([]);
        // Seats are wiped with the reset (see roomManager's resetRoom), so
        // whatever this tab held is gone; its bet, if any, was settled.
        forgetSeat();
        setMyBet(null);
        // The shelf belongs to the match it was stocked for; the next round
        // gets a fresh one (and a fresh allowance) from its own battleStart.
        setShop(null);
        setMyItemUses(0);
        // The always-on showcase room keeps its arena on screen through the
        // gap between rounds (see the `inMatch` / `postMatchCountdownLabel`
        // below) — tearing the store/engine down here would blank the map
        // out from under that "next round in Ns" countdown. A regular room
        // has nothing to freeze (nobody's picked yet next round anyway), so
        // it keeps resetting to the lobby/seat-picking screen as before.
        if (!summary.autoPlay) {
          setStore(null);
          engineRef.current = null;
        }
      },
      onChat(message) {
        setChatLog((log) => appendChatMessage(log, message));
      },
      onPrediction(summary) {
        setPrediction(summary);
      },
      onShop(summary) {
        setShop(summary);
        // A fresh shelf means a new match, so this tab's allowance resets
        // with it — the hello is the only other thing that sets this, and a
        // reconnect mid-match must not hand out a second purchase.
        setMyItemUses((current) => (summary.matchNo !== shopMatchNoRef.current ? 0 : current));
        shopMatchNoRef.current = summary.matchNo;
      },
      onWallet(payload) {
        setBalance(payload.balance);
        setMyBet(payload.myBet);
        if (payload.settled) setSettled(payload.settled);
      },
      onError() {
        setConnectionError(true);
      },
    });

    return () => conn.close();
  }, [roomId, forgetSeat]);

  const handleJoin = () => {
    // My own arena choice rides along: if this join is what gets the room
    // going, the room takes it (see JoinRoomRequest.arena) — so the Wide
    // Arena toggle applies to a pre-seeded room too, not only to rooms I
    // created myself.
    const body: JoinRoomRequest = { sessionId: SESSION_ID, arena: resolveMatchArena(wideArena) };
    fetch(`/api/rooms/${roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((res) =>
        res.json().then((data: Partial<JoinRoomResponse>) => {
          if (!res.ok || !data.playerId || data.slotIndex === undefined) return; // room filled/started first — stay a spectator, JOIN stays available
          sessionStorage.setItem(playerIdStorageKey(roomId), data.playerId);
          setPlayerId(data.playerId);
          setMySlotIndex(data.slotIndex);
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

  // Memoized so the match overlay's ChatOverlay (React.memo) keeps its props
  // stable across this screen's re-renders (room updates, the showcase
  // room's 4 Hz between-round countdown).
  const handleSendChat = useCallback(async (text: string): Promise<string | null> => {
    // Every room supports chat, seat or no seat (see spectatorIdentity.ts) —
    // a seat's playerId is used when there is one, this tab's generated
    // display name otherwise. The session id just stamps the balance.
    const request: ChatRequest =
      playerId !== null ? { playerId, sessionId: SESSION_ID, text } : { spectatorName: SPECTATOR_NAME, sessionId: SESSION_ID, text };
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
  }, [playerId, roomId]);

  const handleBet = useCallback(async (optionId: string, amount: number): Promise<string | null> => {
    const request: BetRequest = { sessionId: SESSION_ID, optionId, amount };
    try {
      const res = await fetch(`/api/rooms/${roomId}/bet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const body = (await res.json().catch(() => null)) as (Partial<BetResponse> & { error?: string }) | null;
      if (!res.ok || !body?.wallet || !body.myBet || !body.prediction) return body?.error ?? 'bet_failed';
      setBalance(body.wallet.balance);
      setMyBet(body.myBet);
      setPrediction(body.prediction);
      return null;
    } catch {
      return 'bet_failed';
    }
  }, [roomId]);

  const handleBuyItem = useCallback(async (itemId: ItemId, targetInstanceId: string): Promise<string | null> => {
    // The spectator name rides along for the announcement; the server ignores
    // it when this session holds a seat (see resolveBuyerName).
    const request: BuyItemRequest = { sessionId: SESSION_ID, itemId, targetInstanceId, spectatorName: SPECTATOR_NAME };
    try {
      const res = await fetch(`/api/rooms/${roomId}/item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const body = (await res.json().catch(() => null)) as (Partial<BuyItemResponse> & { error?: string }) | null;
      if (!res.ok || !body?.wallet || !body.shop || body.myItemUses === undefined) return body?.error ?? 'buy_failed';
      // Optimistic, exactly like handleBet: the broadcast confirms the same
      // numbers for everyone else a moment later.
      setBalance(body.wallet.balance);
      setMyItemUses(body.myItemUses);
      setShop(body.shop);
      return null;
    } catch {
      return 'buy_failed';
    }
  }, [roomId]);

  // "You" is whichever seat the server says is mine (HelloPayload.me /
  // JoinRoomResponse), otherwise this tab's generated spectator identity.
  // Every room supports chat now (see spectatorIdentity.ts), seated or not,
  // so canSend is unconditional.
  const chat: ChatPanelProps = {
    messages: chatLog,
    mySlotIndex,
    mySpectatorName: SPECTATOR_NAME,
    room,
    canSend: true,
    onSend: handleSendChat,
  };

  // The landing page's embed is covered by one big "open this room" button,
  // so its panel is a preview: same numbers, no taps.
  const predictions: PredictionsPanelProps = {
    prediction,
    balance,
    myBet,
    settled,
    canBet: !embedded,
    onBet: handleBet,
  };

  // `store` is passed through rather than the sim state itself: the panel
  // subscribes to it on its own, which keeps the 10 Hz HUD tick out of this
  // screen and out of the memoized ChatOverlay (see ShopPanel).
  const shopPanel: ShopPanelProps = {
    shop,
    store,
    balance,
    myItemUses,
    canBuy: !embedded,
    onBuy: handleBuyItem,
  };

  // One log, two presentations. Wide viewport: a stream-style chat column
  // beside whatever this screen is showing (lobby or match). Narrow: the
  // lobby embeds the panel inline and the match draws it over the arena.
  const sidebar = useMediaQuery(CHAT_SIDEBAR_MEDIA_QUERY);
  // Regular rooms only ever have a store while phase is battle/complete (see
  // onLobbyReset above); the always-on showcase room keeps its store through
  // idle/countdown too, so `room.autoPlay` alone covers its whole loop here.
  const inMatch = room !== null && store !== null && (room.phase === 'battle' || room.phase === 'complete' || room.autoPlay);

  // My own Pokémon in the battle roster — instance ids are `p${slotIndex}-${speciesId}`
  // (see matchSetup.ts) and game-server builds MatchConfig.speciesIds in slot
  // order, so my seat's index into `allInstanceIds` is my own Pokémon. The
  // roster is fixed for a match, so reading it off the engine at render is safe.
  const allInstanceIds = store?.getEngine().getState().allInstanceIds ?? null;
  const highlightInstanceId = allInstanceIds && mySlotIndex !== null ? (allInstanceIds[mySlotIndex] ?? null) : null;
  // Balance per fighter for the roster HUD ("PIPLUP ($100)") — only seats a
  // human holds have one; the showcase room's auto-filled seats stay bare.
  const slotBalances = useMemo(() => {
    if (!allInstanceIds || !room) return undefined;
    const balances: Record<string, number | null> = {};
    room.slots.forEach((slot, index) => {
      const id = allInstanceIds[index];
      if (id !== undefined && slot.occupied) balances[id] = slot.balance;
    });
    return balances;
  }, [allInstanceIds, room]);

  // The showcase room's "next round in Ns" banner, shown in place of the
  // frozen previous match's own WINS banner during that gap (see
  // MatchScreen's bannerOverrideText / BannerOverlay's overrideText).
  const showingPostMatchCountdown = room !== null && room.autoPlay && (room.phase === 'idle' || room.phase === 'countdown');
  const postMatchRemainingMs = useCountdown(showingPostMatchCountdown ? (room?.countdownEndsAtMs ?? null) : null);
  const postMatchCountdownLabel = showingPostMatchCountdown
    ? `NEXT ROUND IN ${Math.max(1, Math.ceil(postMatchRemainingMs / 1000))}s`
    : undefined;

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
            leaveControlLabel={embedded || room.autoPlay ? undefined : 'LEAVE ROOM'}
            completeButtonLabel="BACK TO ROOMS"
            highlightInstanceId={highlightInstanceId}
            onCanvasReady={setCanvas}
            captureFrames={!room.autoPlay}
            chat={sidebar ? undefined : { ...chat, predictions, shop: shopPanel }}
            bannerOverrideText={postMatchCountdownLabel}
            viewerCount={embedded ? undefined : room.viewerCount}
            showCompleteControl={!embedded}
            slotBalances={slotBalances}
          />
        )}
        {room && !inMatch && (
          <RoomLobbyScreen
            room={room}
            mySlotIndex={mySlotIndex}
            onJoin={handleJoin}
            onPick={handlePick}
            chat={sidebar ? undefined : chat}
            predictions={sidebar ? undefined : predictions}
          />
        )}
      </div>
      {room && sidebar && <ChatSidebar {...chat} predictions={predictions} shop={shopPanel} />}
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
  color: TEXT,
  background: BG,
};

const backButton: CSSProperties = {
  fontSize: 11,
  fontFamily: 'monospace',
  padding: '5px 10px',
  borderRadius: 5,
  border: `1px solid ${textAlpha(0.2)}`,
  background: textAlpha(0.05),
  color: TEXT,
  cursor: 'pointer',
};
