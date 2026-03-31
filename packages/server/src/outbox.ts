import type Redis from "ioredis";

export class RedisOutbox {
  constructor(private redis: Redis) {}

  /** Appends a message to the tail of the node's outbox queue. */
  async enqueue(projectId: string, nodeId: string, message: string): Promise<void> {
    await this.redis.rpush(this.key(projectId, nodeId), message);
  }

  /** Drains all messages from the node's outbox queue, returning them in FIFO order. */
  async drain(projectId: string, nodeId: string): Promise<string[]> {
    const key = this.key(projectId, nodeId);
    const len = await this.redis.llen(key);
    if (len === 0) return [];

    // Use a pipeline to atomically read all and delete the key
    const pipeline = this.redis.pipeline();
    pipeline.lrange(key, 0, -1);
    pipeline.del(key);
    const results = await pipeline.exec();
    if (!results) return [];

    const [err, messages] = results[0];
    if (err) return [];
    return messages as string[];
  }

  /** Returns the number of messages queued for the node. */
  async depth(projectId: string, nodeId: string): Promise<number> {
    return this.redis.llen(this.key(projectId, nodeId));
  }

  private key(projectId: string, nodeId: string): string {
    return `outbox:${projectId}:${nodeId}`;
  }
}
