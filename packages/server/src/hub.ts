import Redis from "ioredis";
import type { Envelope } from "@inv/shared";
import type { RedisOutbox } from "./outbox";

/** Minimal WebSocket interface for hub operations. */
export interface HubWebSocket {
  send(data: string): void;
  readyState: number;
}

export interface HubMetrics {
  messages_routed: number;
  messages_enqueued: number;
  messages_cross_instance: number;
  connections_active: number;
  drains_total: number;
  drain_messages_total: number;
}

export interface ConnectedNode {
  nodeId: string;
  project: string;
  connectedAt: string;
  lastMessageAt: string | null;
}

export class RedisHub {
  private localConns = new Map<string, HubWebSocket>();
  private subRedis: Redis;
  private counters = {
    messages_routed: 0,
    messages_enqueued: 0,
    messages_cross_instance: 0,
    drains_total: 0,
    drain_messages_total: 0,
  };
  private connMeta = new Map<string, { project: string; nodeId: string; connectedAt: string; lastMessageAt: string | null }>();

  constructor(
    private redis: Redis,
    private outbox: RedisOutbox,
    private instanceId: string,
  ) {
    // Create a duplicate connection for pub/sub (subscriber mode is exclusive)
    this.subRedis = redis.duplicate();
    this.subRedis.on("message", (channel: string, message: string) => {
      this.handlePubSubMessage(channel, message);
    });
  }

  /** Registers a node as online on this instance and stores the local WebSocket. */
  async register(projectId: string, nodeId: string, ws: HubWebSocket): Promise<void> {
    const connKey = `${projectId}:${nodeId}`;
    this.localConns.set(connKey, ws);
    this.connMeta.set(connKey, {
      project: projectId,
      nodeId,
      connectedAt: new Date().toISOString(),
      lastMessageAt: null,
    });
    await this.redis.hset(`presence:${projectId}`, nodeId, this.instanceId);
    await this.subRedis.subscribe(`route:${projectId}`);
  }

  /** Unregisters a node: removes presence and local connection. */
  async unregister(projectId: string, nodeId: string): Promise<void> {
    const connKey = `${projectId}:${nodeId}`;
    this.localConns.delete(connKey);
    this.connMeta.delete(connKey);
    await this.redis.hdel(`presence:${projectId}`, nodeId);
  }

  /** Returns true if the node is registered as online (on any instance). */
  async isOnline(projectId: string, nodeId: string): Promise<boolean> {
    const result = await this.redis.hget(`presence:${projectId}`, nodeId);
    return result !== null;
  }

  /** Lists all online node IDs for a project. */
  async listOnline(projectId: string): Promise<string[]> {
    const presence = await this.redis.hgetall(`presence:${projectId}`);
    return Object.keys(presence);
  }

  /** Routes an envelope: if toNode is set, deliver to that node; otherwise broadcast to all except sender. */
  async route(envelope: Envelope): Promise<void> {
    // Update lastMessageAt for the sender
    const senderKey = `${envelope.projectId}:${envelope.fromNode}`;
    const senderMeta = this.connMeta.get(senderKey);
    if (senderMeta) {
      senderMeta.lastMessageAt = new Date().toISOString();
    }

    if (envelope.toNode) {
      await this.deliverTo(envelope.projectId, envelope.toNode, JSON.stringify(envelope));
    } else {
      // Broadcast to all online nodes except the sender
      const onlineNodes = await this.listOnline(envelope.projectId);
      const promises: Promise<void>[] = [];
      for (const nodeId of onlineNodes) {
        if (nodeId !== envelope.fromNode) {
          promises.push(this.deliverTo(envelope.projectId, nodeId, JSON.stringify(envelope)));
        }
      }
      await Promise.all(promises);
    }
  }

  /** Delivers a message to a specific node: local ws.send, remote pub/sub, or outbox if offline. */
  private async deliverTo(projectId: string, nodeId: string, message: string): Promise<void> {
    const connKey = `${projectId}:${nodeId}`;
    this.counters.messages_routed++;

    // Try local delivery first
    const ws = this.localConns.get(connKey);
    if (ws && ws.readyState === 1) {
      ws.send(message);
      return;
    }

    // Check if node is online on another instance
    const instanceId = await this.redis.hget(`presence:${projectId}`, nodeId);
    if (instanceId && instanceId !== this.instanceId) {
      // Publish to the project channel for cross-instance routing
      const routeMessage = JSON.stringify({ targetNode: nodeId, payload: message });
      await this.redis.publish(`route:${projectId}`, routeMessage);
      this.counters.messages_cross_instance++;
      return;
    }

    // Node is offline — enqueue in outbox
    await this.outbox.enqueue(projectId, nodeId, message);
    this.counters.messages_enqueued++;
  }

  /** Drains the outbox for a node and sends all queued messages to the WebSocket. */
  async drainOutbox(projectId: string, nodeId: string, ws: HubWebSocket): Promise<void> {
    const messages = await this.outbox.drain(projectId, nodeId);
    this.counters.drains_total++;
    this.counters.drain_messages_total += messages.length;
    for (const msg of messages) {
      ws.send(msg);
    }
  }

  /** Returns a snapshot of hub metrics. */
  getMetrics(): HubMetrics {
    return {
      ...this.counters,
      connections_active: this.localConns.size,
    };
  }

  /** Returns metadata for all locally connected nodes. */
  listConnections(): ConnectedNode[] {
    return Array.from(this.connMeta.values());
  }

  /** Cleans up the subscriber Redis connection. */
  async shutdown(): Promise<void> {
    try {
      await this.subRedis.unsubscribe();
    } catch {
      // Ignore errors during shutdown
    }
    this.subRedis.disconnect();
    this.localConns.clear();
    this.connMeta.clear();
  }

  /** Handles incoming pub/sub messages for cross-instance routing. */
  private handlePubSubMessage(_channel: string, message: string): void {
    try {
      const parsed = JSON.parse(message) as { targetNode: string; payload: string };
      // Extract projectId from channel name (route:{projectId})
      const projectId = _channel.replace("route:", "");
      const connKey = `${projectId}:${parsed.targetNode}`;
      const ws = this.localConns.get(connKey);
      if (ws && ws.readyState === 1) {
        ws.send(parsed.payload);
      }
    } catch {
      // Ignore malformed pub/sub messages
    }
  }
}
