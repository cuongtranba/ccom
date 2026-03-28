import { randomUUID } from "crypto";
import type Redis from "ioredis";

export interface TokenInfo {
  projectId: string;
  nodeId: string;
  createdAt: string;
}

export class RedisAuth {
  constructor(private redis: Redis) {}

  /** Generates a UUID token, stores it in a Redis hash, and indexes it under the project. */
  async createToken(projectId: string, nodeId: string): Promise<string> {
    const token = randomUUID();
    const createdAt = new Date().toISOString();

    const pipeline = this.redis.pipeline();
    pipeline.hset(`token:${token}`, { projectId, nodeId, createdAt });
    pipeline.sadd(`project_tokens:${projectId}`, token);
    pipeline.sadd("projects", projectId);
    await pipeline.exec();

    return token;
  }

  /** Validates a token and returns its info, or null if not found. */
  async validateToken(token: string): Promise<TokenInfo | null> {
    const data = await this.redis.hgetall(`token:${token}`);
    if (!data.projectId) {
      return null;
    }
    return {
      projectId: data.projectId,
      nodeId: data.nodeId,
      createdAt: data.createdAt,
    };
  }

  /** Deletes a token and removes it from the project index. */
  async revokeToken(token: string): Promise<void> {
    const info = await this.validateToken(token);
    if (!info) return;

    const pipeline = this.redis.pipeline();
    pipeline.del(`token:${token}`);
    pipeline.srem(`project_tokens:${info.projectId}`, token);
    await pipeline.exec();
  }

  /** Lists all tokens across all projects. */
  async listAllTokens(): Promise<TokenInfo[]> {
    const projects = await this.redis.smembers("projects");
    if (projects.length === 0) return [];

    const allTokens: TokenInfo[] = [];
    for (const projectId of projects) {
      const tokens = await this.listTokens(projectId);
      allTokens.push(...tokens);
    }
    return allTokens;
  }

  /** Revokes all tokens for a specific node in a project. Returns the count revoked. */
  async revokeByNode(projectId: string, nodeId: string): Promise<number> {
    const tokens = await this.redis.smembers(`project_tokens:${projectId}`);
    if (tokens.length === 0) return 0;

    let revoked = 0;
    for (const token of tokens) {
      const data = await this.redis.hgetall(`token:${token}`);
      if (data.nodeId === nodeId) {
        const pipeline = this.redis.pipeline();
        pipeline.del(`token:${token}`);
        pipeline.srem(`project_tokens:${projectId}`, token);
        await pipeline.exec();
        revoked++;
      }
    }
    return revoked;
  }

  /** Revokes all tokens for an entire project. Returns the count revoked. */
  async revokeByProject(projectId: string): Promise<number> {
    const tokens = await this.redis.smembers(`project_tokens:${projectId}`);
    if (tokens.length === 0) return 0;

    const pipeline = this.redis.pipeline();
    for (const token of tokens) {
      pipeline.del(`token:${token}`);
    }
    pipeline.del(`project_tokens:${projectId}`);
    pipeline.srem("projects", projectId);
    await pipeline.exec();
    return tokens.length;
  }

  /** Checks if a node already has a token in the project. */
  async nodeExists(projectId: string, nodeId: string): Promise<boolean> {
    const tokens = await this.redis.smembers(`project_tokens:${projectId}`);
    for (const token of tokens) {
      const data = await this.redis.hgetall(`token:${token}`);
      if (data.nodeId === nodeId) return true;
    }
    return false;
  }

  /** Lists all tokens for a given project. */
  async listTokens(projectId: string): Promise<TokenInfo[]> {
    const tokens = await this.redis.smembers(`project_tokens:${projectId}`);
    if (tokens.length === 0) return [];

    const pipeline = this.redis.pipeline();
    for (const token of tokens) {
      pipeline.hgetall(`token:${token}`);
    }
    const results = await pipeline.exec();
    if (!results) return [];

    const infos: TokenInfo[] = [];
    for (const [err, data] of results) {
      if (err) continue;
      const record = data as Record<string, string>;
      if (record.projectId) {
        infos.push({
          projectId: record.projectId,
          nodeId: record.nodeId,
          createdAt: record.createdAt,
        });
      }
    }
    return infos;
  }
}
