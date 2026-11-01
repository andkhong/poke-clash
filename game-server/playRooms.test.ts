import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closePlayConnection,
  handlePlayMessage,
  LIVE_INTERMISSION_MS,
  openLiveRooms,
  openPlayConnection,
  resetPlayRoomsForTests,
  type PlayConn,
} from './playRooms';
import type { PlayRoomView, ServerMessage } from '../src/net/play/playProtocol';
import { KANTO_IDS } from '../src/app/playMode';
import type { ActionSnapshot } from '../src/sim/action/ActionEngine';
import { resetWalletsForTests } from './wallets';

interface FakeConn {
  conn: PlayConn;
  inbox: ServerMessage[];
  say(message: object): void;
  room(): PlayRoomView;
  last<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }> | undefined;
}

function connect(name: string): FakeConn {
  const inbox: ServerMessage[] = [];
  const conn = openPlayConnection((m) => inbox.push(m));
  const fake: FakeConn = {
    conn,
    inbox,
    say: (message) => handlePlayMessage(conn, message),
    last: (t) => inbox.filter((m) => m.t === t).at(-1) as never,
    room: () => fake.last('room')!.room,
  };
  fake.say({ t: 'hello', sessionId: `s-${name}`, name });
  return fake;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  resetPlayRoomsForTests();
  resetWalletsForTests();
  vi.useRealTimers();
});

function lobbyOf(mode: number | 'ffa', players: string[]): FakeConn[] {
  const [host, ...rest] = players.map(connect);
  host.say({ t: 'create', mode, arena: { width: 900, height: 1950 } });
  const roomId = host.room().id;
  for (const p of rest) p.say({ t: 'join', roomId });
  return [host, ...rest];
}

