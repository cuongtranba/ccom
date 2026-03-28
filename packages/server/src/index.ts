import { randomUUID } from "crypto";
import { readFileSync, existsSync, statSync } from "fs";
import { resolve, dirname, join, extname } from "path";
import { fileURLToPath } from "url";
import Redis from "ioredis";
import { parseEnvelope, slugify } from "@inv/shared";

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
  projectIds: string[];
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

      // ── Public endpoints (no auth) ─────────────────────────

      if (url.pathname === "/api/project/public-list" && req.method === "GET") {
        const projects = await repos.projects.list();
        return Response.json({ projects: projects.map((p) => p.name) });
      }

      if (url.pathname === "/api/register" && req.method === "POST") {
        const body = await req.json() as { project?: string; nodeId?: string; name?: string; vertical?: string; owner?: string };
        if (!body.project || !body.nodeId || !body.name) {
          return Response.json({ error: "Missing project, nodeId, or name" }, { status: 400 });
        }
        const nodeIdSlug = slugify(body.nodeId);
        if (!nodeIdSlug) {
          return Response.json({ error: "Node ID is empty after normalization" }, { status: 400 });
        }
        const project = await repos.projects.findByName(body.project);
        if (!project) {
          return Response.json({ error: `Project "${body.project}" does not exist` }, { status: 400 });
        }
        if (await repos.tokens.nodeExists(nodeIdSlug)) {
          return Response.json({ error: `Node "${nodeIdSlug}" already exists` }, { status: 409 });
        }
        const nodeId = nodeIdSlug;
        const name = body.name;
        const vertical = body.vertical ?? "";
        const owner = body.owner ?? "";
        const token = await repos.tokens.create({ nodeId, name, vertical, owner });
        await repos.tokens.assignProject(token.id, project.id);
        return Response.json({ token: token.secret, nodeId, name, vertical, owner, project: body.project });
      }

      if (url.pathname === "/api/token/info" && req.method === "GET") {
        const token = url.searchParams.get("token");
        if (!token) {
          return Response.json({ error: "Missing token" }, { status: 401 });
        }
        const info = await repos.tokens.validate(token);
        if (!info) {
          return Response.json({ error: "Invalid token" }, { status: 401 });
        }
        return Response.json({
          nodeId: info.nodeId,
          name: info.name,
          vertical: info.vertical,
          owner: info.owner,
          projects: info.projects.map((p) => ({ name: p.name })),
        });
      }

      // ── Project management API (admin-key protected) ───────

      if (url.pathname === "/api/project/create" && req.method === "POST") {
        const denied = requireAdmin(req);
        if (denied) return denied;
        const body = await req.json() as { project?: string };
        if (!body.project) {
          return Response.json({ error: "Missing project" }, { status: 400 });
        }
        const projectName = slugify(body.project);
        if (!projectName) {
          return Response.json({ error: "Project name is empty after normalization" }, { status: 400 });
        }
        const exists = await repos.projects.exists(projectName);
        if (exists) {
          return Response.json({ error: `Project "${projectName}" already exists` }, { status: 409 });
        }
        await repos.projects.create(projectName);
        return Response.json({ project: projectName, created: true });
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
        const body = await req.json() as { nodeId?: string; name?: string; vertical?: string; owner?: string };
        if (!body.nodeId || !body.name) {
          return Response.json({ error: "Missing nodeId or name" }, { status: 400 });
        }
        const nodeIdSlug = slugify(body.nodeId);
        if (!nodeIdSlug) {
          return Response.json({ error: "Node ID is empty after normalization" }, { status: 400 });
        }
        if (await repos.tokens.nodeExists(nodeIdSlug)) {
          return Response.json({ error: `Node "${nodeIdSlug}" already exists` }, { status: 409 });
        }
        const token = await repos.tokens.create({
          nodeId: nodeIdSlug,
          name: body.name,
          vertical: body.vertical ?? "",
          owner: body.owner ?? "",
        });
        return Response.json({ token: token.secret, nodeId: nodeIdSlug, id: token.id });
      }

      if (url.pathname === "/api/token/assign" && req.method === "POST") {
        const denied = requireAdmin(req);
        if (denied) return denied;
        const body = await req.json() as { tokenId?: string; project?: string };
        if (!body.tokenId || !body.project) {
          return Response.json({ error: "Missing tokenId or project" }, { status: 400 });
        }
        const project = await repos.projects.findByName(body.project);
        if (!project) {
          return Response.json({ error: `Project "${body.project}" does not exist` }, { status: 404 });
        }
        await repos.tokens.assignProject(body.tokenId, project.id);
        return Response.json({ assigned: true });
      }

      if (url.pathname === "/api/token/unassign" && req.method === "POST") {
        const denied = requireAdmin(req);
        if (denied) return denied;
        const body = await req.json() as { tokenId?: string; project?: string };
        if (!body.tokenId || !body.project) {
          return Response.json({ error: "Missing tokenId or project" }, { status: 400 });
        }
        const project = await repos.projects.findByName(body.project);
        if (!project) {
          return Response.json({ error: `Project "${body.project}" does not exist` }, { status: 404 });
        }
        await repos.tokens.unassignProject(body.tokenId, project.id);
        return Response.json({ unassigned: true });
      }

      if (url.pathname === "/api/token/list" && req.method === "GET") {
        const denied = requireAdmin(req);
        if (denied) return denied;
        const project = url.searchParams.get("project");
        if (project) {
          const projectRecord = await repos.projects.findByName(project);
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
        const body = await req.json() as { token?: string; nodeId?: string };
        if (body.nodeId) {
          await repos.tokens.revokeByNode(body.nodeId);
          return Response.json({ revoked: true });
        }
        if (body.token) {
          await repos.tokens.revoke(body.token);
          return Response.json({ revoked: true });
        }
        return Response.json({ error: "Missing token or nodeId" }, { status: 400 });
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
        const project = await repos.projects.findByName(projectName);
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
        const project = await repos.projects.findByName(projectName);
        if (!project) {
          return Response.json({ error: "Project not found" }, { status: 404 });
        }
        const disconnected = await hub.disconnect(projectName, nodeId);
        const revoked = await repos.tokens.revokeByNode(nodeId);
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
        const projectResults: { name: string; nodes: { nodeId: string; name: string; vertical: string }[] }[] = [];
        for (const proj of info.projects) {
          const onlineIds = await hub.listOnline(proj.name);
          const others = onlineIds.filter((id) => id !== info.nodeId);
          const allTokens = await repos.tokens.listByProject(proj.id);
          const nodes = others.map((nid) => {
            const meta = allTokens.find((t) => t.nodeId === nid);
            return {
              nodeId: nid,
              name: meta?.name ?? "",
              vertical: meta?.vertical ?? "",
            };
          });
          projectResults.push({ name: proj.name, nodes });
        }
        return Response.json({ projects: projectResults });
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

        const projectNames = info.projects.map((p) => p.name);

        const upgraded = server.upgrade(req, {
          data: { projectIds: projectNames, nodeId: info.nodeId },
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
        const { projectIds, nodeId } = ws.data;
        const wrapped = wrapBunWs(ws);
        for (const pid of projectIds) {
          const connKey = `${pid}:${nodeId}`;
          wsMap.set(connKey, wrapped);
        }
        await hub.register(projectIds, nodeId, wrapped);
        for (const pid of projectIds) {
          await hub.drainOutbox(pid, nodeId, wrapped);
        }
        log.info(`Node connected: ${nodeId}`, { projects: projectIds.join(",") });
      },

      async message(ws, msg) {
        try {
          const raw = typeof msg === "string" ? msg : new TextDecoder().decode(msg);
          const envelope = parseEnvelope(raw);
          // Override with server-authenticated identity so routing is consistent
          envelope.fromNode = ws.data.nodeId;
          await hub.route(envelope);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : "Unknown error";
          log.error(`Parse error from ${ws.data.nodeId}: ${errorMsg}`, {
            projectId: ws.data.projectIds[0] || "",
            nodeId: ws.data.nodeId,
          });
          ws.send(
            JSON.stringify({
              messageId: randomUUID(),
              fromNode: "",
              toNode: ws.data.nodeId,
              projectId: ws.data.projectIds[0] || "",
              timestamp: new Date().toISOString(),
              payload: { type: "error", code: "PARSE_ERROR", message: errorMsg },
            }),
          );
        }
      },

      async close(ws) {
        const { projectIds, nodeId } = ws.data;
        for (const pid of projectIds) {
          wsMap.delete(`${pid}:${nodeId}`);
        }
        await hub.unregister(projectIds, nodeId);
        log.info(`Node disconnected: ${nodeId}`, { projects: projectIds.join(",") });
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
  let nodeId = "";
  let name = "";
  let vertical = "";
  let owner = "";
  let project = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--node" && args[i + 1]) { nodeId = args[i + 1]; i++; }
    else if (args[i] === "--name" && args[i + 1]) { name = args[i + 1]; i++; }
    else if (args[i] === "--vertical" && args[i + 1]) { vertical = args[i + 1]; i++; }
    else if (args[i] === "--owner" && args[i + 1]) { owner = args[i + 1]; i++; }
    else if (args[i] === "--project" && args[i + 1]) { project = args[i + 1]; i++; }
  }

  if (!nodeId || !name) {
    console.error("Usage: token create --node <nodeId> --name <name> [--vertical <v>] [--owner <o>] [--project <p>]");
    process.exit(1);
  }

  nodeId = slugify(nodeId);

  const prisma = getPrisma();
  const repos = createRepositories(prisma);
  try {
    const token = await repos.tokens.create({ nodeId, name, vertical, owner });
    if (project) {
      const projects = await repos.projects.list();
      let projectRecord = projects.find((p) => p.name === project);
      if (!projectRecord) {
        projectRecord = await repos.projects.create(project);
      }
      await repos.tokens.assignProject(token.id, projectRecord.id);
    }
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
    const projectRecord = await repos.projects.findByName(project);
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
