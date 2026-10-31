import { PLAY_WS_PATH, type ClientMessage, type ServerMessage } from './playProtocol';

const PING_INTERVAL_MS = 2000;

export type PlayConnectionEvent = ServerMessage | { t: 'closed' };

/** The messages the server answers with an `ack`, minus the request id request() adds. */
type RequestMessage = WithoutReq<Extract<ClientMessage, { req: number }>>;
type WithoutReq<M> = M extends unknown ? Omit<M, 'req'> : never;

/** One WebSocket to the game server's Play Mode rooms. Messages sent before
 * the socket opens are queued; round-trip time is measured with pings. */
export class PlayConnection {
  rttMs: number | null = null;
  private readonly socket: WebSocket;
  private readonly queue: string[] = [];
  private readonly listeners = new Set<(event: PlayConnectionEvent) => void>();
  private readonly pingTimer: ReturnType<typeof setInterval>;
  private readonly pending = new Map<number, (error: string | null) => void>();
  private nextReq = 1;

  constructor(hello: { sessionId: string; name: string }) {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    this.socket = new WebSocket(`${scheme}://${window.location.host}${PLAY_WS_PATH}`);
    this.send({ t: 'hello', ...hello });
    this.socket.onopen = () => {
      for (const text of this.queue.splice(0)) this.socket.send(text);
    };
    this.socket.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      if (message.t === 'pong') this.rttMs = Math.round(performance.now() - message.c);
      if (message.t === 'ack') {
        this.pending.get(message.req)?.(message.error);
        this.pending.delete(message.req);
      }
      for (const listener of this.listeners) listener(message);
    };
    this.socket.onclose = () => {
      clearInterval(this.pingTimer);
      for (const resolve of this.pending.values()) resolve('send_failed');
      this.pending.clear();
      for (const listener of this.listeners) listener({ t: 'closed' });
    };
    this.pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), PING_INTERVAL_MS);
  }

  get open(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  send(message: ClientMessage): void {
    const text = JSON.stringify(message);
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(text);
    else if (this.socket.readyState === WebSocket.CONNECTING) this.queue.push(text);
  }

  /** Sends a chat/bet/buy and resolves with the server's answer: null on success, else an error code. */
  request(message: RequestMessage): Promise<string | null> {
    if (this.socket.readyState > WebSocket.OPEN) return Promise.resolve('send_failed');
    const req = this.nextReq++;
    return new Promise((resolve) => {
      this.pending.set(req, resolve);
      this.send({ ...message, req } as ClientMessage);
    });
  }

  subscribe(listener: (event: PlayConnectionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    clearInterval(this.pingTimer);
    this.socket.close();
  }
}
