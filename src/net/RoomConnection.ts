import type {
  BattleCompletePayload,
  BattleStartPayload,
  ChatMessage,
  HelloPayload,
  PredictionSummary,
  RoomSummary,
  ShopSummary,
  StateUpdatePayload,
  WalletEventPayload,
} from './protocol';

interface RoomConnectionHandlers {
  onHello: (payload: HelloPayload) => void;
  onRoomUpdate: (room: RoomSummary) => void;
  onBattleStart: (payload: BattleStartPayload) => void;
  onStateUpdate: (payload: StateUpdatePayload) => void;
  onBattleComplete: (payload: BattleCompletePayload) => void;
  onLobbyReset: (room: RoomSummary) => void;
  onChat: (message: ChatMessage) => void;
  /** The room's betting pool changed — opened, a bet landed, odds moved on
   * a faint, closed, or settled. Always the whole public summary. */
  onPrediction: (prediction: PredictionSummary) => void;
  /** The room's item shop changed — opened with a fresh shelf at battle
   * start, or stock consumed by someone's purchase. Always the whole public
   * summary; whether it's *trading* isn't in it (see ShopSummary). */
  onShop: (shop: ShopSummary) => void;
  /** This session's own balance changed for a reason other than its own
   * bet request (settlement) — private to this tab's streams. */
  onWallet: (payload: WalletEventPayload) => void;
  /** The stream dropped or never opened (server down, unknown room id) —
   * EventSource keeps retrying on its own, so this is a hint to show, not
   * something to act on; a later `hello` means it recovered. */
  onError?: () => void;
}

/** Thin EventSource wrapper around one room's SSE stream. EventSource's
 * built-in auto-reconnect (plus the server always re-sending a fresh `hello`
 * snapshot on connect) is what makes tab refreshes and late joins "just
 * work" with no extra reconnection logic here. The session id rides on the
 * URL (see sessionIdentity.ts) — an EventSource can't send a header. */
export class RoomConnection {
  private readonly source: EventSource;

  constructor(roomId: string, sessionId: string, handlers: RoomConnectionHandlers) {
    this.source = new EventSource(`/api/rooms/${roomId}/stream?session=${encodeURIComponent(sessionId)}`);
    this.on('hello', handlers.onHello);
    this.on('roomUpdate', handlers.onRoomUpdate);
    this.on('battleStart', handlers.onBattleStart);
    this.on('stateUpdate', handlers.onStateUpdate);
    this.on('battleComplete', handlers.onBattleComplete);
    this.on('lobbyReset', handlers.onLobbyReset);
    this.on('chat', handlers.onChat);
    this.on('prediction', handlers.onPrediction);
    this.on('shop', handlers.onShop);
    this.on('wallet', handlers.onWallet);
    if (handlers.onError) this.source.addEventListener('error', handlers.onError);
  }

  private on<T>(event: string, handler: (payload: T) => void): void {
    this.source.addEventListener(event, (e) => {
      handler(JSON.parse((e as MessageEvent).data) as T);
    });
  }

  close(): void {
    this.source.close();
  }
}
