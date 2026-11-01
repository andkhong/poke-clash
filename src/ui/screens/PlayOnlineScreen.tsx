import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { resolveMatchArena } from '../../app/config';
import { KANTO_IDS, PLAY_LEVEL, PLAY_MODES, type PlayModeKind } from '../../app/playMode';
import { buildSpeciesMapForLevel, listAllSpecies, moveLookup } from '../../data/loader';
import { PlayerController } from '../../sim/action/playerController';
import { isMobileArena } from '../../sim/constants';
import { OnlineActionEngine } from '../../net/play/OnlineActionEngine';
import { PlayConnection } from '../../net/play/playConnection';
import type { CrowdCardId, CrowdSide, PlayRoomSummary, PlayRoomView, SeatView, ServerMessage } from '../../net/play/playProtocol';
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
import { typeColorCss, typeTextCss } from '../typeColorCss';
import {
  ACTION,
  CROWD_TINT,
  FONT_BODY,
  FONT_PIXEL,
  FONT_UI,
  FRAME,
  GROUND,
  GROUND_ROUTE,
  HP_GREEN,
  HP_RED,
  INFO_BOX,
  INK,
  INK_MUTED,
  OUTLINE,
  PANEL,
  RUBY,
  STAGE_BG,
  SUNK,
  primaryAlpha,
  CROWD_TEXT,
} from '../theme';
import type { CrowdCallPanelProps } from '../crowd/CrowdCallPanel';
import { createCrowdCallsStore, isCrowdSide } from '../crowd/crowdModel';
import { chip, hoennButton, hoennButtonSm, teamMarker } from '../crowd/hoenn';

const KANTO_SPECIES = listAllSpecies().filter((s) => KANTO_IDS.includes(s.id));
const SPECIES_NAME = new Map(KANTO_SPECIES.map((s) => [s.id, s.name]));
const MODE_LABEL = new Map(PLAY_MODES.map((m) => [m.value, m.label]));
const ROOM_LIST_POLL_MS = 3000;
const NAME_STORAGE_KEY = 'pokeclash.play.name';
/** The match sidebar is wider than the default chat column so chat lines and the vote rows' labels don't wrap. */
const MATCH_SIDEBAR_WIDTH = 400;

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

/** One line for Results: what the viewer's bet did, plus the watch reward. */
function betResultText(settled: WalletEventPayload['settled'] | null): string | null {
  if (!settled) return null;
  const watched = settled.watched > 0 ? `+$${settled.watched} for watching` : '';
  if (settled.staked <= 0) return watched || null;
  const net = settled.returned - settled.staked;
  const bet = net > 0 ? `Won $${net}` : net === 0 ? `Refunded $${settled.staked}` : `Lost $${settled.staked}`;
  return watched ? `${bet} · ${watched}` : bet;
}

/** Online Play Mode: #/play lists and creates rooms, #/play/<id> is one room's
 * lobby and, once its host starts, the match itself. One WebSocket for the
 * whole visit (see PlayConnection). */
