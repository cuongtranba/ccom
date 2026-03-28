import { randomUUID } from "crypto";
import { readFileSync, existsSync, statSync } from "fs";
import { resolve, dirname, join, extname } from "path";
import { fileURLToPath } from "url";
import Redis from "ioredis";
import { parseEnvelope } from "@inv/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminDistDir = resolve(__dirname, "../../admin/dist");
import { getPrisma, disconnectPrisma } from "./prisma";
import { createRepositories } from "./repositories";
import { RedisOutbox } from "./outbox";
import { RedisHub } from "./hub";
import type { HubWebSocket } from "./hub";
import { LogBuffer } from "./log-buffer";

export { createRepositories } from "./repositories";
export { RedisOutbox } from "./outbox";
export { RedisHub } from "./hub";
export type { TokenInfo } from "./repositories";
export type { HubWebSocket } from "./hub";
export type { ConnectedNode } from "./hub";

interface WsData {
  projectId: string;
  nodeId: string;
}

/** Wraps a Bun ServerWebSocket to conform to the HubWebSocket interface. */
function wrapBunWs(ws: { send(data: string | BufferSource): number; close(): void; readyState: number }): HubWebSocket {
  return {
    send(data: string) {
      ws.send(data);
    },
    close() {
      ws.close();
    },
    get readyState() {
      return ws.readyState;
    },
  };
}

