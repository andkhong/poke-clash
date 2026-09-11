import type { BattleCompletePayload, BattleStartPayload, ChatMessage, HelloPayload, RoomSummary, StateUpdatePayload } from './protocol';

interface RoomConnectionHandlers {
  onHello: (payload: HelloPayload) => void;
  onRoomUpdate: (room: RoomSummary) => void;
  onBattleStart: (payload: BattleStartPayload) => void;
  onStateUpdate: (payload: StateUpdatePayload) => void;
  onBattleComplete: (payload: BattleCompletePayload) => void;
  onLobbyReset: (room: RoomSummary) => void;
  onChat: (message: ChatMessage) => void;
}

/** Thin EventSource wrapper around one room's SSE stream. EventSource's
 * built-in auto-reconnect (plus the server always re-sending a fresh `hello`
 * snapshot on connect) is what makes tab refreshes and late joins "just
 * work" with no extra reconnection logic here. */
export class RoomConnection {
  private readonly source: EventSource;

  constructor(roomId: string, handlers: RoomConnectionHandlers) {
    this.source = new EventSource(`/api/rooms/${roomId}/stream`);
    this.on('hello', handlers.onHello);
    this.on('roomUpdate', handlers.onRoomUpdate);
    this.on('battleStart', handlers.onBattleStart);
    this.on('stateUpdate', handlers.onStateUpdate);
    this.on('battleComplete', handlers.onBattleComplete);
    this.on('lobbyReset', handlers.onLobbyReset);
    this.on('chat', handlers.onChat);
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