export function PlayOnlineScreen({
  roomId,
  watch = false,
}: {
  roomId: string | null;
  /** Join `roomId` as a spectator (the `?watch` link). */
  watch?: boolean;
}) {
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
  // Crowd Calls arrive ~4×/s while voting; kept out of React state so they don't re-render the chat.
  const calls = useMemo(createCrowdCallsStore, []);
  const matchRef = useRef<OnlineMatch | null>(null);
  matchRef.current = match;
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
            if (window.location.hash.replace(/\?watch$/, '') !== `#/play/${m.room.id}`) window.location.hash = `#/play/${m.room.id}`;
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
            calls.set({ current: null, history: [] });
            setSettled(null);
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
          case 'calls':
            calls.set({ current: m.current, history: m.history });
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
    [conn, calls]
  );

  useEffect(() => {
    if (!conn) return;
    if (roomId) {
      conn.send({ t: 'join', roomId, watch });
      return;
    }
    conn.send({ t: 'leave' });
    setRoom(null);
    conn.send({ t: 'list' });
    const poll = setInterval(() => conn.send({ t: 'list' }), ROOM_LIST_POLL_MS);
    return () => clearInterval(poll);
  }, [conn, roomId, watch]);

  const onVote = useCallback(
    (side: CrowdSide, card: CrowdCardId) => conn?.request({ t: 'vote', side, card }) ?? Promise.resolve('send_failed'),
    [conn]
  );

  if (!conn) return null;

  if (closed) {
    return (
      <div style={{ ...pageStyle, justifyContent: 'center' }}>
        <p style={{ fontFamily: FONT_UI, fontSize: 22 }}>Lost the connection to the game server.</p>
        <button onClick={() => window.location.reload()} style={hoennButton('primary', true, 'lg')}>
          Reconnect
        </button>
      </div>
    );
  }

  const spectator = room?.you === null;
  const chatProps: ChatPanelProps = {
    messages: chat,
    mySpectatorName: me?.name ?? HELLO_NAME,
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
    const fighterTeam = match.controller ? match.engine.getState().pokemon[match.engine.playerId]?.team : null;
    const side = match.controller ? (isCrowdSide(fighterTeam) ? fighterTeam : null) : (me?.side ?? null);
    // Signed up already, it's the "Signed up as … · Change name" row, so a viewer can see (and change) who they are.
    const joinNext = spectator && room?.phase === 'battle' && (
      <JoinNextMatch queued={room.queued} onToggle={() => conn.send({ t: 'queue', join: !room.queued })} />
    );
    const signUp = spectator && (
      <>
        <SignUpForm me={me} conn={conn} error={error} prompt="Join the crowd to vote, chat and bet" variant="crowd" />
        {joinNext}
      </>
    );
    const vote: CrowdCallPanelProps = {
      calls,
      store: match.store,
      teams: !!match.engine.getState().teams,
      side,
      myVote: me?.myVote ?? null,
      signedUp: !!me?.name,
      fighter: !!match.controller,
      onVote,
      signUp: signUp || undefined,
    };
    return (
      <div style={{ width: '100vw', height: '100dvh', overflow: 'hidden', display: 'flex', background: STAGE_BG }}>
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
            crowd={{ calls, side: me?.side ?? null, betResult: spectator ? betResultText(settled) : null }}
          />
          {/* On a phone the drawer would sit on a fighter's joystick, so only spectators get it there. */}
          {!wide && !match.controller && <ChatOverlay {...chatProps} vote={vote} predictions={predictions} shop={shop} />}
          {!wide && signUp && (me?.name ? joinNext && <div style={signUpFloat}>{joinNext}</div> : <div style={signUpFloat}>{signUp}</div>)}
        </div>
        {wide && <ChatSidebar {...chatProps} vote={vote} predictions={predictions} shop={shop} width={MATCH_SIDEBAR_WIDTH} />}
      </div>
    );
  }

  if (roomId && room) return <Lobby room={room} conn={conn} error={error} me={me} chatProps={chatProps} wide={wide} />;
  return (
    <RoomList
      rooms={rooms}
      conn={conn}
      error={roomId ? null : error}
      me={me}
      onWatch={(id) => {
        window.location.hash = `#/play/${id}?watch`;
      }}
    />
  );
}

/** Mid-match, a watcher reserves a seat in the next match (or gives it back). */
function JoinNextMatch({ queued, onToggle }: { queued: boolean; onToggle: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button onClick={onToggle} aria-pressed={queued} style={hoennButton(queued ? 'secondary' : 'primary')}>
        {queued ? '✓ Seat saved · cancel' : '▶ Join next match'}
      </button>
      <span style={{ fontSize: 12, color: INK_MUTED, textAlign: 'center' }}>
        {queued
          ? 'You’ll get a seat when this one ends — pick a Pokémon in the break, or get a random one.'
          : 'Fight in the next match instead of watching.'}
      </span>
    </div>
  );
}

