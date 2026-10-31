import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { resolveMatchArena } from '../../app/config';
import { KANTO_IDS, PLAY_LEVEL, PLAY_MODES, type PlayModeKind } from '../../app/playMode';
import { buildSpeciesMapForLevel, listAllSpecies, moveLookup } from '../../data/loader';
import { PlayerController } from '../../sim/action/playerController';
import { isMobileArena } from '../../sim/constants';
import { OnlineActionEngine } from '../../net/play/OnlineActionEngine';
import { PlayConnection } from '../../net/play/playConnection';
import type { PlayRoomSummary, PlayRoomView, SeatView, ServerMessage } from '../../net/play/playProtocol';
import type { ChatMessage, PredictionSummary, ShopSummary, WalletEventPayload } from '../../net/protocol';
import { SPECTATOR_NAME_MAX_LENGTH } from '../../net/chat';
import type { ItemId } from '../../net/shop';
import { SESSION_ID } from '../../net/sessionIdentity';
import { SPECTATOR_NAME } from '../../net/spectatorIdentity';
import { createSimStore, type SimStore } from '../state/simStore';
import { SpeciesPicker } from '../components/SpeciesPicker';
import { MoveCards } from '../components/MoveCards';
import { ActionMatchScreen } from './ActionMatchScreen';
import { ChatPanel, type ChatPanelProps } from '../chat/ChatPanel';
import { ChatSidebar } from '../chat/ChatSidebar';
import { ChatOverlay } from '../chat/ChatOverlay';
import { CHAT_SIDEBAR_MEDIA_QUERY } from '../chat/chatModel';
import type { PredictionsPanelProps } from '../predictions/PredictionsPanel';
import type { ShopPanelProps } from '../shop/ShopPanel';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { initialLockOn } from '../playModeSettings';
import { TEAM_A_COLOR_CSS, TEAM_B_COLOR_CSS } from '../teamColors';
import { BG, PRIMARY, PRIMARY_TEXT, TEXT, TEXT_MUTED, primaryAlpha, textAlpha } from '../theme';

const KANTO_SPECIES = listAllSpecies().filter((s) => KANTO_IDS.includes(s.id));
const SPECIES_NAME = new Map(KANTO_SPECIES.map((s) => [s.id, s.name]));
const MODE_LABEL = new Map(PLAY_MODES.map((m) => [m.value, m.label]));
const ROOM_LIST_POLL_MS = 3000;
const NAME_STORAGE_KEY = 'pokeclash.play.name';

/** The name picked at sign-up, remembered for next time. */
function storedName(): string | null {
  try {
    return localStorage.getItem(NAME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_STORAGE_KEY, name);
  } catch {
    // Storage blocked — they'll just sign up again next visit.
  }
}

/** Until someone signs up they play under the generated per-tab name. */
const HELLO_NAME = storedName() ?? SPECTATOR_NAME;

type Me = Extract<ServerMessage, { t: 'me' }>;

interface OnlineMatch {
  engine: OnlineActionEngine;
  /** Null while watching: a spectator has no fighter. */
  controller: PlayerController | null;
  store: SimStore;
  names: Record<string, string>;
}

/** Online Play Mode: #/play lists and creates rooms, #/play/<id> is one room's
 * lobby and, once its host starts, the match itself. One WebSocket for the
 * whole visit (see PlayConnection). */