describe('online Play Mode rooms', () => {
  it('seats the creator as host and later joiners in the next free seats', () => {
    const [host, guest] = lobbyOf(2, ['Ash', 'Misty']);
    const view = guest.room();
    expect(view.seats.map((s) => s.name)).toEqual(['Ash', 'Misty', null, null]);
    expect(view.seats.map((s) => s.team)).toEqual(['teamA', 'teamA', 'teamB', 'teamB']);
    expect(view.seats[0].host).toBe(true);
    expect(view.you).toBe(1);
    expect(host.room().you).toBe(0);
  });

  it('refuses a Pokémon someone else already picked, and anything outside the 151', () => {
    const [host, guest] = lobbyOf(1, ['Ash', 'Gary']);
    host.say({ t: 'pick', speciesId: 25 });
    guest.say({ t: 'pick', speciesId: 25 });
    expect(guest.last('error')).toBeDefined();
    guest.say({ t: 'pick', speciesId: 152 });
    expect(guest.room().seats[1].speciesId).toBeNull();
    expect(host.room().seats[0].moves.length).toBeGreaterThan(0);
  });

  it('only starts once every seated player is ready, filling empty seats with bots', () => {
    const [host, guest] = lobbyOf(2, ['Ash', 'Brock']);
    host.say({ t: 'pick', speciesId: KANTO_IDS[0] });
    host.say({ t: 'ready', ready: true });
    guest.say({ t: 'pick', speciesId: KANTO_IDS[1] });
    host.say({ t: 'start' });
    expect(host.last('start')).toBeUndefined();
    guest.say({ t: 'ready', ready: true });
    host.say({ t: 'start' });
    const start = guest.last('start')!;
    expect(start.config.speciesIds).toHaveLength(4);
    expect(new Set(start.config.speciesIds).size).toBe(4);
    expect(start.you).toBe(`p1-${KANTO_IDS[1]}`);
    expect(Object.keys(start.names)).toHaveLength(2);
    expect(host.room().phase).toBe('battle');
  });

  it('streams 30 Hz snapshots and faints a player who disconnects, for good', () => {
    const [host, guest] = lobbyOf(1, ['Ash', 'Gary']);
    for (const [p, id] of [
      [host, KANTO_IDS[3]],
      [guest, KANTO_IDS[4]],
    ] as const) {
      p.say({ t: 'pick', speciesId: id });
      p.say({ t: 'ready', ready: true });
    }
    host.say({ t: 'start' });
    const guestId = guest.last('start')!.you!;
    vi.advanceTimersByTime(5000); // past the Pokéball intro
    const before = host.inbox.filter((m) => m.t === 'snap').length;
    vi.advanceTimersByTime(1000);
    const perSecond = host.inbox.filter((m) => m.t === 'snap').length - before;
    expect(perSecond).toBeGreaterThanOrEqual(28);
    expect(perSecond).toBeLessThanOrEqual(32);

    closePlayConnection(guest.conn);
    vi.advanceTimersByTime(200);
    const snap = (host.last('snap') as { s: ActionSnapshot }).s;
    expect(snap.fighters[guestId].hp).toBe(0);
    expect(snap.livingOrder).not.toContain(guestId);
    expect(snap.phase).toBe('complete');
    expect(host.room().phase).toBe('lobby');
    expect(host.room().seats[1].name).toBeNull();
  });

  it('applies a reported move only as far as the fighter could really have gone', () => {
    const [host] = lobbyOf(1, ['Ash']);
    host.say({ t: 'pick', speciesId: KANTO_IDS[5] });
    host.say({ t: 'ready', ready: true });
    host.say({ t: 'start' });
    const me = host.last('start')!.you!;
    vi.advanceTimersByTime(5000);
    const at = (host.last('snap') as { s: ActionSnapshot }).s.fighters[me];
    host.say({ t: 'move', x: at.x + 5000, y: at.y, vx: 0, vy: 0, facing: 'E' });
    vi.advanceTimersByTime(100);
    const after = (host.last('snap') as { s: ActionSnapshot }).s.fighters[me];
    expect(after.x - at.x).toBeGreaterThan(0);
    expect(after.x - at.x).toBeLessThan(500);
  });

  it('keeps players in order when the host changes the mode', () => {
    const [host, guest] = lobbyOf('ffa', ['Ash', 'Misty']);
    guest.say({ t: 'mode', mode: 1 }); // not the host: ignored
    expect(guest.room().mode).toBe('ffa');
    host.say({ t: 'mode', mode: 1 });
    expect(guest.room().seats.map((s) => s.name)).toEqual(['Ash', 'Misty']);
  });

  it('ignores malformed messages', () => {
    const [host] = lobbyOf(1, ['Ash']);
    for (const junk of [null, 42, 'x', { t: 'pick', speciesId: 'pikachu' }, { t: 'move', x: NaN }, { t: 'seat', index: 99 }]) {
      expect(() => handlePlayMessage(host.conn, junk)).not.toThrow();
    }
  });

  describe('the crowd: chat, bets and potions', () => {
    function matchWithWatcher(): { host: FakeConn; watcher: FakeConn; ask: (who: FakeConn, message: object) => string | null } {
      const [host] = lobbyOf(1, ['Ash']);
      const watcher = connect('Brock');
      watcher.say({ t: 'join', roomId: host.room().id, watch: true });
      let req = 0;
      const ask = (who: FakeConn, message: object): string | null => {
        req += 1;
        who.say({ ...message, req });
        const ack = who.inbox.find((m): m is Extract<ServerMessage, { t: 'ack' }> => m.t === 'ack' && m.req === req);
        if (!ack) throw new Error('no ack');
        return ack.error;
      };
      return { host, watcher, ask };
    }

    function start(host: FakeConn): void {
      host.say({ t: 'pick', speciesId: 25 });
      host.say({ t: 'ready', ready: true });
      host.say({ t: 'start' });
    }

    it('lets a watcher chat once signed up, and fighters chat without signing up', () => {
      const { host, watcher, ask } = matchWithWatcher();
      expect(watcher.room().you).toBeNull();
      expect(ask(watcher, { t: 'chat', text: 'hi' })).toBe('not_signed_up');
      watcher.say({ t: 'signup', name: 'Brock' });
      expect(watcher.last('me')!.name).toBe('Brock');
      expect(ask(watcher, { t: 'chat', text: 'go Pikachu' })).toBeNull();
      expect(ask(host, { t: 'chat', text: 'thanks' })).toBeNull();
      const lines = host.inbox.flatMap((m) => (m.t === 'chat' ? m.messages : []));
      expect(lines.map((m) => [m.spectatorName, m.text])).toEqual([
        ['Brock', 'go Pikachu'],
        ['Ash', 'thanks'],
      ]);
    });

    it('confirms a sign-up made from the room list, before joining any room', () => {
      const fan = connect('fan');
      fan.say({ t: 'signup', name: 'Misty' });
      expect(fan.last('me')!.name).toBe('Misty');
    });

    it('refuses a name someone in the room already has', () => {
      const { watcher } = matchWithWatcher();
      const other = connect('x');
      other.say({ t: 'join', roomId: watcher.room().id, watch: true });
      watcher.say({ t: 'signup', name: 'Brock' });
      other.say({ t: 'signup', name: 'brock' });
      expect(other.last('error')).toBeDefined();
      expect(other.last('me')!.name).toBeNull();
    });

    it('takes bets from watchers only and pays the winners when the match ends', () => {
      const { host, watcher, ask } = matchWithWatcher();
      watcher.say({ t: 'signup', name: 'Brock' });
      start(host);
      expect(watcher.last('market')!.prediction!.options.map((o) => o.id)).toEqual(['teamA', 'teamB']);
      expect(ask(host, { t: 'bet', optionId: 'teamA', amount: 25 })).toBe('fighters_cant');
      expect(ask(watcher, { t: 'bet', optionId: 'teamB', amount: 25 })).toBeNull();
      expect(watcher.last('me')!.balance).toBe(75);
      expect(watcher.last('market')!.prediction!.pool).toBe(25);

      // The host walks out: the bot's side wins and the whole pool comes back, plus the watch reward.
      vi.advanceTimersByTime(4000); // past the intro
      closePlayConnection(host.conn);
      vi.advanceTimersByTime(100);
      const me = watcher.last('me')!;
      expect(me.settled).toMatchObject({ staked: 25, returned: 25, watched: 10 });
      expect(me.balance).toBe(110);
      expect(watcher.last('market')!.prediction!.status).toBe('settled');
    });

    it('sells a potion that heals a hurt fighter, once per watcher per match', () => {
      const { host, watcher, ask } = matchWithWatcher();
      watcher.say({ t: 'signup', name: 'Brock' });
      start(host);
      const startMsg = watcher.last('start')!;
      const hostId = `p0-${startMsg.config.speciesIds[0]}`;
      const botId = `p1-${startMsg.config.speciesIds[1]}`;
      vi.advanceTimersByTime(4000);
      expect(ask(watcher, { t: 'buy', itemId: 'potion', targetId: botId })).toBe('target_full_hp');
      expect(ask(host, { t: 'buy', itemId: 'potion', targetId: hostId })).toBe('fighters_cant');

      // Let the bot land a few hits on the host, who stands still.
      const fullHp = watcher.inbox.flatMap((m) => (m.t === 'snap' ? [m.s.fighters[hostId].hp] : []))[0];
      for (let i = 0; i < 60 && watcher.last('snap')!.s.fighters[hostId].hp >= fullHp; i++) {
        vi.advanceTimersByTime(500);
      }
      expect(watcher.last('snap')!.s.fighters[hostId].hp).toBeLessThan(fullHp);

      expect(ask(watcher, { t: 'buy', itemId: 'potion', targetId: hostId })).toBeNull();
      expect(watcher.last('me')!.balance).toBe(60);
      expect(watcher.last('me')!.myItemUses).toBe(1);
      const line = watcher.inbox.flatMap((m) => (m.t === 'chat' ? m.messages : [])).at(-1)!;
      expect(line.kind).toBe('system');
      expect(line.text).toMatch(/^Brock used Potion on .+ \(\+\d+ HP\)$/);
      vi.advanceTimersByTime(100);
      const healed = watcher.inbox.flatMap((m) => (m.t === 'snap' ? m.s.events : [])).find((e) => e.type === 'item');
      expect(healed).toMatchObject({ instanceId: hostId, effect: 'heal', buyerName: 'Brock' });
      expect(ask(watcher, { t: 'buy', itemId: 'potion', targetId: hostId })).toBe('session_limit');
    });
  });

  describe('Crowd Calls', () => {
    /** Two idle humans and no bots, so nobody gets KO'd and the match outlasts several calls. */
    function teamMatch(mode: number | 'ffa' = 1) {
      const players = lobbyOf(mode, ['Ash', 'Gary']);
      const [host] = players;
      const fan = connect('Brock');
      fan.say({ t: 'join', roomId: host.room().id, watch: true });
      fan.say({ t: 'signup', name: 'Brock' });
      players.forEach((p, i) => {
        p.say({ t: 'pick', speciesId: KANTO_IDS[i] });
        p.say({ t: 'ready', ready: true });
      });
      host.say({ t: 'start' });
      let req = 0;
      const ask = (who: FakeConn, message: object): string | null => {
        req += 1;
        who.say({ ...message, req });
        return who.inbox.find((m): m is Extract<ServerMessage, { t: 'ack' }> => m.t === 'ack' && m.req === req)!.error;
      };
      const call = () => fan.last('calls')!.current;
      return { host, fan, ask, call };
    }
    const systemLines = (who: FakeConn) => who.inbox.flatMap((m) => (m.t === 'chat' ? m.messages : [])).filter((m) => m.kind === 'system');

    it('opens at 20 s, votes for 10 s and lands 2 s later, telling the chat', () => {
      const { fan, call } = teamMatch();
      expect(fan.last('calls')).toMatchObject({ current: null, history: [] });
      vi.advanceTimersByTime(19_900);
      expect(call()).toBeNull();
      vi.advanceTimersByTime(200);
      expect(call()).toMatchObject({ index: 1, phase: 'voting', opensAtMs: 20_000, closesAtMs: 30_000, landsAtMs: 32_000 });
      for (const side of ['teamA', 'teamB'] as const) {
        const cards = call()!.sides[side].cards;
        expect(new Set(cards).size).toBe(3);
        expect(cards.every((c) => ['speed', 'shield', 'energy', 'supply'].includes(c))).toBe(true);
      }
      const before = fan.inbox.filter((m) => m.t === 'calls').length;
      vi.advanceTimersByTime(1000);
      const perSecond = fan.inbox.filter((m) => m.t === 'calls').length - before;
      expect(perSecond).toBeGreaterThanOrEqual(3);
      expect(perSecond).toBeLessThanOrEqual(5);

      vi.advanceTimersByTime(9_000);
      expect(call()!.phase).toBe('landing');
      // Nobody voted: the house picks one of the offered cards on both sides.
      for (const side of ['teamA', 'teamB'] as const) {
        const s = call()!.sides[side];
        expect(s.housePick).toBe(true);
        expect(s.cards).toContain(s.winner);
      }
      expect(systemLines(fan)).toHaveLength(0);
      vi.advanceTimersByTime(2_000);
      expect(call()!.phase).toBe('landed');
      expect(systemLines(fan).map((m) => m.text)).toEqual([
        expect.stringMatching(/^Crowd Call 1 — Ruby: .+ \(house pick\) · Sapphire: .+ \(house pick\)$/),
      ]);
      const landed = fan.inbox.flatMap((m) => (m.t === 'snap' ? m.s.events : [])).filter((e) => e.type === 'crowdCall');
      expect(landed.map((e) => e.type === 'crowdCall' && e.team)).toEqual(['teamA', 'teamB']);

      vi.advanceTimersByTime(18_000); // 50 s: the next call
      expect(call()).toMatchObject({ index: 2, phase: 'voting', opensAtMs: 50_000 });
      expect(fan.last('calls')!.history).toHaveLength(2);
    });

    it('tallies votes, moves a re-vote, and holds a viewer to the first side they picked', () => {
      const { host, fan, ask, call } = teamMatch();
      const stranger = connect('Misty');
      stranger.say({ t: 'join', roomId: host.room().id, watch: true });
      expect(ask(fan, { t: 'vote', side: 'teamA', card: 'speed' })).toBe('no_call');
      vi.advanceTimersByTime(20_100);
      const [first, second] = call()!.sides.teamA.cards;
      const missing = (['speed', 'shield', 'energy', 'supply'] as const).find((c) => !call()!.sides.teamA.cards.includes(c));
      expect(ask(host, { t: 'vote', side: 'teamA', card: first })).toBe('fighters_cant');
      expect(ask(stranger, { t: 'vote', side: 'teamA', card: first })).toBe('not_signed_up');
      expect(ask(fan, { t: 'vote', side: 'teamA', card: missing })).toBe('bad_card');
      expect(ask(fan, { t: 'vote', side: 'teamC', card: first })).toBe('invalid_message');
      expect(fan.last('me')!.side).toBeNull();

      expect(ask(fan, { t: 'vote', side: 'teamA', card: first })).toBeNull();
      expect(fan.last('me')).toMatchObject({ side: 'teamA', myVote: first });
      expect(ask(fan, { t: 'vote', side: 'teamA', card: second })).toBeNull();
      expect(fan.last('me')!.myVote).toBe(second);
      expect(ask(fan, { t: 'vote', side: 'teamB', card: call()!.sides.teamB.cards[0] })).toBe('side_locked');
      vi.advanceTimersByTime(300);
      expect(call()!.sides.teamA.votes).toEqual({ [first]: 0, [second]: 1 });

      vi.advanceTimersByTime(10_000);
      expect(call()!.sides.teamA).toMatchObject({ winner: second, housePick: false });
      expect(call()!.sides.teamB.housePick).toBe(true);
      vi.advanceTimersByTime(2_000);
      expect(systemLines(fan)[0].text).toMatch(/^Crowd Call \d+ — Ruby: [^(]+! · Sapphire: .+ \(house pick\)$/);
    });

    it('locks the side with a first bet, and then refuses votes and potions for the other side', () => {
      const { fan, ask } = teamMatch();
      const start = fan.last('start')!;
      const teamAFighter = `p0-${start.config.speciesIds[0]}`;
      expect(ask(fan, { t: 'bet', optionId: 'teamB', amount: 10 })).toBeNull();
      expect(fan.last('me')!.side).toBe('teamB');
      expect(ask(fan, { t: 'bet', optionId: 'teamA', amount: 10 })).toBe('side_locked');
      expect(ask(fan, { t: 'buy', itemId: 'potion', targetId: teamAFighter })).toBe('side_locked');
      vi.advanceTimersByTime(20_100);
      expect(ask(fan, { t: 'vote', side: 'teamA', card: fan.last('calls')!.current!.sides.teamA.cards[0] })).toBe('side_locked');
      expect(ask(fan, { t: 'vote', side: 'teamB', card: fan.last('calls')!.current!.sides.teamB.cards[0] })).toBeNull();
    });

    it('never runs in free-for-all', () => {
      const { fan } = teamMatch('ffa');
      vi.advanceTimersByTime(25_000);
      expect(fan.inbox.filter((m) => m.t === 'calls').every((m) => m.t === 'calls' && m.current === null)).toBe(true);
    });
  });

  describe('always-live rooms', () => {
    it('seats a watcher who queued mid-match in the next match, ahead of the bots', () => {
      openLiveRooms();
      const fan = connect('fan');
      fan.say({ t: 'join', roomId: 'live1v1' }); // mid-match: watching
      expect(fan.room()).toMatchObject({ you: null, queued: false });
      fan.say({ t: 'queue', join: true });
      expect(fan.room().queued).toBe(true);
      fan.say({ t: 'queue', join: false });
      expect(fan.room().queued).toBe(false);
      fan.say({ t: 'queue', join: true });

      // A second watcher lines up behind: everyone sees the queue in order, with their own place.
      const [second, third] = ['second', 'third'].map(connect);
      for (const c of [second, third]) {
        c.say({ t: 'join', roomId: 'live1v1', watch: true });
        c.say({ t: 'queue', join: true });
      }
      expect(fan.room()).toMatchObject({ queue: ['fan', 'second', 'third'], queuePlace: 1 });
      expect(third.room()).toMatchObject({ queue: ['fan', 'second', 'third'], queuePlace: 3 });

      for (let i = 0; i < 400 && fan.room().phase === 'battle'; i++) vi.advanceTimersByTime(1000);
      // A 1v1 has two seats: the first two in line get them, the third keeps watching.
      expect(second.room().you).toBe(1);
      expect(third.room()).toMatchObject({ you: null, queue: [], queuePlace: null });
      expect(fan.room()).toMatchObject({ phase: 'lobby', you: 0, queued: false });
      vi.advanceTimersByTime(LIVE_INTERMISSION_MS);
      const start = fan.last('start')!;
      expect(start.you).toBe(`p0-${start.config.speciesIds[0]}`);
    });

    it('does not queue someone already seated, or between matches', () => {
      const [host] = lobbyOf(1, ['Ash']);
      host.say({ t: 'queue', join: true });
      expect(host.room().queued).toBe(false);
    });

    it('opens 1v1, 2v2, 3v3 and FFA rooms already fighting, listed first, with no host', () => {
      openLiveRooms();
      const fan = connect('fan');
      fan.say({ t: 'create', mode: 1, arena: { width: 900, height: 1950 } });
      fan.say({ t: 'leave' });
      fan.say({ t: 'list' });
      const listed = fan.last('rooms')!.rooms;
      expect(listed.slice(0, 4).map((r) => [r.id, r.mode, r.phase, r.live])).toEqual([
        ['live1v1', 1, 'battle', true],
        ['live2v2', 2, 'battle', true],
        ['live3v3', 3, 'battle', true],
        ['liveffa', 'ffa', 'battle', true],
      ]);
      fan.say({ t: 'join', roomId: 'live2v2' });
      expect(fan.room()).toMatchObject({ live: true, phase: 'battle', you: null });
      expect(fan.room().seats.every((s) => !s.host)).toBe(true);
      expect(fan.last('start')!.you).toBeNull(); // arrived mid-match: watching
    });

    it('survives everyone leaving, then starts its next match on its own after the break', () => {
      openLiveRooms();
      const fan = connect('fan');
      fan.say({ t: 'join', roomId: 'live1v1' });
      closePlayConnection(fan.conn);

      // Bots alone finish a match eventually; then a break, then a fresh one.
      const watcher = connect('watcher');
      watcher.say({ t: 'join', roomId: 'live1v1', watch: true });
      const starts = () => watcher.inbox.filter((m) => m.t === 'start').length;
      const before = starts();
      for (let i = 0; i < 400 && watcher.room().phase === 'battle'; i++) vi.advanceTimersByTime(1000);
      expect(watcher.room()).toMatchObject({ phase: 'lobby', live: true });
      expect(watcher.room().startsInMs).toBeGreaterThan(LIVE_INTERMISSION_MS - 1000);

      // A player who sits during the break but never picks still gets a Pokémon.
      const player = connect('player');
      player.say({ t: 'join', roomId: 'live1v1' });
      expect(player.room().you).toBe(0);
      vi.advanceTimersByTime(LIVE_INTERMISSION_MS);
      expect(starts()).toBe(before + 1);
      const start = player.last('start')!;
      expect(start.you).toBe(`p0-${start.config.speciesIds[0]}`);
      expect(player.room().phase).toBe('battle');
    });
  });
});