/** Sign-up: the name you chat, bet, buy and vote under (and play under, if seated). */
function SignUpForm({
  me,
  conn,
  error,
  prompt,
  variant = 'plain',
}: {
  me: Me | null;
  conn: PlayConnection;
  error: string | null;
  prompt?: string;
  /** 'crowd': the mock's green "Join the crowd" card. */
  variant?: 'plain' | 'crowd';
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(me?.name ?? storedName() ?? '');
  const crowd = variant === 'crowd';
  if (me?.name && !editing) {
    return (
      <div style={{ ...signUpBox, ...(crowd ? signUpBoxCompact : null), flexDirection: 'row', alignItems: 'center', background: INFO_BOX }}>
        <span style={{ flex: 1, fontSize: crowd ? 13 : 15 }}>
          Signed up as <b>{me.name}</b>
        </span>
        <span style={chip(ACTION)}>${me.balance.toLocaleString()}</span>
        <button onClick={() => setEditing(true)} style={crowd ? hoennButtonSm('secondary', true, false) : hoennButton('secondary')}>
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
  const ready = draft.trim().length > 0;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      style={{ ...signUpBox, background: crowd ? CROWD_TINT : PANEL }}
    >
      {prompt && <strong style={{ fontFamily: FONT_UI, fontSize: 20 }}>{prompt}</strong>}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, fontWeight: 700 }}>
        Display name
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={SPECTATOR_NAME_MAX_LENGTH}
          placeholder="Pick a name"
          style={nameInput}
        />
      </label>
      <button type="submit" disabled={!ready} style={hoennButton(crowd ? 'crowd' : 'primary', ready)}>
        {crowd ? 'Join the crowd' : 'Sign up'}
      </button>
      <span style={{ fontSize: 13 }}>
        No account. {crowd ? 'Your side locks once you vote or bet this match.' : 'Chat, bet, buy items and vote in Crowd Calls.'}
      </span>
      {error && (
        <span role="alert" style={errorStyle}>
          {error}
        </span>
      )}
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
      <TopBar backHref="#/" title="Play online" subtitle="Real players, real time. Empty seats are filled with bots." />
      <div style={columnStyle}>
        <section style={{ ...cardStyle, background: CROWD_TINT }}>
          <h2 style={{ ...headingStyle, color: CROWD_TEXT }}>Watch &amp; vote</h2>
          <p style={bodyText}>
            Not playing? Hit <b>WATCH</b> on any room. In team matches the crowd votes in <b>Crowd Calls</b> — speed bursts, shields, energy
            and supply drops for the side you cheer for. You can chat, bet and send potions too.
          </p>
        </section>
        <SignUpForm me={me} conn={conn} error={error} />
        <section style={cardStyle}>
          <h2 style={headingStyle}>Create a room</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {PLAY_MODES.map((m) => (
              <button key={m.label} onClick={() => create(m.value)} style={hoennButton('secondary')}>
                + {m.label}
              </button>
            ))}
          </div>
        </section>
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={headingStyle}>Open rooms</h2>
          {rooms.length === 0 && <p style={{ ...bodyText, color: INK_MUTED }}>None yet — create one and share the link.</p>}
          {rooms.map((r) => (
            <div key={r.id} style={roomCard}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <strong style={{ fontFamily: FONT_UI, fontSize: 20 }}>{roomTitle(r)}</strong>
                  {r.live ? (
                    <span style={chip(CROWD_TINT)}>ALWAYS LIVE</span>
                  ) : (
                    <span style={chip(GROUND_ROUTE)}>{MODE_LABEL.get(r.mode)}</span>
                  )}
                  {r.phase === 'battle' ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: FONT_UI, fontSize: 16 }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: HP_RED }} />
                      LIVE
                    </span>
                  ) : (
                    <span style={{ fontSize: 14, color: INK_MUTED }}>In lobby</span>
                  )}
                </div>
                <span style={{ fontSize: 14, color: INK_MUTED }}>
                  {r.players}/{r.seats} players{r.mode !== 'ffa' ? ' · Crowd Calls on' : ''}
                </span>
              </div>
              <button onClick={() => onWatch(r.id)} style={hoennButton('crowd')}>
                {r.mode !== 'ffa' ? 'WATCH & VOTE' : 'WATCH'}
              </button>
              <a href={`#/play/${r.id}`} style={hoennButton('primary')}>
                JOIN
              </a>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

/** Always-live rooms go by their mode; others by their code. */
function roomTitle(room: { id: string; mode: PlayModeKind; live: boolean }): string {
  return room.live ? `Live ${MODE_LABEL.get(room.mode)}` : `Room ${room.id.toUpperCase()}`;
}

/** Whole seconds until a live room's next match, counting down locally from the last room update. */
function useStartsIn(room: PlayRoomView): number | null {
  const deadline = useMemo(() => (room.startsInMs !== null ? performance.now() + room.startsInMs : null), [room]);
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (deadline === null) return;
    const timer = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(timer);
  }, [deadline]);
  return deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
}