export function PlayOnlineScreen({ roomId }: { roomId: string | null }) {
  const [conn, setConn] = useState<PlayConnection | null>(null);
  const [rooms, setRooms] = useState<PlayRoomSummary[]>([]);
  const [room, setRoom] = useState<PlayRoomView | null>(null);
  const [match, setMatch] = useState<OnlineMatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [settled, setSettled] = useState<WalletEventPayload['settled'] | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [market, setMarket] = useState<{ prediction: PredictionSummary | null; shop: ShopSummary | null }>({
    prediction: null,
    shop: null,
  });
  const matchRef = useRef<OnlineMatch | null>(null);
  matchRef.current = match;
  /** Set by a room list WATCH tap: join that room without taking a seat. */
  const watchNextRef = useRef(false);
  const wide = useMediaQuery(CHAT_SIDEBAR_MEDIA_QUERY);

  // Created in an effect, not a memo: StrictMode's dev remount must get a fresh socket, not a closed one.
  useEffect(() => {
    const created = new PlayConnection({ sessionId: SESSION_ID, name: HELLO_NAME });
    const remembered = storedName();
    if (remembered) created.send({ t: 'signup', name: remembered });
    setConn(created);
    return () => created.close();
  }, []);

  useEffect(
    () =>
      conn?.subscribe((m) => {
        switch (m.t) {
          case 'rooms':
            setRooms(m.rooms);
            return;
          case 'room':
            setRoom(m.room);
            setError(null);
            if (window.location.hash !== `#/play/${m.room.id}`) window.location.hash = `#/play/${m.room.id}`;
            return;
          case 'start': {
            // No fighter of your own (watching): '' matches no fighter, so the engine only mirrors the server.
            const engine = new OnlineActionEngine(
              m.config,
              buildSpeciesMapForLevel(m.config.speciesIds, PLAY_LEVEL),
              moveLookup,
              m.seed,
              m.you ?? '',
              (msg) => conn.send(msg)
            );
            setMatch({
              engine,
              controller: m.you ? new PlayerController(engine, initialLockOn()) : null,
              store: createSimStore(engine),
              names: m.names,
            });
            return;
          }
          case 'snap':
            matchRef.current?.engine.applySnapshot(m.s);
            return;
          case 'error':
            setError(m.message);
            return;
          case 'me':
            setMe(m);
            if (m.name) saveName(m.name);
            if (m.settled) setSettled(m.settled);
            return;
          case 'chat':
            setChat((current) => (m.reset ? m.messages : [...current, ...m.messages]));
            return;
          case 'market':
            setMarket({ prediction: m.prediction, shop: m.shop });
            return;
          case 'closed':
            setClosed(true);
            return;
        }
      }),
    [conn]
  );

  useEffect(() => {
    if (!conn) return;
    if (roomId) {
      conn.send({ t: 'join', roomId, watch: watchNextRef.current });
      watchNextRef.current = false;
      return;
    }
    conn.send({ t: 'leave' });
    setRoom(null);
    conn.send({ t: 'list' });
    const poll = setInterval(() => conn.send({ t: 'list' }), ROOM_LIST_POLL_MS);
    return () => clearInterval(poll);
  }, [conn, roomId]);

  if (!conn) return null;

  if (closed) {
    return (
      <div style={pageStyle}>
        <p>Lost the connection to the game server.</p>
        <button onClick={() => window.location.reload()} style={primaryButton(true)}>
          RECONNECT
        </button>
      </div>
    );
  }

  const spectator = room?.you === null;
  const chatProps: ChatPanelProps = {
    messages: chat,
    mySlotIndex: null,
    mySpectatorName: me?.name ?? HELLO_NAME,
    room: null,
    canSend: me?.name != null || room?.you != null,
    onSend: (text) => conn.request({ t: 'chat', text }),
    disabledPlaceholder: 'Sign up to chat',
  };
  const predictions: PredictionsPanelProps = {
    prediction: market.prediction,
    balance: me?.balance ?? null,
    myBet: me?.myBet ?? null,
    settled,
    canBet: spectator,
    onBet: (optionId, amount) => conn.request({ t: 'bet', optionId, amount }),
  };
  const shop: ShopPanelProps = {
    shop: market.shop,
    store: match?.store ?? null,
    balance: me?.balance ?? null,
    myItemUses: me?.myItemUses ?? 0,
    canBuy: spectator,
    onBuy: (itemId: ItemId, targetId: string) => conn.request({ t: 'buy', itemId, targetId }),
  };

  if (match) {
    return (
      <div style={{ width: '100vw', height: '100dvh', overflow: 'hidden', display: 'flex', background: '#101216' }}>
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <ActionMatchScreen
            store={match.store}
            engine={match.engine}
            controller={match.controller}
            names={match.names}
            playAgainLabel="BACK TO LOBBY"
            exitLabel="LEAVE ROOM"
            onPlayAgain={() => setMatch(null)}
            onExit={() => {
              setMatch(null);
              window.location.hash = '#/play';
            }}
            netInfo={() => (conn.rttMs !== null ? `${conn.rttMs} ms` : null)}
          />
          {/* On a phone the drawer would sit on a fighter's joystick, so only spectators get it there. */}
          {!wide && !match.controller && <ChatOverlay {...chatProps} predictions={predictions} shop={shop} />}
          {spectator && !me?.name && (
            <div style={signUpFloat}>
              <SignUpForm me={me} conn={conn} error={error} prompt="Sign up to chat, bet and buy potions" />
            </div>
          )}
        </div>
        {wide && <ChatSidebar {...chatProps} predictions={predictions} shop={shop} />}
      </div>
    );
  }

  if (roomId && room) return <Lobby room={room} conn={conn} error={error} me={me} chatProps={chatProps} />;
  return (
    <RoomList
      rooms={rooms}
      conn={conn}
      error={roomId ? null : error}
      me={me}
      onWatch={(id) => {
        watchNextRef.current = true;
        window.location.hash = `#/play/${id}`;
      }}
    />
  );
}