export function startServer(options: { port: number; redisUrl: string }): void {
  const prisma = getPrisma();
  const repos = createRepositories(prisma);
  const redis = new Redis(options.redisUrl);
  const outbox = new RedisOutbox(redis);
  const instanceId = randomUUID();
  const hub = new RedisHub(redis, outbox, instanceId);
  const adminKey = process.env.ADMIN_KEY || "";
  const log = new LogBuffer(200);
  log.info("Server started", { instanceId, port: String(options.port) });

  async function findProjectByName(name: string) {
    const projects = await repos.projects.list();
    return projects.find((p) => p.name === name) ?? null;
  }

  function requireAdmin(req: Request): Response | null {
    if (!adminKey) {
      return Response.json({ error: "ADMIN_KEY not configured" }, { status: 503 });
    }
    const header = req.headers.get("Authorization") || "";
    if (header !== `Bearer ${adminKey}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return null;
  }

  // Map from "projectId:nodeId" to the wrapped HubWebSocket for lifecycle management
  const wsMap = new Map<string, ReturnType<typeof wrapBunWs>>();

  const server = Bun.serve<WsData>({
    port: options.port,

    async fetch(req, server) {
      const url = new URL(req.url);

      if (url.pathname === "/admin" || url.pathname === "/admin/") {
        const indexPath = join(adminDistDir, "index.html");
        if (existsSync(indexPath)) {
          return new Response(readFileSync(indexPath, "utf-8"), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
        return new Response("Admin UI not built. Run: pnpm build:admin", { status: 404 });
      }

      if (url.pathname.startsWith("/admin/")) {
        const filePath = resolve(adminDistDir, url.pathname.replace("/admin/", ""));
        if (!filePath.startsWith(adminDistDir + "/")) {
          return new Response("Forbidden", { status: 403 });
        }
        if (existsSync(filePath) && statSync(filePath).isFile()) {
          const mimeTypes: Record<string, string> = {
            ".js": "application/javascript",
            ".css": "text/css",
            ".html": "text/html",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".json": "application/json",
          };
          const ext = extname(filePath);
          const contentType = mimeTypes[ext] ?? "application/octet-stream";
          return new Response(Bun.file(filePath), {
            headers: { "Content-Type": contentType },
          });
        }
      }

      if (url.pathname === "/metrics") {
        return Response.json(hub.getMetrics());
      }

      // ── Project management API (admin-key protected) ───────

      if (url.pathname === "/api/project/create" && req.method === "POST") {
        const denied = requireAdmin(req);
        if (denied) return denied;
        const body = await req.json() as { project?: string };
        if (!body.project) {
          return Response.json({ error: "Missing project" }, { status: 400 });
        }
        const exists = await repos.projects.exists(body.project);
        if (exists) {
          return Response.json({ error: `Project "${body.project}" already exists` }, { status: 409 });
        }
        await repos.projects.create(body.project);
        return Response.json({ project: body.project, created: true });
      }

      if (url.pathname === "/api/project/list" && req.method === "GET") {
        const denied = requireAdmin(req);
        if (denied) return denied;
        const projects = await repos.projects.list();
        return Response.json({ projects: projects.map((p) => p.name) });
      }

      // ── Token management API (admin-key protected) ───────────

      if (url.pathname === "/api/token/create" && req.method === "POST") {
        const denied = requireAdmin(req);
        if (denied) return denied;
        const body = await req.json() as { project?: string; nodeId?: string };
        if (!body.project || !body.nodeId) {
          return Response.json({ error: "Missing project or nodeId" }, { status: 400 });
        }
        const project = await findProjectByName(body.project);
        if (!project) {
          return Response.json({ error: `Project "${body.project}" does not exist. Create it first.` }, { status: 400 });
        }
        if (await repos.tokens.nodeExists(project.id, body.nodeId)) {
          return Response.json({ error: `Node "${body.nodeId}" already exists in project "${body.project}"` }, { status: 409 });
        }
        const token = await repos.tokens.create(project.id, body.nodeId);
        return Response.json({ token: token.secret, project: body.project, nodeId: body.nodeId });
      }

      if (url.pathname === "/api/token/list" && req.method === "GET") {
        const denied = requireAdmin(req);
        if (denied) return denied;
        const project = url.searchParams.get("project");
        if (project) {
          const projectRecord = await findProjectByName(project);
          if (!projectRecord) return Response.json({ tokens: [] });
          const tokens = await repos.tokens.listByProject(projectRecord.id);
          return Response.json({ tokens });
        }
        const tokens = await repos.tokens.listAll();
        return Response.json({ tokens });
      }

      if (url.pathname === "/api/token/revoke" && req.method === "POST") {
        const denied = requireAdmin(req);
        if (denied) return denied;
        const body = await req.json() as { token?: string };
        if (!body.token) {
          return Response.json({ error: "Missing token" }, { status: 400 });
        }
        await repos.tokens.revoke(body.token);
        return Response.json({ revoked: true });
      }

      if (url.pathname === "/api/nodes" && req.method === "GET") {
        const denied = requireAdmin(req);
        if (denied) return denied;
        return Response.json({ nodes: hub.listConnections() });
      }

      if (url.pathname === "/api/logs" && req.method === "GET") {
        const denied = requireAdmin(req);
        if (denied) return denied;
        return Response.json({ logs: log.entries() });
      }

      // ── Node & project removal (admin-key protected) ────────

      if (url.pathname.startsWith("/api/project/") && req.method === "DELETE") {
        const denied = requireAdmin(req);
        if (denied) return denied;
        const projectName = decodeURIComponent(url.pathname.slice("/api/project/".length));
        if (!projectName) {
          return Response.json({ error: "Missing projectId" }, { status: 400 });
        }
        const project = await findProjectByName(projectName);
        if (!project) {
          return Response.json({ error: "Project not found" }, { status: 404 });
        }
        const disconnected = await hub.disconnectProject(projectName);
        const revoked = await repos.tokens.revokeByProject(project.id);
        await repos.projects.remove(project.id);
        log.info(`Project removed: ${projectName}`, { revoked: String(revoked), disconnected: String(disconnected) });
        return Response.json({ revoked, disconnected });
      }

      if (url.pathname.startsWith("/api/node/") && req.method === "DELETE") {
        const denied = requireAdmin(req);
        if (denied) return denied;
        // /api/node/:projectName/:nodeId
        const parts = url.pathname.slice("/api/node/".length).split("/").map(decodeURIComponent);
        if (parts.length < 2 || !parts[0] || !parts[1]) {
          return Response.json({ error: "Missing projectId or nodeId" }, { status: 400 });
        }
        const [projectName, nodeId] = parts;
        const project = await findProjectByName(projectName);
        if (!project) {
          return Response.json({ error: "Project not found" }, { status: 404 });
        }
        const disconnected = await hub.disconnect(projectName, nodeId);
        const revoked = await repos.tokens.revokeByNode(project.id, nodeId);
        log.info(`Node removed: ${nodeId} from ${projectName}`, { revoked: String(revoked), disconnected: String(disconnected) });
        return Response.json({ revoked, disconnected });
      }

      if (url.pathname.startsWith("/api/disconnect/") && req.method === "POST") {
        const denied = requireAdmin(req);
        if (denied) return denied;
        const parts = url.pathname.slice("/api/disconnect/".length).split("/").map(decodeURIComponent);
        if (parts.length < 2 || !parts[0] || !parts[1]) {
          return Response.json({ error: "Missing projectId or nodeId" }, { status: 400 });
        }
        const [projectId, nodeId] = parts;
        const disconnected = await hub.disconnect(projectId, nodeId);
        return Response.json({ disconnected });
      }

      // ── Node-facing API (token-authenticated) ─────────────

      if (url.pathname === "/api/online" && req.method === "GET") {
        const token = url.searchParams.get("token");
        if (!token) {
          return Response.json({ error: "Missing token" }, { status: 401 });
        }
        const info = await repos.tokens.validate(token);
        if (!info) {
          return Response.json({ error: "Invalid token" }, { status: 401 });
        }
        const online = await hub.listOnline(info.projectId);
        // Exclude the requesting node itself
        const others = online.filter((id) => id !== info.nodeId);
        return Response.json({ nodes: others, project: info.projectId });
      }

      // ── WebSocket upgrade ────────────────────────────────────

      if (url.pathname === "/ws") {
        const token = url.searchParams.get("token");
        if (!token) {
          return new Response("Missing token", { status: 401 });
        }

        const info = await repos.tokens.validate(token);
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
        log.info(`Node connected: ${nodeId}`, { projectId, nodeId });
      },

      async message(ws, msg) {
        try {
          const raw = typeof msg === "string" ? msg : new TextDecoder().decode(msg);
          const envelope = parseEnvelope(raw);
          // Override with server-authenticated identity so routing is consistent
          envelope.fromNode = ws.data.nodeId;
          envelope.projectId = ws.data.projectId;
          await hub.route(envelope);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : "Unknown error";
          log.error(`Parse error from ${ws.data.nodeId}: ${errorMsg}`, {
            projectId: ws.data.projectId,
            nodeId: ws.data.nodeId,
          });
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
        log.info(`Node disconnected: ${nodeId}`, { projectId, nodeId });
      },
    },
  });

  console.log(`inv-server listening on port ${server.port} (instance: ${instanceId})`);

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await hub.shutdown();
    await disconnectPrisma();
    redis.disconnect();
    server.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await hub.shutdown();
    await disconnectPrisma();
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

async function tokenCreate(args: string[]): Promise<void> {
  let project = "";
  let nodeId = "";

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
    console.error("Usage: token create --project <project> --node <nodeId>");
    process.exit(1);
  }

  const prisma = getPrisma();
  const repos = createRepositories(prisma);
  try {
    const projects = await repos.projects.list();
    let projectRecord = projects.find((p) => p.name === project);
    if (!projectRecord) {
      projectRecord = await repos.projects.create(project);
    }
    const token = await repos.tokens.create(projectRecord.id, nodeId);
    console.log(token.secret);
  } finally {
    await disconnectPrisma();
  }
}

async function tokenList(args: string[]): Promise<void> {
  let project = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--project" && args[i + 1]) {
      project = args[i + 1];
      i++;
    }
  }

  if (!project) {
    console.error("Usage: token list --project <project>");
    process.exit(1);
  }

  const prisma = getPrisma();
  const repos = createRepositories(prisma);
  try {
    const projects = await repos.projects.list();
    const projectRecord = projects.find((p) => p.name === project);
    if (!projectRecord) {
      console.log("No tokens found.");
      return;
    }
    const tokens = await repos.tokens.listByProject(projectRecord.id);
    if (tokens.length === 0) {
      console.log("No tokens found.");
    } else {
      for (const t of tokens) {
        console.log(`${t.nodeId}\t${t.createdAt}`);
      }
    }
  } finally {
    await disconnectPrisma();
  }
}

async function tokenRevoke(args: string[]): Promise<void> {
  let token = "";
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) {
      token = args[i];
      break;
    }
  }

  if (!token) {
    console.error("Usage: token revoke <token>");
    process.exit(1);
  }

  const prisma = getPrisma();
  const repos = createRepositories(prisma);
  try {
    await repos.tokens.revoke(token);
    console.log("Token revoked.");
  } finally {
    await disconnectPrisma();
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