function Lobby({
  room,
  conn,
  error,
  me,
  chatProps,
  wide,
}: {
  room: PlayRoomView;
  conn: PlayConnection;
  error: string | null;
  me: Me | null;
  chatProps: ChatPanelProps;
  wide: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const you = room.you !== null ? room.seats[room.you] : null;
  const taken = room.seats.filter((s) => s.index !== room.you && s.speciesId !== null).map((s) => s.speciesId!);
  const seated = room.seats.filter((s) => s.name !== null);
  const canStart = seated.length > 0 && seated.every((s) => s.ready);
  const startsIn = useStartsIn(room);
  const copyLink = () => {
    void navigator.clipboard?.writeText(window.location.href).then(() => setCopied(true));
  };
  const teams: { key: string; title: string; seats: SeatView[] }[] =
    room.mode === 'ffa'
      ? [{ key: 'ffa', title: 'Free-for-all', seats: room.seats }]
      : [
          { key: 'teamA', title: 'Team Ruby', seats: room.seats.filter((s) => s.team === 'teamA') },
          { key: 'teamB', title: 'Team Sapphire', seats: room.seats.filter((s) => s.team === 'teamB') },
        ];
  const lobby = room.phase === 'lobby';

  return (
    <div style={pageStyle}>
      <header style={topBarStyle}>
        <a href="#/play" aria-label="Back to rooms" style={backButton}>
          ◀
        </a>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontFamily: FONT_UI, fontWeight: 700, fontSize: 28 }}>{roomTitle(room)}</h1>
            <span style={chip(GROUND_ROUTE)}>{room.mode === 'ffa' ? MODE_LABEL.get(room.mode) : `${MODE_LABEL.get(room.mode)} TEAMS`}</span>
          </div>
          <span style={{ fontSize: 14, color: INK_MUTED }}>
            {you ? (you.host ? 'You are host' : 'You are playing') : 'Watching'} ·{' '}
            {lobby ? (startsIn !== null ? `Next match in ${startsIn}s` : 'Lobby') : 'Match in progress'} ·{' '}
            {isMobileArena(room.arena) ? 'Portrait arena' : 'Wide arena'}
          </span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={copyLink} style={hoennButton('secondary')}>
            {copied ? '✓ Link copied' : 'Copy invite link'}
          </button>
          <a href="#/play" style={leaveLink}>
            Leave room
          </a>
        </div>
      </header>

      <div style={{ ...lobbyBody, flexDirection: wide ? 'row' : 'column' }}>
        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {!lobby && <p style={noticeStyle}>A match is in progress — you’ll get a seat when it ends.</p>}

          {you?.host && lobby && (
            <div role="group" aria-label="Mode" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700 }}>Mode</span>
              {PLAY_MODES.map((m) => (
                <button
                  key={m.label}
                  onClick={() => conn.send({ t: 'mode', mode: m.value })}
                  aria-pressed={room.mode === m.value}
                  style={hoennButton(room.mode === m.value ? 'primary' : 'secondary')}
                >
                  {room.mode === m.value && <span aria-hidden>▶</span>}
                  {m.label}
                </button>
              ))}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            {teams.map((t) => (
              <section key={t.key} aria-label={t.title} style={teamSection}>
                <div style={teamHeader(t.key)}>
                  {t.key !== 'ffa' && <span style={{ ...teamMarker(t.key, 16), borderColor: t.key === 'teamA' ? PANEL : INK }} />}
                  <h2 style={{ margin: 0, fontFamily: FONT_UI, fontWeight: 700, fontSize: 22 }}>{t.title}</h2>
                  <span style={{ marginLeft: 'auto', fontFamily: FONT_UI, fontSize: 17 }}>
                    {t.seats.filter((s) => s.name !== null).length}/{t.seats.length}
                    {t.seats.some((s) => s.name === null) ? ` · ${t.seats.filter((s) => s.name === null).length} bot` : ''}
                  </span>
                </div>
                <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {t.seats.map((seat) => (
                    <SeatRow
                      key={seat.index}
                      seat={seat}
                      you={seat.index === room.you}
                      seatedElsewhere={you !== null}
                      onTake={() => conn.send({ t: 'seat', index: seat.index })}
                      onReroll={lobby ? () => conn.send({ t: 'reroll' }) : undefined}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>

          {you && lobby && (
            <>
              <section aria-label="Pick your Pokémon" style={pickerSection}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <h2 style={{ margin: 0, fontFamily: FONT_UI, fontWeight: 700, fontSize: 24 }}>Pick your Pokémon</h2>
                  {you.speciesId !== null && <span style={chosenChip}>▶ {SPECIES_NAME.get(you.speciesId)}</span>}
                </div>
                <SpeciesPicker
                  allSpecies={KANTO_SPECIES}
                  excludeSpeciesIds={[...taken, ...(you.speciesId !== null ? [you.speciesId] : [])]}
                  onPick={(id) => conn.send({ t: 'pick', speciesId: id })}
                />
                {you.moves.length > 0 && <MoveCards moveIds={you.moves} />}
                <span style={{ fontSize: 14, color: INK_MUTED }}>Original 151 · no duplicates in a room</span>
              </section>
              {room.live ? (
                <p style={{ ...bodyText, fontFamily: FONT_UI, fontSize: 20 }}>
                  ▶ You’re in the next match{startsIn !== null ? ` — it starts in ${startsIn}s` : ''}. No pick? You get a random Pokémon.
                </p>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                    <button
                      onClick={() => conn.send({ t: 'ready', ready: !you.ready })}
                      disabled={you.speciesId === null}
                      aria-pressed={you.ready}
                      style={hoennButton(you.ready ? 'primary' : 'secondary', you.speciesId !== null, 'lg')}
                    >
                      {you.ready ? '✓ Ready' : 'I’m ready'}
                    </button>
                    <span style={{ fontSize: 15, color: INK_MUTED }}>
                      {seated.filter((s) => s.ready).length} of {seated.length} humans ready · bots are always ready
                    </span>
                    {you.host && (
                      <button
                        onClick={() => conn.send({ t: 'start' })}
                        disabled={!canStart}
                        style={{ ...hoennButton('primary', canStart, 'lg'), marginLeft: 'auto' }}
                      >
                        ▶ Start match
                      </button>
                    )}
                  </div>
                  {!you.host && <p style={{ ...bodyText, color: INK_MUTED }}>The host starts the match once everyone is ready.</p>}
                </>
              )}
            </>
          )}
          {!you && lobby && (
            <p style={noticeStyle}>
              {room.seats.some((s) => s.name === null)
                ? 'You’re watching — take an open seat to play, or stay in the crowd.'
                : 'All seats are taken — you’re in the crowd. Take a seat when one frees up.'}
            </p>
          )}
        </main>

        <aside aria-label="Crowd and chat" style={{ ...asideStyle, width: wide ? 340 : '100%' }}>
          <div style={crowdBox}>
            <strong style={{ fontFamily: FONT_UI, fontSize: 22, color: CROWD_TEXT }}>The crowd</strong>
            <span style={{ fontSize: 14, lineHeight: 1.45 }}>
              {room.mode === 'ffa'
                ? 'Crowd Calls are team modes only. Watchers can still chat, bet and send potions.'
                : 'First Crowd Call opens 20 s in, then every 30 s. Fighters chat, the crowd votes.'}
            </span>
          </div>
          {!you && (
            <div style={{ padding: 12, borderBottom: OUTLINE }}>
              <SignUpForm me={me} conn={conn} error={error} prompt={me?.name ? undefined : 'Join the crowd'} variant="crowd" />
            </div>
          )}
          <div style={{ flex: 1, minHeight: wide ? 0 : 320, display: 'flex', flexDirection: 'column', padding: 12 }}>
            <ChatPanel {...chatProps} listHeight="flex" />
          </div>
        </aside>
      </div>
    </div>
  );
}

function SeatRow({
  seat,
  you,
  seatedElsewhere,
  onTake,
  onReroll,
}: {
  seat: SeatView;
  you: boolean;
  seatedElsewhere: boolean;
  onTake: () => void;
  onReroll?: () => void;
}) {
  if (seat.name === null) {
    return (
      <div style={{ ...seatCard, border: `3px dashed ${INK}`, background: 'transparent' }}>
        <div style={{ ...spriteTile, background: GROUND_ROUTE, fontFamily: FONT_PIXEL, fontSize: 10 }}>BOT</div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <strong style={{ fontFamily: FONT_UI, fontSize: 20 }}>Open seat</strong>
          <span style={{ fontSize: 14, color: INK_MUTED }}>A bot plays here if nobody joins</span>
        </div>
        <button onClick={onTake} style={hoennButton('primary')}>
          {seatedElsewhere ? 'Switch here' : 'Take seat'}
        </button>
      </div>
    );
  }
  const species = seat.speciesId !== null ? SPECIES_NAME.get(seat.speciesId) : null;
  return (
    <div style={{ ...seatCard, background: you ? primaryAlpha(0.25) : PANEL, paddingLeft: you ? 10 : 34 }}>
      {you && (
        <span aria-hidden style={{ fontSize: 14 }}>
          ▶
        </span>
      )}
      <div style={spriteTile}>{seat.host ? '★' : ''}</div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <strong style={{ fontFamily: FONT_UI, fontSize: 20, textTransform: 'uppercase' }}>{species ?? 'Picking…'}</strong>
          {you && <span style={chip(ACTION)}>YOU</span>}
        </div>
        <span style={{ fontSize: 14, color: INK_MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {seat.name}
          {seat.host ? ' · host' : ''}
        </span>
        {you && seat.moves.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {seat.moves.map((id) => {
              const move = moveLookup(id);
              return move ? (
                <span key={id} style={{ ...chip(typeColorCss(move.type), typeTextCss(move.type)), fontSize: 14 }}>
                  {move.name}
                </span>
              ) : null;
            })}
          </div>
        )}
      </div>
      {you && onReroll && seat.speciesId !== null ? (
        <button onClick={onReroll} style={hoennButton('secondary')}>
          Reroll moves
        </button>
      ) : (
        <span style={{ ...chip(seat.ready ? HP_GREEN : SUNK), minHeight: 32, fontSize: 17 }}>{seat.ready ? 'READY' : 'PICKING'}</span>
      )}
    </div>
  );
}

function TopBar({ title, subtitle, backHref }: { title: string; subtitle?: string; backHref: string }) {
  return (
    <header style={topBarStyle}>
      <a href={backHref} aria-label="Back" style={backButton}>
        ◀
      </a>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <h1 style={{ margin: 0, fontFamily: FONT_UI, fontWeight: 700, fontSize: 28 }}>{title}</h1>
        {subtitle && <span style={{ fontSize: 14, color: INK_MUTED }}>{subtitle}</span>}
      </div>
    </header>
  );
}

const pageStyle: CSSProperties = {
  width: '100%',
  minHeight: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 18,
  boxSizing: 'border-box',
  fontFamily: FONT_BODY,
  color: INK,
  background: GROUND,
  paddingBottom: 24,
};
const topBarStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  flexWrap: 'wrap',
  padding: '10px 16px',
  background: PANEL,
  borderBottom: OUTLINE,
};
const columnStyle: CSSProperties = {
  width: '100%',
  maxWidth: 640,
  padding: '0 16px',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};
const cardStyle: CSSProperties = {
  borderRadius: 8,
  border: OUTLINE,
  background: PANEL,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};
const headingStyle: CSSProperties = { margin: 0, fontFamily: FONT_UI, fontWeight: 700, fontSize: 22 };
const bodyText: CSSProperties = { margin: 0, fontSize: 15, lineHeight: 1.45 };
const errorStyle: CSSProperties = { fontSize: 14, fontWeight: 700, color: RUBY };
const signUpBox: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 14,
  borderRadius: 8,
  border: OUTLINE,
  color: INK,
  fontFamily: FONT_BODY,
  boxSizing: 'border-box',
  flexWrap: 'wrap',
};
/** The crowd variant's signed-up row sits in the sidebar's capped Vote tab, so it stays one slim line. */
const signUpBoxCompact: CSSProperties = { gap: 8, padding: '6px 8px', border: `2px solid ${INK}` };
const nameInput: CSSProperties = {
  minHeight: 48,
  padding: '0 12px',
  fontSize: 16,
  fontFamily: FONT_BODY,
  borderRadius: 8,
  border: OUTLINE,
  background: PANEL,
  color: INK,
  boxSizing: 'border-box',
};
/** The match view's sign-up card for spectators on phones, top-centre over the arena. */
const signUpFloat: CSSProperties = {
  position: 'absolute',
  top: 52,
  left: '50%',
  transform: 'translateX(-50%)',
  width: 'min(92%, 360px)',
  zIndex: 20,
};
const noticeStyle: CSSProperties = {
  margin: 0,
  padding: '10px 14px',
  borderRadius: 8,
  border: OUTLINE,
  background: INFO_BOX,
  fontSize: 15,
  fontWeight: 700,
};
const roomCard: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
  padding: '12px 14px',
  borderRadius: 8,
  border: OUTLINE,
  background: PANEL,
};
const backButton: CSSProperties = {
  width: 46,
  height: 46,
  flex: 'none',
  display: 'grid',
  placeItems: 'center',
  borderRadius: 8,
  border: OUTLINE,
  boxSizing: 'border-box',
  color: INK,
  textDecoration: 'none',
  fontSize: 16,
};
const leaveLink: CSSProperties = {
  minHeight: 46,
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0 10px',
  color: RUBY,
  fontWeight: 700,
  fontSize: 15,
  textDecoration: 'underline',
};
const lobbyBody: CSSProperties = {
  width: '100%',
  maxWidth: 1440,
  boxSizing: 'border-box',
  padding: '0 16px',
  display: 'flex',
  gap: 24,
  alignItems: 'stretch',
};
const teamSection: CSSProperties = {
  borderRadius: 8,
  background: PANEL,
  border: OUTLINE,
  overflow: 'hidden',
};
function teamHeader(team: string): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 14px',
    background: team === 'teamA' ? TEAM_A_COLOR_CSS : team === 'teamB' ? TEAM_B_COLOR_CSS : INFO_BOX,
    color: team === 'ffa' ? INK : PANEL,
    borderBottom: OUTLINE,
  };
}
const seatCard: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: 10,
  borderRadius: 8,
  border: OUTLINE,
  boxSizing: 'border-box',
};
const spriteTile: CSSProperties = {
  width: 52,
  height: 52,
  flex: 'none',
  borderRadius: 6,
  background: INFO_BOX,
  border: OUTLINE,
  boxSizing: 'border-box',
  display: 'grid',
  placeItems: 'center',
  fontSize: 18,
};
const pickerSection: CSSProperties = {
  borderRadius: 8,
  background: PANEL,
  border: OUTLINE,
  boxShadow: `inset 0 0 0 3px ${PANEL}, inset 0 0 0 6px ${FRAME}`,
  padding: 18,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};
const chosenChip: CSSProperties = {
  ...chip(ACTION),
  minHeight: 40,
  fontSize: 20,
  fontWeight: 700,
  textTransform: 'uppercase',
};
const asideStyle: CSSProperties = {
  flex: 'none',
  boxSizing: 'border-box',
  borderRadius: 8,
  background: PANEL,
  border: OUTLINE,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  maxHeight: 'calc(100dvh - 120px)',
  minHeight: 420,
};
const crowdBox: CSSProperties = {
  padding: '14px 16px',
  borderBottom: OUTLINE,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  background: CROWD_TINT,
};
