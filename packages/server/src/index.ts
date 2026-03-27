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

      if (url.pathname === "/metrics") {
        return Response.json(hub.getMetrics());
      }

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

function parseRedisUrl(args: string[]): string {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--redis" && args[i + 1]) {
      return args[i + 1];
    }
  }
  return "redis://127.0.0.1:6379";
}

async function tokenCreate(args: string[]): Promise<void> {
  let project = "";
  let nodeId = "";
  const redisUrl = parseRedisUrl(args);

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--project" && args[i + 1]) {
      project = args[i + 1];
      i++;
    } else if (args[i] === "--node" && args[i + 1]) {
      nodeId = args[i + 1];
      i++;
    }
  }

  if (!project || !nodeId) {
    console.error("Usage: token create --project <project> --node <nodeId> [--redis <url>]");
    process.exit(1);
  }

  const redis = new Redis(redisUrl);
  const auth = new RedisAuth(redis);
  try {
    const token = await auth.createToken(project, nodeId);
    console.log(token);
  } finally {
    redis.disconnect();
  }
}

async function tokenList(args: string[]): Promise<void> {
  let project = "";
  const redisUrl = parseRedisUrl(args);

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--project" && args[i + 1]) {
      project = args[i + 1];
      i++;
    }
  }

  if (!project) {
    console.error("Usage: token list --project <project> [--redis <url>]");
    process.exit(1);
  }

  const redis = new Redis(redisUrl);
  const auth = new RedisAuth(redis);
  try {
    const tokens = await auth.listTokens(project);
    if (tokens.length === 0) {
      console.log("No tokens found.");
    } else {
      for (const t of tokens) {
        console.log(`${t.nodeId}\t${t.createdAt}`);
      }
    }
  } finally {
    redis.disconnect();
  }
}

async function tokenRevoke(args: string[]): Promise<void> {
  const redisUrl = parseRedisUrl(args);

  // Find the first positional arg (skip flags and their values)
  let token = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--redis") {
      i++; // skip flag value
    } else if (!args[i].startsWith("--")) {
      token = args[i];
      break;
    }
  }

  if (!token) {
    console.error("Usage: token revoke <token> [--redis <url>]");
    process.exit(1);
  }

  const redis = new Redis(redisUrl);
  const auth = new RedisAuth(redis);
  try {
    await auth.revokeToken(token);
    console.log("Token revoked.");
  } finally {
    redis.disconnect();
  }
}

const args = process.argv.slice(2);
if (args[0] === "start") {
  const opts = parseArgs(args.slice(1));
  startServer(opts);
} else if (args[0] === "token") {
  const sub = args[1];
  const rest = args.slice(2);

  if (sub === "create") {
    tokenCreate(rest);
  } else if (sub === "list") {
    tokenList(rest);
  } else if (sub === "revoke") {
    tokenRevoke(rest);
  } else {
    console.error("Usage: token <create|list|revoke>");
    process.exit(1);
  }
}