/** Sign-up: the name you chat, bet and buy under (and play under, if seated). */
function SignUpForm({ me, conn, error, prompt }: { me: Me | null; conn: PlayConnection; error: string | null; prompt?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(me?.name ?? storedName() ?? '');
  if (me?.name && !editing) {
    return (
      <div style={signUpRow}>
        <span style={{ flex: 1 }}>
          Signed up as <b>{me.name}</b> · ${me.balance.toLocaleString()}
        </span>
        <button onClick={() => setEditing(true)} style={pill(false)}>
          Change name
        </button>
      </div>
    );
  }
  const submit = () => {
    if (draft.trim().length === 0) return;
    conn.send({ t: 'signup', name: draft });
    setEditing(false);
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      style={{ ...signUpRow, flexWrap: 'wrap' }}
    >
      {prompt && <span style={{ width: '100%', fontWeight: 'bold' }}>{prompt}</span>}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={SPECTATOR_NAME_MAX_LENGTH}
        placeholder="Your name"
        aria-label="Your name"
        style={nameInput}
      />
      <button type="submit" disabled={draft.trim().length === 0} style={pill(true)}>
        SIGN UP
      </button>
      {error && <span style={{ ...errorStyle, width: '100%' }}>{error}</span>}
    </form>
  );
}

function RoomList({
  rooms,
  conn,
  error,
  me,
  onWatch,
}: {
  rooms: PlayRoomSummary[];
  conn: PlayConnection;
  error: string | null;
  me: Me | null;
  onWatch: (roomId: string) => void;
}) {
  const create = (mode: PlayModeKind) => conn.send({ t: 'create', mode, arena: resolveMatchArena(true) });
  return (
    <div style={pageStyle}>
      <Header title="PLAY ONLINE" backHref="#/local" />
      <p style={subtitle}>
        Real players, real time. Empty seats are filled with bots. Watchers can chat, bet on the winner and buy potions for the fighters.
      </p>
      <section style={section}>
        <SignUpForm me={me} conn={conn} error={error} />
      </section>
      <section style={section}>
        <h2 style={heading}>Create a room</h2>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PLAY_MODES.map((m) => (
            <button key={m.label} onClick={() => create(m.value)} style={pill(false)}>
              + {m.label}
            </button>
          ))}
        </div>
      </section>
      <section style={section}>
        <h2 style={heading}>Open rooms</h2>
        {rooms.length === 0 && <p style={{ ...subtitle, textAlign: 'left' }}>None yet — create one and share the link.</p>}
        {rooms.map((r) => (
          <div key={r.id} style={roomRow}>
            <span style={{ flex: 1 }}>
              <b>{MODE_LABEL.get(r.mode)}</b> · {r.players}/{r.seats} players · {r.phase === 'battle' ? 'in a match' : 'in lobby'}
            </span>
            <button onClick={() => onWatch(r.id)} style={pill(false)}>
              WATCH
            </button>
            <a href={`#/play/${r.id}`} style={{ ...pill(true), textDecoration: 'none' }}>
              JOIN
            </a>
          </div>
        ))}
      </section>
    </div>
  );
}

