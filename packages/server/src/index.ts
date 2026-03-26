import { randomUUID } from "crypto";
import Redis from "ioredis";
import { parseEnvelope } from "@inv/shared";
import { RedisAuth } from "./auth";
import { RedisOutbox } from "./outbox";
import { RedisHub } from "./hub";
import type { HubWebSocket } from "./hub";

export { RedisAuth } from "./auth";
export { RedisOutbox } from "./outbox";
export { RedisHub } from "./hub";
export type { TokenInfo } from "./auth";
export type { HubWebSocket } from "./hub";

interface WsData {
  projectId: string;
  nodeId: string;
}

/** Wraps a Bun ServerWebSocket to conform to the HubWebSocket interface. */
function wrapBunWs(ws: { send(data: string | BufferSource): number; readyState: number }): HubWebSocket {
  return {
    send(data: string) {
      ws.send(data);
    },
    get readyState() {
      return ws.readyState;
    },
  };
}

export function startServer(options: { port: number; redisUrl: string }): void {
  const redis = new Redis(options.redisUrl);
  const auth = new RedisAuth(redis);
  const outbox = new RedisOutbox(redis);
  const instanceId = randomUUID();
  const hub = new RedisHub(redis, outbox, instanceId);

  // Map from "projectId:nodeId" to the wrapped HubWebSocket for lifecycle management
  const wsMap = new Map<string, ReturnType<typeof wrapBunWs>>();

  const server = Bun.serve<WsData>({
    port: options.port,

    async fetch(req, server) {
      const url = new URL(req.url);

      if (url.pathname === "/ws") {
        const token = url.searchParams.get("token");
        if (!token) {
          return new Response("Missing token", { status: 401 });
        }

        const info = await auth.validateToken(token);
        if (!info) {
          return new Response("Invalid token", { status: 401 });
        }

        const upgraded = server.upgrade(req, {
          data: { projectId: info.projectId, nodeId: info.nodeId },
        });

        if (!upgraded) {
          return new Response("WebSocket upgrade failed", { status: 500 });
        }

        // Bun returns void on successful upgrade — the response is handled internally
        return undefined as unknown as Response;
      }

      return new Response("Not Found", { status: 404 });
    },

    websocket: {
      async open(ws) {
        const { projectId, nodeId } = ws.data;
        const wrapped = wrapBunWs(ws);
        const connKey = `${projectId}:${nodeId}`;
        wsMap.set(connKey, wrapped);
        await hub.register(projectId, nodeId, wrapped);
        await hub.drainOutbox(projectId, nodeId, wrapped);
      },

      async message(ws, msg) {
        try {
          const raw = typeof msg === "string" ? msg : new TextDecoder().decode(msg);
          const envelope = parseEnvelope(raw);
          await hub.route(envelope);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : "Unknown error";
          ws.send(
            JSON.stringify({
              messageId: randomUUID(),
              fromNode: "",
              toNode: ws.data.nodeId,
              projectId: ws.data.projectId,
              timestamp: new Date().toISOString(),
              payload: { type: "error", code: "PARSE_ERROR", message: errorMsg },
            }),
          );
        }
      },

      async close(ws) {
        const { projectId, nodeId } = ws.data;
        const connKey = `${projectId}:${nodeId}`;
        wsMap.delete(connKey);
        await hub.unregister(projectId, nodeId);
      },
    },
  });

  console.log(`inv-server listening on port ${server.port} (instance: ${instanceId})`);

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await hub.shutdown();
    redis.disconnect();
    server.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await hub.shutdown();
    redis.disconnect();
    server.stop();
    process.exit(0);
  });
}

// ─── CLI entry ───────────────────────────────────────────────────────

function parseArgs(args: string[]): { port: number; redisUrl: string } {
  let port = 4400;
  let redisUrl = "redis://127.0.0.1:6379";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--redis" && args[i + 1]) {
      redisUrl = args[i + 1];
      i++;
    }
  }

  return { port, redisUrl };
}

const args = process.argv.slice(2);
if (args[0] === "start") {
  const opts = parseArgs(args.slice(1));
  startServer(opts);
}
