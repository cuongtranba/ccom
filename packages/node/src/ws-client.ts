import {
  createEnvelope,
  parseEnvelope,
  type Envelope,
  type MessagePayload,
} from "@inv/shared";
import { Logger } from "./logger";

export interface WSClientConfig {
  serverUrl: string;
  token: string;
  nodeId: string;
  projectId: string;
}

export class WSClient {
  private ws: WebSocket | null = null;
  private messageHandler: ((envelope: Envelope) => void) | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private shouldReconnect = true;
  private log = new Logger("ws-client");

  constructor(private config: WSClientConfig) {}

  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const url = `${this.config.serverUrl}?token=${this.config.token}`;
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.reconnectDelay = 1000;
        resolve();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        if (!this.messageHandler) return;
        try {
          const raw = typeof event.data === "string" ? event.data : String(event.data);
          const envelope = parseEnvelope(raw);
          this.messageHandler(envelope);
        } catch (err) {
          this.log.error("Failed to parse incoming message", { error: String(err) });
        }
      };

      this.ws.onclose = () => {
        this.ws = null;
        if (this.shouldReconnect) {
          setTimeout(() => {
            this.connect().catch((err) => {
              this.log.error("Reconnection failed", { error: String(err) });
            });
          }, this.reconnectDelay);
          this.reconnectDelay = Math.min(
            this.reconnectDelay * 2,
            this.maxReconnectDelay,
          );
        }
      };

      this.ws.onerror = (event) => {
        this.log.error("WebSocket error");
        if (!this.connected) {
          reject(new Error("WebSocket connection failed"));
        }
      };
    });
  }

  send(envelope: Envelope): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not connected");
    }
    this.ws.send(JSON.stringify(envelope));
  }

  sendMessage(toNode: string, payload: MessagePayload): void {
    const envelope = createEnvelope(
      this.config.nodeId,
      toNode,
      this.config.projectId,
      payload,
    );
    this.send(envelope);
  }

  broadcast(payload: MessagePayload): void {
    const envelope = createEnvelope(
      this.config.nodeId,
      "",
      this.config.projectId,
      payload,
    );
    this.send(envelope);
  }

  onMessage(handler: (envelope: Envelope) => void): void {
    this.messageHandler = handler;
  }

  close(): void {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