function Lobby({
  room,
  conn,
  error,
  me,
  chatProps,
}: {
  room: PlayRoomView;
  conn: PlayConnection;
  error: string | null;
  me: Me | null;
  chatProps: ChatPanelProps;
}) {
  const [copied, setCopied] = useState(false);
  const you = room.you !== null ? room.seats[room.you] : null;
  const taken = room.seats.filter((s) => s.index !== room.you && s.speciesId !== null).map((s) => s.speciesId!);
  const seated = room.seats.filter((s) => s.name !== null);
  const canStart = seated.length > 0 && seated.every((s) => s.ready);
  const copyLink = () => {
    void navigator.clipboard?.writeText(window.location.href).then(() => setCopied(true));
  };
  const teams =
    room.mode === 'ffa' ? [room.seats] : [room.seats.filter((s) => s.team === 'teamA'), room.seats.filter((s) => s.team === 'teamB')];

  return (
    <div style={pageStyle}>
      <Header title={`ROOM ${room.id.toUpperCase()} · ${MODE_LABEL.get(room.mode)}`} backHref="#/play" />
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        <button onClick={copyLink} style={pill(false)}>
          {copied ? '✓ Link copied' : '🔗 Copy invite link'}
        </button>
        <span style={{ fontSize: 11, color: TEXT_MUTED }}>{isMobileArena(room.arena) ? 'Portrait arena' : 'Wide arena'}</span>
      </div>
      {room.phase === 'battle' && <p style={noticeStyle}>A match is in progress — you’ll get a seat when it ends.</p>}
      <section style={section}>
        <SignUpForm me={me} conn={conn} error={error} />
      </section>

      {you?.host && room.phase === 'lobby' && (
        <section style={section}>
          <h2 style={heading}>Mode (host)</h2>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {PLAY_MODES.map((m) => (
              <button key={m.label} onClick={() => conn.send({ t: 'mode', mode: m.value })} style={pill(room.mode === m.value)}>
                {m.label}
              </button>
            ))}
          </div>
        </section>
      )}

      <section style={{ ...section, display: 'flex', gap: 12 }}>
        {teams.map((seats, i) => (
          <div key={i} style={{ flex: 1, minWidth: 0 }}>
            {room.mode !== 'ffa' && (
              <h2
                style={{
                  ...heading,
                  color: i === 0 ? TEAM_A_COLOR_CSS : TEAM_B_COLOR_CSS,
                }}
              >
                Team {i === 0 ? 'A' : 'B'}
              </h2>
            )}
            {seats.map((seat) => (
              <SeatRow
                key={seat.index}
                seat={seat}
                you={seat.index === room.you}
                onTake={() => conn.send({ t: 'seat', index: seat.index })}
              />
            ))}
          </div>
        ))}
      </section>

      {you && room.phase === 'lobby' && (
        <section style={section}>
          <h2 style={heading}>Your Pokémon</h2>
          {you.speciesId !== null && (
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <span style={chosenChip}>{SPECIES_NAME.get(you.speciesId)}</span>
              <button onClick={() => conn.send({ t: 'reroll' })} style={pill(false)}>
                🎲 Reroll moves
              </button>
            </div>
          )}
          <SpeciesPicker
            allSpecies={KANTO_SPECIES}
            excludeSpeciesIds={[...taken, ...(you.speciesId !== null ? [you.speciesId] : [])]}
            onPick={(id) => conn.send({ t: 'pick', speciesId: id })}
          />
          {you.moves.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <MoveCards moveIds={you.moves} />
            </div>
          )}
          <div
            style={{
              display: 'flex',
              gap: 8,
              marginTop: 12,
              justifyContent: 'center',
            }}
          >
            <button
              onClick={() => conn.send({ t: 'ready', ready: !you.ready })}
              disabled={you.speciesId === null}
              style={primaryButton(you.speciesId !== null, !you.ready)}
            >
              {you.ready ? 'NOT READY' : 'READY'}
            </button>
            {you.host && (
              <button onClick={() => conn.send({ t: 'start' })} disabled={!canStart} style={primaryButton(canStart)}>
                START
              </button>
            )}
          </div>
          <p style={{ ...subtitle, marginTop: 6 }}>
            {you.host
              ? 'Start once everyone seated is ready — bots take the open seats.'
              : 'The host starts the match once everyone is ready.'}
          </p>
        </section>
      )}
      {!you && room.phase === 'lobby' && (
        <p style={noticeStyle}>
          {room.seats.some((s) => s.name === null)
            ? 'You’re watching — tap an open seat to play.'
            : 'All seats are taken — you’re watching. Tap a seat when one frees up.'}
        </p>
      )}
      <section style={section}>
        <h2 style={heading}>Room chat</h2>
        <ChatPanel {...chatProps} listHeight={200} />
      </section>
    </div>
  );
}

function SeatRow({ seat, you, onTake }: { seat: SeatView; you: boolean; onTake: () => void }) {
  if (seat.name === null) {
    return (
      <button
        onClick={onTake}
        style={{
          ...seatStyle,
          borderStyle: 'dashed',
          color: TEXT_MUTED,
          cursor: 'pointer',
          width: '100%',
        }}
      >
        Open seat · bot · tap to sit
      </button>
    );
  }
  return (
    <div
      style={{
        ...seatStyle,
        outline: you ? `2px solid ${PRIMARY}` : undefined,
      }}
    >
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {seat.host ? '★ ' : ''}
        <b>{seat.name}</b>
        {you ? ' (you)' : ''} · {seat.speciesId !== null ? SPECIES_NAME.get(seat.speciesId) : 'picking…'}
      </span>
      <span
        style={{
          color: seat.ready ? '#859900' : TEXT_MUTED,
          fontWeight: 'bold',
        }}
      >
        {seat.ready ? 'READY' : '…'}
      </span>
    </div>
  );
}

