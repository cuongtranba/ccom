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
	projectIds: string[];
}

export class WSClient {
	private ws: WebSocket | null = null;
	private messageHandler: ((envelope: Envelope) => void) | null = null;
	private reconnectDelay = 1000;
	private maxReconnectDelay = 30000;
	private shouldReconnect = true;
	private sendQueue: string[] = [];
	private readonly maxQueueSize = 100;
	private log = new Logger("ws-client");

	constructor(private config: WSClientConfig) {}

	async connect(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const url = `${this.config.serverUrl}?token=${this.config.token}`;
			this.ws = new WebSocket(url);

			this.ws.onopen = () => {
				this.reconnectDelay = 1000;
				this.drainSendQueue();
				resolve();
			};

			this.ws.onmessage = (event: MessageEvent) => {
				if (!this.messageHandler) return;
				try {
					const raw =
						typeof event.data === "string" ? event.data : String(event.data);
					const envelope = parseEnvelope(raw);
					this.messageHandler(envelope);
				} catch (err) {
					this.log.error("Failed to parse incoming message", {
						error: String(err),
					});
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

			this.ws.onerror = () => {
				this.log.error("WebSocket error");
				if (!this.connected) {
					reject(new Error("WebSocket connection failed"));
				}
			};
		});
	}

	send(envelope: Envelope): void {
		const msg = JSON.stringify(envelope);
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(msg);
		} else {
			if (this.sendQueue.length < this.maxQueueSize) {
				this.sendQueue.push(msg);
			} else {
				this.log.error("Send queue full, dropping message", {
					type: envelope.payload.type,
				});
			}
		}
	}

	sendMessage(
		toNode: string,
		projectId: string,
		payload: MessagePayload,
	): void {
		const envelope = createEnvelope(
			this.config.nodeId,
			toNode,
			projectId,
			payload,
		);
		this.send(envelope);
	}

	broadcast(projectId: string, payload: MessagePayload): void {
		const envelope = createEnvelope(this.config.nodeId, "", projectId, payload);
		this.send(envelope);
	}

	onMessage(handler: (envelope: Envelope) => void): void {
		this.messageHandler = handler;
	}

	close(): void {
		this.shouldReconnect = false;
		this.sendQueue = [];
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
	}

	get connected(): boolean {
		return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
	}

	get queueDepth(): number {
		return this.sendQueue.length;
	}

	private drainSendQueue(): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
		const queued = this.sendQueue.splice(0);
		for (const msg of queued) {
			this.ws.send(msg);
		}
		if (queued.length > 0) {
			this.log.error("Drained send queue after reconnect", {
				count: String(queued.length),
			});
		}
	}
}