function Header({ title, backHref }: { title: string; backHref: string }) {
  return (
    <div
      style={{
        width: '100%',
        maxWidth: 460,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <a href={backHref} style={backButton}>
        ← BACK
      </a>
      <h1 style={{ fontSize: 16, letterSpacing: 1, margin: 0, flex: 1 }}>{title}</h1>
    </div>
  );
}

const pageStyle: CSSProperties = {
  width: '100%',
  minHeight: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 18,
  padding: 24,
  boxSizing: 'border-box',
  fontFamily: 'monospace',
  color: TEXT,
  background: BG,
};
const section: CSSProperties = { width: '100%', maxWidth: 460 };
const heading: CSSProperties = {
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: 1,
  opacity: 0.65,
  margin: '0 0 8px',
};
const subtitle: CSSProperties = {
  margin: 0,
  opacity: 0.7,
  fontSize: 12,
  textAlign: 'center',
};
const errorStyle: CSSProperties = { margin: 0, fontSize: 12, color: '#dc322f' };
const signUpRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  padding: '8px 10px',
  borderRadius: 6,
  border: `1px solid ${textAlpha(0.15)}`,
  background: textAlpha(0.04),
  color: TEXT,
  fontFamily: 'monospace',
  boxSizing: 'border-box',
};
const nameInput: CSSProperties = {
  flex: 1,
  minWidth: 120,
  fontSize: 13,
  fontFamily: 'monospace',
  padding: '6px 8px',
  borderRadius: 5,
  border: `1px solid ${textAlpha(0.25)}`,
  background: BG,
  color: TEXT,
};
/** The match view's sign-up card for spectators, top-centre over the arena. */
const signUpFloat: CSSProperties = {
  position: 'absolute',
  top: 52,
  left: '50%',
  transform: 'translateX(-50%)',
  width: 'min(92%, 360px)',
  background: BG,
  borderRadius: 8,
  boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
  zIndex: 20,
};
const noticeStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: '#cb4b16',
  textAlign: 'center',
};
const roomRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  padding: '8px 10px',
  marginBottom: 6,
  borderRadius: 6,
  border: `1px solid ${textAlpha(0.15)}`,
  background: textAlpha(0.04),
};
const seatStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
  fontFamily: 'monospace',
  padding: '7px 9px',
  marginBottom: 6,
  borderRadius: 6,
  border: `1px solid ${textAlpha(0.2)}`,
  background: textAlpha(0.04),
  boxSizing: 'border-box',
  textAlign: 'left',
};
const chosenChip: CSSProperties = {
  fontSize: 13,
  fontWeight: 'bold',
  textTransform: 'uppercase',
  padding: '6px 12px',
  borderRadius: 6,
  border: `2px solid ${PRIMARY}`,
  background: primaryAlpha(0.12),
};
const backButton: CSSProperties = {
  fontSize: 11,
  fontFamily: 'monospace',
  padding: '5px 10px',
  borderRadius: 5,
  border: `1px solid ${textAlpha(0.2)}`,
  background: textAlpha(0.05),
  color: TEXT,
  textDecoration: 'none',
};
function pill(active: boolean): CSSProperties {
  return {
    fontSize: 12,
    fontFamily: 'monospace',
    padding: '6px 12px',
    borderRadius: 16,
    border: active ? `1px solid ${PRIMARY}` : `1px solid ${textAlpha(0.2)}`,
    background: active ? primaryAlpha(0.18) : textAlpha(0.05),
    color: active ? PRIMARY : TEXT_MUTED,
    cursor: 'pointer',
  };
}
function primaryButton(enabled: boolean, filled = true): CSSProperties {
  return {
    padding: '11px 28px',
    fontSize: 14,
    fontFamily: 'monospace',
    fontWeight: 'bold',
    letterSpacing: 1,
    color: enabled && filled ? PRIMARY_TEXT : enabled ? PRIMARY : TEXT_MUTED,
    background: enabled && filled ? PRIMARY : textAlpha(0.08),
    border: enabled && !filled ? `2px solid ${PRIMARY}` : 'none',
    borderRadius: 6,
    cursor: enabled ? 'pointer' : 'not-allowed',
  };
}
