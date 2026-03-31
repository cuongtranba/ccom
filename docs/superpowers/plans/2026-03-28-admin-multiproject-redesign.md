# Admin UI Redesign + Multi-Project Nodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the data model so one token maps to multiple projects, redesign the admin UI with datatables and public self-registration, simplify the CLI wizard, enhance the MCP online-nodes tool, and add a Claude Code status line.

**Architecture:** Server-side Prisma schema gains a `TokenProject` join table and node metadata on `Token`. The `Vertical` type becomes free-form string. Admin UI splits into public registration mode and authenticated admin mode with datatable components. CLI wizard auto-fetches node info from the server via token. MCP tool returns grouped online nodes. Status line hooks into channel startup.

**Tech Stack:** Bun, Prisma (PostgreSQL), React + Vite + TanStack Query (admin), `@modelcontextprotocol/sdk` (MCP), `bun:sqlite` (local node DB)

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `packages/server/prisma/migrations/<timestamp>_multi_project/migration.sql` | Prisma migration for schema changes |
| `packages/admin/src/components/data-table.tsx` | Reusable datatable component |
| `packages/admin/src/components/register-form.tsx` | Public self-registration form |
| `packages/admin/src/components/projects-table.tsx` | Projects datatable with expandable rows |
| `packages/admin/src/components/nodes-table.tsx` | Nodes/tokens datatable |

### Modified Files
| File | Changes |
|------|---------|
| `packages/shared/src/types.ts` | `Vertical` → `string`, remove `UPSTREAM_VERTICALS` |
| `packages/shared/src/types.test.ts` | Remove `UPSTREAM_VERTICALS` tests, update `Vertical` tests |
| `packages/server/prisma/schema.prisma` | Add `TokenProject` model, add fields to `Token`, remove `projectId` FK |
| `packages/server/src/repositories/token.repository.ts` | Rewrite for join table, add `name/vertical/owner`, new methods |
| `packages/server/src/repositories/project.repository.ts` | Add `findByName()` method |
| `packages/server/src/repositories/index.ts` | Update `TokenInfo` export |
| `packages/server/src/hub.ts` | `register/unregister` accept `projectIds[]`, multi-project presence |
| `packages/server/src/index.ts` | New endpoints, modified WS handler, updated token create/validate |
| `packages/admin/src/lib/api.ts` | New API functions, updated types |
| `packages/admin/src/hooks/queries.ts` | New hooks for registration, updated token/project hooks |
| `packages/admin/src/App.tsx` | Two-mode layout (public vs admin) |
| `packages/admin/src/components/auth-gate.tsx` | Minor adjustment for two-mode switching |
| `packages/admin/src/lib/utils.ts` | No changes needed (slugify already exists) |
| `packages/node/src/config.ts` | `node.project` → `node.projects: string[]` |
| `packages/node/src/cli.ts` | Simplified wizard (3 inputs), fetch from server |
| `packages/node/src/ws-client.ts` | `projectId` → `projectIds[]`, multi-project envelope support |
| `packages/node/src/channel.ts` | Updated `inv_online_nodes`, status line setup, multi-project config |
| `packages/node/src/engine.ts` | Remove `UPSTREAM_VERTICALS` import, fix `tieBreak` |
| `packages/node/src/store.ts` | Remove `UPSTREAM_VERTICALS` usage in `generateAudit`, update `Vertical` type refs |
| `packages/node/test/cli.test.ts` | Update for new wizard interface |
| `packages/node/test/engine.test.ts` | Update vertical-related tests |
| `packages/node/test/store.test.ts` | Update vertical-related tests |

---

## Task 1: Remove Vertical Enum and UPSTREAM_VERTICALS

This is the foundation — many files depend on the `Vertical` type and `UPSTREAM_VERTICALS`. Change them first so downstream tasks compile.

**Files:**
- Modify: `packages/shared/src/types.ts:1` and `packages/shared/src/types.ts:126-132`
- Modify: `packages/shared/src/types.test.ts`
- Modify: `packages/node/src/engine.ts:20,450`
- Modify: `packages/node/src/store.ts:26,278,401,433,435,1100,1126-1131`
- Modify: `packages/node/src/config.ts`
- Modify: `packages/node/src/cli.ts:3,63,86-91`
- Test: `packages/shared/src/types.test.ts`, `packages/node/test/cli.test.ts`

- [ ] **Step 1: Update shared types**

In `packages/shared/src/types.ts`, change line 1:
```typescript
// OLD:
export type Vertical = "pm" | "design" | "dev" | "qa" | "devops";

// NEW:
export type Vertical = string;
```

Remove lines 126-132 (`UPSTREAM_VERTICALS` constant entirely).

In the `Node` interface, `vertical` stays as `Vertical` (which is now `string`).
In `KindMapping`, `fromVertical`/`toVertical` stay as `Vertical`.
In `Vote`, `vertical` stays as `Vertical`.

- [ ] **Step 2: Update shared types tests**

In `packages/shared/src/types.test.ts`, remove the `describe("UPSTREAM_VERTICALS", ...)` block (the tests at lines 205-224). Update any tests that reference the old `Vertical` enum to use free-form strings instead.

- [ ] **Step 3: Fix engine.ts tieBreak**

In `packages/node/src/engine.ts`:
- Remove the import of `UPSTREAM_VERTICALS` at line 20
- Replace the `tieBreak` method (lines 446-458) — without vertical hierarchy, tie-breaking defaults to `false` (reject on tie):

```typescript
private tieBreak(_cr: ChangeRequest): boolean {
  // With free-form verticals, there is no upstream hierarchy.
  // Ties are resolved by rejecting the proposal.
  return false;
}
```

- [ ] **Step 4: Fix store.ts audit**

In `packages/node/src/store.ts`:
- Remove the import of `UPSTREAM_VERTICALS` at line 26
- In the `generateAudit` method, remove the upstream vertical check (lines 1100 and 1126-1135). Replace with:

```typescript
// Remove this line:
// const upstreamVerticals = UPSTREAM_VERTICALS[node.vertical];

// Replace the missingUpstreamRefs block (lines 1126-1135) with:
// With free-form verticals, upstream ref checking is done via explicit traces only.
// Items without any incoming traces are already captured as orphans above.
```

The `missingUpstreamRefs` array stays in the return but will always be empty (no vertical-based checking).

- [ ] **Step 5: Remove Vertical cast annotations in store.ts**

In `packages/node/src/store.ts`, change the `as Vertical` casts at lines 278, 401, 433, 435 to just use the raw string (since `Vertical` is now `string`, the casts are redundant but harmless — leave them or remove them).

- [ ] **Step 6: Fix CLI vertical validation**

In `packages/node/src/cli.ts`:
- Change the import at line 3: `import { type Vertical, slugify } from "@inv/shared";` → `import { slugify } from "@inv/shared";`
- Remove the `VERTICALS` constant at line 63
- Remove the vertical validation check at lines 87-91 (the `if (!VERTICALS.includes(...))` block)
- Change the vertical prompt to just: `const vertical = await ask(rl, "Vertical (e.g. dev, design, qa)");`

- [ ] **Step 7: Update config.ts**

In `packages/node/src/config.ts`, change the `vertical` field type from `Vertical` to `string` in the `NodeConfig` interface, and remove the `Vertical` import if it was imported.

- [ ] **Step 8: Update CLI test**

In `packages/node/test/cli.test.ts`:
- Remove the `Vertical` import at line 3
- Update the test at line 9: remove `as Vertical` cast
- Replace the "handles all verticals" test (lines 38-52) with a test for free-form verticals:

```typescript
test("generateInvConfig accepts any vertical string", () => {
  const config = generateInvConfig({
    name: "custom-node",
    vertical: "frontend",
    project: "my-project",
    owner: "tester",
    serverUrl: "ws://localhost:8080/ws",
    token: "tok",
    dbPath: "./test.db",
  });
  expect(config.node.vertical).toBe("frontend");
});
```

- [ ] **Step 9: Run tests**

Run: `bun test packages/shared && bun test packages/node/test/cli.test.ts`
Expected: All tests pass.

- [ ] **Step 10: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/types.test.ts packages/node/src/engine.ts packages/node/src/store.ts packages/node/src/config.ts packages/node/src/cli.ts packages/node/test/cli.test.ts
git commit -m "$(cat <<'EOF'
refactor: make Vertical free-form string, remove UPSTREAM_VERTICALS

Vertical is no longer an enum — any string is accepted. Signal
propagation and tie-breaking no longer depend on a fixed vertical
hierarchy; traces are the only dependency mechanism.
EOF
)"
```

---

## Task 2: Prisma Schema Migration (Server)

Add node metadata to Token, create TokenProject join table, remove direct projectId FK.

**Files:**
- Modify: `packages/server/prisma/schema.prisma`
- Create: migration via `prisma migrate dev`

- [ ] **Step 1: Update Prisma schema**

Replace the full content of `packages/server/prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
}

generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

model Project {
  id        String         @id @default(uuid())
  name      String         @unique
  createdAt DateTime       @default(now()) @map("created_at")
  tokens    TokenProject[]

  @@map("projects")
}

model Token {
  id        String         @id @default(uuid())
  nodeId    String         @unique @map("node_id")
  name      String         @default("")
  vertical  String         @default("")
  owner     String         @default("")
  secret    String         @unique @default(uuid())
  createdAt DateTime       @default(now()) @map("created_at")
  projects  TokenProject[]

  @@map("tokens")
}

model TokenProject {
  tokenId   String @map("token_id")
  projectId String @map("project_id")
  token     Token   @relation(fields: [tokenId], references: [id], onDelete: Cascade)
  project   Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@id([tokenId, projectId])
  @@map("token_projects")
}
```

Key changes:
- `Token.nodeId` is now `@unique` (one token per nodeId globally)
- `Token` gains `name`, `vertical`, `owner` fields
- `Token.projectId` removed — replaced by `TokenProject` join table
- `TokenProject` has composite PK `[tokenId, projectId]`

- [ ] **Step 2: Create a manual migration SQL**

Since we need to migrate existing data, create a migration manually. Run:

```bash
cd packages/server && npx prisma migrate dev --create-only --name multi_project
```

Then edit the generated migration SQL to include data migration:

```sql
-- Step 1: Add new columns to tokens
ALTER TABLE "tokens" ADD COLUMN "name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "tokens" ADD COLUMN "vertical" TEXT NOT NULL DEFAULT '';
ALTER TABLE "tokens" ADD COLUMN "owner" TEXT NOT NULL DEFAULT '';

-- Step 2: Create join table
CREATE TABLE "token_projects" (
    "token_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    CONSTRAINT "token_projects_pkey" PRIMARY KEY ("token_id","project_id")
);

-- Step 3: Migrate existing data (each token's projectId → token_projects row)
INSERT INTO "token_projects" ("token_id", "project_id")
SELECT "id", "project_id" FROM "tokens" WHERE "project_id" IS NOT NULL;

-- Step 4: Drop old foreign key and column
ALTER TABLE "tokens" DROP CONSTRAINT IF EXISTS "tokens_project_id_fkey";
ALTER TABLE "tokens" DROP COLUMN "project_id";

-- Step 5: Drop old unique constraint and add new one
ALTER TABLE "tokens" DROP CONSTRAINT IF EXISTS "tokens_project_id_node_id_key";
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_node_id_key" UNIQUE ("node_id");

-- Step 6: Add foreign keys to join table
ALTER TABLE "token_projects" ADD CONSTRAINT "token_projects_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "token_projects" ADD CONSTRAINT "token_projects_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Generate Prisma client**

Run: `cd packages/server && npx prisma generate`
Expected: Prisma client regenerated with new types.

- [ ] **Step 4: Commit**

```bash
git add packages/server/prisma/
git commit -m "$(cat <<'EOF'
feat(server): add TokenProject join table, node metadata on Token

Migration adds name/vertical/owner to tokens, creates token_projects
join table, and migrates existing projectId data.
EOF
)"
```

---

## Task 3: Update Server Repositories

Rewrite token repository for the new schema. Update project repository.

**Files:**
- Modify: `packages/server/src/repositories/token.repository.ts`
- Modify: `packages/server/src/repositories/project.repository.ts`
- Modify: `packages/server/src/repositories/index.ts`

- [ ] **Step 1: Rewrite token repository**

Replace `packages/server/src/repositories/token.repository.ts`:

```typescript
import type { PrismaClient, Token } from "../../generated/prisma/client";

export interface TokenInfo {
  id: string;
  nodeId: string;
  name: string;
  vertical: string;
  owner: string;
  projects: string[];
  createdAt: string;
}

export interface TokenValidation {
  tokenId: string;
  nodeId: string;
  name: string;
  vertical: string;
  owner: string;
  projects: { id: string; name: string }[];
}

export class TokenRepository {
  constructor(private prisma: PrismaClient) {}

  async create(input: {
    nodeId: string;
    name: string;
    vertical: string;
    owner: string;
  }): Promise<Token> {
    return this.prisma.token.create({
      data: {
        nodeId: input.nodeId,
        name: input.name,
        vertical: input.vertical,
        owner: input.owner,
      },
    });
  }

  async validate(secret: string): Promise<TokenValidation | null> {
    const token = await this.prisma.token.findUnique({
      where: { secret },
      include: { projects: { include: { project: true } } },
    });
    if (!token) return null;
    return {
      tokenId: token.id,
      nodeId: token.nodeId,
      name: token.name,
      vertical: token.vertical,
      owner: token.owner,
      projects: token.projects.map((tp) => ({
        id: tp.projectId,
        name: tp.project.name,
      })),
    };
  }

  async assignProject(tokenId: string, projectId: string): Promise<void> {
    await this.prisma.tokenProject.create({
      data: { tokenId, projectId },
    });
  }

  async unassignProject(tokenId: string, projectId: string): Promise<void> {
    await this.prisma.tokenProject.delete({
      where: { tokenId_projectId: { tokenId, projectId } },
    });
  }

  async revoke(secret: string): Promise<void> {
    await this.prisma.token.deleteMany({ where: { secret } });
  }

  async revokeById(id: string): Promise<void> {
    await this.prisma.token.delete({ where: { id } });
  }

  async revokeByNode(nodeId: string): Promise<number> {
    const result = await this.prisma.token.deleteMany({ where: { nodeId } });
    return result.count;
  }

  async revokeByProject(projectId: string): Promise<number> {
    // Find all tokens assigned to this project, then remove the assignments
    const assignments = await this.prisma.tokenProject.findMany({
      where: { projectId },
    });
    await this.prisma.tokenProject.deleteMany({ where: { projectId } });
    return assignments.length;
  }

  async nodeExists(nodeId: string): Promise<boolean> {
    const count = await this.prisma.token.count({ where: { nodeId } });
    return count > 0;
  }

  async findByNodeId(nodeId: string): Promise<Token | null> {
    return this.prisma.token.findUnique({ where: { nodeId } });
  }

  async listAll(): Promise<TokenInfo[]> {
    const tokens = await this.prisma.token.findMany({
      include: { projects: { include: { project: true } } },
      orderBy: { createdAt: "asc" },
    });
    return tokens.map((t) => ({
      id: t.id,
      nodeId: t.nodeId,
      name: t.name,
      vertical: t.vertical,
      owner: t.owner,
      projects: t.projects.map((tp) => tp.project.name),
      createdAt: t.createdAt.toISOString(),
    }));
  }

  async listByProject(projectId: string): Promise<TokenInfo[]> {
    const tokens = await this.prisma.token.findMany({
      where: { projects: { some: { projectId } } },
      include: { projects: { include: { project: true } } },
      orderBy: { createdAt: "asc" },
    });
    return tokens.map((t) => ({
      id: t.id,
      nodeId: t.nodeId,
      name: t.name,
      vertical: t.vertical,
      owner: t.owner,
      projects: t.projects.map((tp) => tp.project.name),
      createdAt: t.createdAt.toISOString(),
    }));
  }
}
```

- [ ] **Step 2: Update project repository**

Add `findByName` to `packages/server/src/repositories/project.repository.ts`:

```typescript
import type { PrismaClient, Project } from "../../generated/prisma/client";

export class ProjectRepository {
  constructor(private prisma: PrismaClient) {}

  async create(name: string): Promise<Project> {
    return this.prisma.project.create({ data: { name } });
  }

  async exists(name: string): Promise<boolean> {
    const count = await this.prisma.project.count({ where: { name } });
    return count > 0;
  }

  async findByName(name: string): Promise<Project | null> {
    return this.prisma.project.findUnique({ where: { name } });
  }

  async list(): Promise<Project[]> {
    return this.prisma.project.findMany({ orderBy: { name: "asc" } });
  }

  async remove(id: string): Promise<void> {
    await this.prisma.project.delete({ where: { id } });
  }
}
```

- [ ] **Step 3: Update repositories index**

Update `packages/server/src/repositories/index.ts` to export the new `TokenValidation` type:

```typescript
import type { PrismaClient } from "../../generated/prisma/client";
import { ProjectRepository } from "./project.repository";
import { TokenRepository } from "./token.repository";

export { ProjectRepository } from "./project.repository";
export { TokenRepository } from "./token.repository";
export type { TokenInfo, TokenValidation } from "./token.repository";

export interface Repositories {
  projects: ProjectRepository;
  tokens: TokenRepository;
}

export function createRepositories(prisma: PrismaClient): Repositories {
  return {
    projects: new ProjectRepository(prisma),
    tokens: new TokenRepository(prisma),
  };
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/repositories/
git commit -m "$(cat <<'EOF'
feat(server): rewrite repositories for multi-project token model

TokenRepository now supports node metadata (name, vertical, owner),
project assignment/unassignment via join table, and returns enriched
validation data. ProjectRepository gains findByName.
EOF
)"
```

---

## Task 4: Update Hub for Multi-Project Registration

The hub must register/unregister a node across multiple projects simultaneously.

**Files:**
- Modify: `packages/server/src/hub.ts:20-24,37,52-63,65-71`

- [ ] **Step 1: Update ConnectedNode and connection metadata**

In `packages/server/src/hub.ts`, update the `ConnectedNode` interface and the `connMeta` map type:

```typescript
// Line 20-25: Replace ConnectedNode interface
export interface ConnectedNode {
  nodeId: string;
  projects: string[];
  connectedAt: string;
  lastMessageAt: string | null;
}
```

Update `connMeta` map type at line 37:
```typescript
private connMeta = new Map<string, { nodeId: string; projects: string[]; connectedAt: string; lastMessageAt: string | null }>();
```

- [ ] **Step 2: Update register method**

Replace the `register` method (lines 52-63):

```typescript
async register(projectIds: string[], nodeId: string, ws: HubWebSocket): Promise<void> {
  for (const projectId of projectIds) {
    const connKey = `${projectId}:${nodeId}`;
    this.localConns.set(connKey, ws);
    await this.redis.hset(`presence:${projectId}`, nodeId, this.instanceId);
    await this.subRedis.subscribe(`route:${projectId}`);
  }
  // Store metadata once keyed by nodeId (not per-project)
  this.connMeta.set(nodeId, {
    nodeId,
    projects: projectIds,
    connectedAt: new Date().toISOString(),
    lastMessageAt: null,
  });
}
```

- [ ] **Step 3: Update unregister method**

Replace the `unregister` method (lines 65-71):

```typescript
async unregister(projectIds: string[], nodeId: string): Promise<void> {
  for (const projectId of projectIds) {
    const connKey = `${projectId}:${nodeId}`;
    this.localConns.delete(connKey);
    await this.redis.hdel(`presence:${projectId}`, nodeId);
  }
  this.connMeta.delete(nodeId);
}
```

- [ ] **Step 4: Update disconnect method**

Replace the `disconnect` method (lines 73-87):

```typescript
async disconnect(projectId: string, nodeId: string): Promise<boolean> {
  const connKey = `${projectId}:${nodeId}`;
  const ws = this.localConns.get(connKey);
  if (ws) {
    ws.close();
    // Remove from all projects this node was in
    const meta = this.connMeta.get(nodeId);
    if (meta) {
      for (const pid of meta.projects) {
        this.localConns.delete(`${pid}:${nodeId}`);
        await this.redis.hdel(`presence:${pid}`, nodeId);
      }
    }
    this.connMeta.delete(nodeId);
    return true;
  }
  await this.redis.hdel(`presence:${projectId}`, nodeId);
  return false;
}
```

- [ ] **Step 5: Update route method sender metadata**

In the `route` method (line 114-118), update lastMessageAt lookup to use nodeId key:

```typescript
// Update lastMessageAt for the sender (keyed by nodeId)
const senderMeta = this.connMeta.get(envelope.fromNode);
if (senderMeta) {
  senderMeta.lastMessageAt = new Date().toISOString();
}
```

- [ ] **Step 6: Update listConnections**

The `listConnections` method (line 180-182) stays the same — it returns `Array.from(this.connMeta.values())` which now returns the updated `ConnectedNode` shape with `projects: string[]` instead of `project: string`.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/hub.ts
git commit -m "$(cat <<'EOF'
feat(server): hub registers nodes across multiple projects

register/unregister now accept projectIds array. Connection metadata
tracks all projects a node belongs to. disconnect cleans up all
project presence entries.
EOF
)"
```

---

## Task 5: Update Server API Endpoints

Add new endpoints, modify existing ones for the multi-project model.

**Files:**
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Update WsData interface and imports**

At the top of `packages/server/src/index.ts`, update:

```typescript
interface WsData {
  projectIds: string[];
  nodeId: string;
}
```

- [ ] **Step 2: Remove old findProjectByName helper**

Remove the `findProjectByName` function (lines 55-58) — use `repos.projects.findByName()` instead.

- [ ] **Step 3: Add public endpoints**

Add these before the admin-protected section (before line 118):

```typescript
// ── Public endpoints (no auth) ────────────────────────

if (url.pathname === "/api/project/public-list" && req.method === "GET") {
  const projects = await repos.projects.list();
  return Response.json({ projects: projects.map((p) => p.name) });
}

if (url.pathname === "/api/register" && req.method === "POST") {
  const body = await req.json() as {
    project?: string; nodeId?: string; name?: string;
    vertical?: string; owner?: string;
  };
  if (!body.project || !body.nodeId || !body.name) {
    return Response.json({ error: "Missing project, nodeId, or name" }, { status: 400 });
  }
  const nodeIdSlug = slugify(body.nodeId);
  if (!nodeIdSlug) {
    return Response.json({ error: "nodeId is empty after normalization" }, { status: 400 });
  }
  const project = await repos.projects.findByName(body.project);
  if (!project) {
    return Response.json({ error: `Project "${body.project}" not found` }, { status: 404 });
  }
  if (await repos.tokens.nodeExists(nodeIdSlug)) {
    return Response.json({ error: `Node "${nodeIdSlug}" already registered` }, { status: 409 });
  }
  const token = await repos.tokens.create({
    nodeId: nodeIdSlug,
    name: body.name,
    vertical: body.vertical ?? "",
    owner: body.owner ?? "",
  });
  await repos.tokens.assignProject(token.id, project.id);
  return Response.json({
    token: token.secret,
    nodeId: nodeIdSlug,
    name: body.name,
    vertical: body.vertical ?? "",
    owner: body.owner ?? "",
    project: body.project,
  });
}

if (url.pathname === "/api/token/info" && req.method === "GET") {
  const tokenSecret = url.searchParams.get("token");
  if (!tokenSecret) {
    return Response.json({ error: "Missing token" }, { status: 401 });
  }
  const info = await repos.tokens.validate(tokenSecret);
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
```

- [ ] **Step 4: Update project create endpoint**

The existing project create endpoint (around line 118) already uses `slugify`. Keep it as-is.

- [ ] **Step 5: Update token create endpoint**

Replace the token create endpoint:

```typescript
if (url.pathname === "/api/token/create" && req.method === "POST") {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = await req.json() as {
    nodeId?: string; name?: string; vertical?: string; owner?: string;
  };
  if (!body.nodeId || !body.name) {
    return Response.json({ error: "Missing nodeId or name" }, { status: 400 });
  }
  const nodeIdSlug = slugify(body.nodeId);
  if (!nodeIdSlug) {
    return Response.json({ error: "nodeId is empty after normalization" }, { status: 400 });
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
```

- [ ] **Step 6: Add assign/unassign endpoints**

Add after token create:

```typescript
if (url.pathname === "/api/token/assign" && req.method === "POST") {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = await req.json() as { tokenId?: string; project?: string };
  if (!body.tokenId || !body.project) {
    return Response.json({ error: "Missing tokenId or project" }, { status: 400 });
  }
  const project = await repos.projects.findByName(body.project);
  if (!project) {
    return Response.json({ error: `Project "${body.project}" not found` }, { status: 404 });
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
    return Response.json({ error: `Project "${body.project}" not found` }, { status: 404 });
  }
  await repos.tokens.unassignProject(body.tokenId, project.id);
  return Response.json({ unassigned: true });
}
```

- [ ] **Step 7: Update token list endpoint**

Update the token list handler to return enriched data:

```typescript
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
```

- [ ] **Step 8: Update online endpoint**

Replace the `/api/online` handler:

```typescript
if (url.pathname === "/api/online" && req.method === "GET") {
  const tokenSecret = url.searchParams.get("token");
  if (!tokenSecret) {
    return Response.json({ error: "Missing token" }, { status: 401 });
  }
  const info = await repos.tokens.validate(tokenSecret);
  if (!info) {
    return Response.json({ error: "Invalid token" }, { status: 401 });
  }
  const projects: { name: string; nodes: { nodeId: string; name: string; vertical: string }[] }[] = [];
  for (const proj of info.projects) {
    const onlineNodeIds = await hub.listOnline(proj.name);
    const others = onlineNodeIds.filter((id) => id !== info.nodeId);
    // Look up node metadata from tokens in this project
    const projectTokens = await repos.tokens.listByProject(proj.id);
    const nodes = others.map((nid) => {
      const t = projectTokens.find((tk) => tk.nodeId === nid);
      return { nodeId: nid, name: t?.name ?? nid, vertical: t?.vertical ?? "" };
    });
    projects.push({ name: proj.name, nodes });
  }
  return Response.json({ projects });
}
```

- [ ] **Step 9: Update node removal endpoint**

Update `/api/node/:projectName/:nodeId` DELETE handler to use the new repository methods:

```typescript
if (url.pathname.startsWith("/api/node/") && req.method === "DELETE") {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const parts = url.pathname.slice("/api/node/".length).split("/").map(decodeURIComponent);
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return Response.json({ error: "Missing projectId or nodeId" }, { status: 400 });
  }
  const [projectName, nodeId] = parts;
  const disconnected = await hub.disconnect(projectName, nodeId);
  const revoked = await repos.tokens.revokeByNode(nodeId);
  log.info(`Node removed: ${nodeId} from ${projectName}`, { revoked: String(revoked), disconnected: String(disconnected) });
  return Response.json({ revoked, disconnected });
}
```

- [ ] **Step 10: Update WebSocket upgrade and handlers**

Update the WS upgrade to pass `projectIds` (project names) and the open/close handlers:

```typescript
// In /ws handler:
const info = await repos.tokens.validate(token);
if (!info) {
  return new Response("Invalid token", { status: 401 });
}
const projectNames = info.projects.map((p) => p.name);
const upgraded = server.upgrade(req, {
  data: { projectIds: projectNames, nodeId: info.nodeId },
});

// In websocket.open:
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

// In websocket.close:
async close(ws) {
  const { projectIds, nodeId } = ws.data;
  for (const pid of projectIds) {
    wsMap.delete(`${pid}:${nodeId}`);
  }
  await hub.unregister(projectIds, nodeId);
  log.info(`Node disconnected: ${nodeId}`, { projects: projectIds.join(",") });
},
```

The `message` handler stays the same — it uses `envelope.projectId` to route per-message.

- [ ] **Step 11: Update CLI token commands**

Update `tokenCreate` function to use the new repository signature:

```typescript
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
```

- [ ] **Step 12: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "$(cat <<'EOF'
feat(server): add public registration, token info, assign/unassign endpoints

New public endpoints: /api/project/public-list, /api/register,
/api/token/info. Updated token create to store node metadata.
WS handler registers across all assigned projects.
EOF
)"
```

---

## Task 6: Update Node Config and WS Client

Change `node.project` to `node.projects[]` and update WSClient for multi-project.

**Files:**
- Modify: `packages/node/src/config.ts`
- Modify: `packages/node/src/ws-client.ts`
- Modify: `packages/node/test/config.test.ts`

- [ ] **Step 1: Update NodeConfig interface**

In `packages/node/src/config.ts`, change the `node` section of `NodeConfig`:

```typescript
export interface NodeConfig {
  node: {
    id: string;
    name: string;
    vertical: string;
    projects: string[];  // was: project: string
    owner: string;
    isAI: boolean;
  };
  server: {
    url: string;
    token: string;
  };
  database: {
    path: string;
  };
  autonomy: {
    auto: string[];
    approval: string[];
  };
}
```

Update `defaultConfig()` to use `projects: []` instead of `project: ""`.

- [ ] **Step 2: Update WSClient config**

In `packages/node/src/ws-client.ts`, change `WSClientConfig`:

```typescript
export interface WSClientConfig {
  serverUrl: string;
  token: string;
  nodeId: string;
  projectIds: string[];  // was: projectId: string
}
```

Update `sendMessage` and `broadcast` to accept a `projectId` parameter:

```typescript
sendMessage(toNode: string, projectId: string, payload: MessagePayload): void {
  const envelope = createEnvelope(
    this.config.nodeId,
    toNode,
    projectId,
    payload,
  );
  this.send(envelope);
}

broadcast(projectId: string, payload: MessagePayload): void {
  const envelope = createEnvelope(
    this.config.nodeId,
    "",
    projectId,
    payload,
  );
  this.send(envelope);
}
```

- [ ] **Step 3: Update config test**

Update `packages/node/test/config.test.ts` to use `projects: []` instead of `project: ""` in any test fixtures.

- [ ] **Step 4: Run tests**

Run: `bun test packages/node/test/config.test.ts`
Expected: Tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/node/src/config.ts packages/node/src/ws-client.ts packages/node/test/config.test.ts
git commit -m "$(cat <<'EOF'
feat(node): config uses projects[] array, WSClient supports multi-project

node.project becomes node.projects (string array). WSClient methods
now take explicit projectId parameter for envelope creation.
EOF
)"
```

---

## Task 7: Update Channel.ts for Multi-Project

Update tool handlers, MCP instructions, and node registration for multi-project config.

**Files:**
- Modify: `packages/node/src/channel.ts`

- [ ] **Step 1: Update WSClient creation**

In `startChannelServer` (line 599-605), update WSClient config:

```typescript
wsClient = new WSClient({
  serverUrl: config.server.url,
  token: config.server.token,
  nodeId: config.node.id,
  projectIds: config.node.projects,
});
```

- [ ] **Step 2: Update node registration**

In `startChannelServer` (lines 576-591), change `config.node.project` to `config.node.projects`:

```typescript
if (!config.node.id) {
  const node = engine.registerNode(
    config.node.name || "unnamed-node",
    config.node.vertical,
    config.node.projects[0] || "default",
    config.node.owner || "local",
    config.node.isAI,
  );
  config.node.id = node.id;

  const updatedRaw = JSON.parse(readFileSync(configPath, "utf-8"));
  if (!updatedRaw.node) updatedRaw.node = {};
  updatedRaw.node.id = node.id;
  writeFileSync(configPath, JSON.stringify(updatedRaw, null, 2) + "\n");
}
```

- [ ] **Step 3: Update MCP instructions**

Update the instructions string (line 635):

```typescript
instructions: `You are connected to the inventory network as node "${config.node.name}" (${config.node.vertical}, projects: ${config.node.projects.join(", ")}, owner: ${config.node.owner}).
```

- [ ] **Step 4: Update broadcast/sendMessage calls throughout handlers**

In `buildToolHandlers`, everywhere `wsClient.broadcast(payload)` is called, change to `wsClient.broadcast(config.node.projects[0], payload)`. Everywhere `wsClient.sendMessage(toNode, payload)` is called, change to `wsClient.sendMessage(toNode, config.node.projects[0], payload)`.

These calls are in the tool handler switch cases. The project ID used is `config.node.projects[0]` (the primary project). For targeted messages (like `inv_reply`, `inv_pair_invite`), the project context comes from the envelope's original project.

- [ ] **Step 5: Update inv_online_nodes handler**

Replace the `inv_online_nodes` case (lines 527-546):

```typescript
case "inv_online_nodes": {
  if (!config.server.url || !config.server.token) {
    return text(JSON.stringify({ error: "Not configured for network" }));
  }
  const httpUrl = config.server.url
    .replace(/^ws/, "http")
    .replace(/\/ws$/, "/api/online");
  const res = await fetch(`${httpUrl}?token=${config.server.token}`);
  if (!res.ok) {
    const err = await res.json() as { error?: string };
    return text(JSON.stringify({ error: err.error ?? `HTTP ${res.status}` }));
  }
  const data = await res.json() as {
    projects: { name: string; nodes: { nodeId: string; name: string; vertical: string }[] }[];
  };
  // Format as readable grouped output
  const lines: string[] = ["Online Nodes", ""];
  let totalNodes = 0;
  for (const proj of data.projects) {
    lines.push(`── ${proj.name} ──`);
    if (proj.nodes.length === 0) {
      lines.push("  (no other nodes online)");
    } else {
      for (const node of proj.nodes) {
        const vLabel = node.vertical ? ` (${node.vertical})` : "";
        lines.push(`  ${node.nodeId}${vLabel} — online`);
        totalNodes++;
      }
    }
    lines.push("");
  }
  lines.push(`Total: ${totalNodes} node${totalNodes !== 1 ? "s" : ""} online across ${data.projects.length} project${data.projects.length !== 1 ? "s" : ""}`);
  return text(lines.join("\n"));
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/node/src/channel.ts
git commit -m "$(cat <<'EOF'
feat(node): channel supports multi-project config and grouped online nodes

WSClient uses projectIds array. MCP instructions show all projects.
inv_online_nodes returns formatted grouped output by project.
EOF
)"
```

---

## Task 8: Simplify CLI Wizard

Wizard now asks only 3 things: server URL, token, database path. Fetches node info from server.

**Files:**
- Modify: `packages/node/src/cli.ts`
- Modify: `packages/node/test/cli.test.ts`

- [ ] **Step 1: Rewrite cli.ts**

Replace the full content of `packages/node/src/cli.ts`:

```typescript
import * as readline from "readline";
import { writeFileSync } from "fs";
import { slugify } from "@inv/shared";

// ── Config Generators (exported for testing) ────────────────────────

interface WizardInput {
  name: string;
  vertical: string;
  projects: string[];
  owner: string;
  serverUrl: string;
  token: string;
  dbPath: string;
}

interface InvConfig {
  node: { name: string; vertical: string; projects: string[]; owner: string };
  server: { url: string; token: string };
  database: { path: string };
}

interface McpConfig {
  mcpServers: {
    inventory: {
      command: string;
      args: string[];
    };
  };
}

export function generateInvConfig(input: WizardInput): InvConfig {
  return {
    node: {
      name: input.name,
      vertical: input.vertical,
      projects: input.projects,
      owner: input.owner,
    },
    server: {
      url: input.serverUrl,
      token: input.token,
    },
    database: {
      path: input.dbPath,
    },
  };
}

export function generateMcpConfig(configPath: string): McpConfig {
  return {
    mcpServers: {
      inventory: {
        command: "bunx",
        args: ["@tini-works/inv-node@latest", "serve", configPath],
      },
    },
  };
}

// ── Fetch token info from server ────────────────────────────────────

interface TokenInfoResponse {
  nodeId: string;
  name: string;
  vertical: string;
  owner: string;
  projects: { name: string }[];
}

export async function fetchTokenInfo(
  serverUrl: string,
  token: string,
): Promise<TokenInfoResponse> {
  const httpUrl = serverUrl
    .replace(/^ws/, "http")
    .replace(/\/ws$/, "/api/token/info");
  const res = await fetch(`${httpUrl}?token=${token}`);
  if (!res.ok) {
    const err = await res.json() as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<TokenInfoResponse>;
}

// ── Interactive Wizard ───────────────────────────────────────────────

function ask(rl: readline.Interface, question: string, defaultValue?: string): Promise<string> {
  const prompt = defaultValue ? `${question} (${defaultValue}): ` : `${question}: `;
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

export async function runWizard(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("");
  console.log("Inventory Node Setup");
  console.log("────────────────────");
  console.log("");

  const serverUrl = await ask(rl, "Server URL", "ws://localhost:8080/ws");
  const token = await ask(rl, "Auth token");
  const dbPath = await ask(rl, "Database path", "./inventory.db");

  console.log("");
  console.log("Fetching node info from server...");

  let info: TokenInfoResponse;
  try {
    info = await fetchTokenInfo(serverUrl, token);
  } catch (err) {
    console.error(`Failed to fetch token info: ${err instanceof Error ? err.message : String(err)}`);
    rl.close();
    process.exit(1);
  }

  console.log(`  Node: ${info.name} (${info.nodeId})`);
  console.log(`  Vertical: ${info.vertical}`);
  console.log(`  Owner: ${info.owner}`);
  console.log(`  Projects: ${info.projects.map((p) => p.name).join(", ") || "(none)"}`);
  console.log("");

  rl.close();

  const invConfig = generateInvConfig({
    name: info.name,
    vertical: info.vertical,
    projects: info.projects.map((p) => p.name),
    owner: info.owner,
    serverUrl,
    token,
    dbPath,
  });
  const mcpConfig = generateMcpConfig("./inv-config.json");

  const invConfigPath = "./inv-config.json";
  writeFileSync(invConfigPath, JSON.stringify(invConfig, null, 2) + "\n");
  console.log(`Writing ${invConfigPath}... ✓`);

  const mcpConfigPath = "./.mcp.json";
  writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2) + "\n");
  console.log(`Writing ${mcpConfigPath}... ✓`);

  console.log("");
  console.log("Setup complete! Start Claude Code:");
  console.log("  claude");
  console.log("");
}
```

- [ ] **Step 2: Update CLI test**

Replace `packages/node/test/cli.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { generateInvConfig, generateMcpConfig } from "../src/cli";

describe("CLI config generation", () => {
  test("generateInvConfig creates valid config", () => {
    const config = generateInvConfig({
      name: "dev-node",
      vertical: "dev",
      projects: ["clinic-checkin"],
      owner: "cuong",
      serverUrl: "ws://localhost:8080/ws",
      token: "test-token",
      dbPath: "./inventory.db",
    });

    expect(config.node.name).toBe("dev-node");
    expect(config.node.vertical).toBe("dev");
    expect(config.node.projects).toEqual(["clinic-checkin"]);
    expect(config.node.owner).toBe("cuong");
    expect(config.server.url).toBe("ws://localhost:8080/ws");
    expect(config.server.token).toBe("test-token");
    expect(config.database.path).toBe("./inventory.db");
  });

  test("generateInvConfig handles multiple projects", () => {
    const config = generateInvConfig({
      name: "multi-node",
      vertical: "frontend",
      projects: ["project-a", "project-b", "project-c"],
      owner: "tester",
      serverUrl: "ws://localhost:8080/ws",
      token: "tok",
      dbPath: "./test.db",
    });
    expect(config.node.projects).toEqual(["project-a", "project-b", "project-c"]);
  });

  test("generateMcpConfig creates valid .mcp.json structure", () => {
    const config = generateMcpConfig("./inv-config.json");
    expect(config).toEqual({
      mcpServers: {
        inventory: {
          command: "bunx",
          args: ["@tini-works/inv-node@latest", "serve", "./inv-config.json"],
        },
      },
    });
  });

  test("generateInvConfig accepts any vertical string", () => {
    const config = generateInvConfig({
      name: "custom-node",
      vertical: "frontend",
      projects: ["my-project"],
      owner: "tester",
      serverUrl: "ws://localhost:8080/ws",
      token: "tok",
      dbPath: "./test.db",
    });
    expect(config.node.vertical).toBe("frontend");
  });
});
```

- [ ] **Step 3: Run tests**

Run: `bun test packages/node/test/cli.test.ts`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/node/src/cli.ts packages/node/test/cli.test.ts
git commit -m "$(cat <<'EOF'
feat(node): simplify CLI wizard to 3 inputs with server auto-fetch

Wizard now asks only server URL, token, and database path. Node
metadata (name, vertical, owner, projects) is fetched from the
server via GET /api/token/info.
EOF
)"
```

---

## Task 9: Admin UI — API Client and Hooks

Update the API layer and React Query hooks for the new data model.

**Files:**
- Modify: `packages/admin/src/lib/api.ts`
- Modify: `packages/admin/src/hooks/queries.ts`

- [ ] **Step 1: Update API types and functions**

Replace `packages/admin/src/lib/api.ts`:

```typescript
const BASE = "";

// ── Types ───────────────────────────────────────────────

export interface Metrics {
  connections_active: number;
  messages_routed: number;
  messages_enqueued: number;
  messages_cross_instance: number;
  drains_total: number;
  drain_messages_total: number;
}

export interface TokenInfo {
  id: string;
  nodeId: string;
  name: string;
  vertical: string;
  owner: string;
  projects: string[];
  createdAt: string;
}

export interface CreateTokenResponse {
  token: string;
  nodeId: string;
  id: string;
}

export interface ConnectedNode {
  nodeId: string;
  projects: string[];
  connectedAt: string;
  lastMessageAt: string | null;
}

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  meta?: Record<string, string>;
}

export interface RegisterResponse {
  token: string;
  nodeId: string;
  name: string;
  vertical: string;
  owner: string;
  project: string;
}

// ── Helpers ─────────────────────────────────────────────

function authHeaders(adminKey: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${adminKey}`,
  };
}

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

// ── Public API (no auth) ────────────────────────────────

export async function fetchPublicProjects(): Promise<string[]> {
  const res = await fetch(`${BASE}/api/project/public-list`);
  const data = await handleResponse<{ projects: string[] }>(res);
  return data.projects;
}

export async function registerNode(input: {
  project: string; nodeId: string; name: string; vertical: string; owner: string;
}): Promise<RegisterResponse> {
  const res = await fetch(`${BASE}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<RegisterResponse>(res);
}

// ── Admin API ───────────────────────────────────────────

export async function fetchMetrics(): Promise<Metrics> {
  const res = await fetch(`${BASE}/metrics`);
  return handleResponse<Metrics>(res);
}

export async function createProject(adminKey: string, project: string): Promise<void> {
  const res = await fetch(`${BASE}/api/project/create`, {
    method: "POST",
    headers: authHeaders(adminKey),
    body: JSON.stringify({ project }),
  });
  await handleResponse(res);
}

export async function listProjects(adminKey: string): Promise<string[]> {
  const res = await fetch(`${BASE}/api/project/list`, {
    headers: authHeaders(adminKey),
  });
  const data = await handleResponse<{ projects: string[] }>(res);
  return data.projects;
}

export async function removeProject(adminKey: string, projectName: string): Promise<void> {
  const res = await fetch(`${BASE}/api/project/${encodeURIComponent(projectName)}`, {
    method: "DELETE",
    headers: authHeaders(adminKey),
  });
  await handleResponse(res);
}

export async function createToken(
  adminKey: string,
  input: { nodeId: string; name: string; vertical: string; owner: string },
): Promise<CreateTokenResponse> {
  const res = await fetch(`${BASE}/api/token/create`, {
    method: "POST",
    headers: authHeaders(adminKey),
    body: JSON.stringify(input),
  });
  return handleResponse<CreateTokenResponse>(res);
}

export async function listAllTokens(adminKey: string): Promise<TokenInfo[]> {
  const res = await fetch(`${BASE}/api/token/list`, {
    headers: authHeaders(adminKey),
  });
  const data = await handleResponse<{ tokens: TokenInfo[] }>(res);
  return data.tokens;
}

export async function revokeToken(adminKey: string, secret: string): Promise<void> {
  const res = await fetch(`${BASE}/api/token/revoke`, {
    method: "POST",
    headers: authHeaders(adminKey),
    body: JSON.stringify({ token: secret }),
  });
  await handleResponse(res);
}

export async function removeNode(adminKey: string, projectName: string, nodeId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/node/${encodeURIComponent(projectName)}/${encodeURIComponent(nodeId)}`, {
    method: "DELETE",
    headers: authHeaders(adminKey),
  });
  await handleResponse(res);
}

export async function assignToken(adminKey: string, tokenId: string, project: string): Promise<void> {
  const res = await fetch(`${BASE}/api/token/assign`, {
    method: "POST",
    headers: authHeaders(adminKey),
    body: JSON.stringify({ tokenId, project }),
  });
  await handleResponse(res);
}

export async function unassignToken(adminKey: string, tokenId: string, project: string): Promise<void> {
  const res = await fetch(`${BASE}/api/token/unassign`, {
    method: "POST",
    headers: authHeaders(adminKey),
    body: JSON.stringify({ tokenId, project }),
  });
  await handleResponse(res);
}

export async function disconnectNode(adminKey: string, projectId: string, nodeId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/disconnect/${encodeURIComponent(projectId)}/${encodeURIComponent(nodeId)}`, {
    method: "POST",
    headers: authHeaders(adminKey),
  });
  await handleResponse(res);
}

export async function fetchNodes(adminKey: string): Promise<ConnectedNode[]> {
  const res = await fetch(`${BASE}/api/nodes`, {
    headers: authHeaders(adminKey),
  });
  const data = await handleResponse<{ nodes: ConnectedNode[] }>(res);
  return data.nodes;
}

export async function fetchLogs(adminKey: string): Promise<LogEntry[]> {
  const res = await fetch(`${BASE}/api/logs`, {
    headers: authHeaders(adminKey),
  });
  const data = await handleResponse<{ logs: LogEntry[] }>(res);
  return data.logs;
}
```

- [ ] **Step 2: Update React Query hooks**

Update `packages/admin/src/hooks/queries.ts` — the hooks need to be updated for the new API signatures. Key changes:

- `useTokens` hook: `createToken` mutation now takes `{ nodeId, name, vertical, owner }` instead of `{ project, nodeId }`
- `useTokens` hook: add `assignProject` and `unassignProject` mutations
- `useTokens` hook: `removeNode` takes `{ nodeId }` (since node is now globally unique)
- Add `usePublicProjects` hook (no auth needed)
- Add `useRegister` hook (no auth needed)

Write the updated hooks (this is a full rewrite of queries.ts — too large to inline here but follows the same React Query pattern as the existing file, adapting to new API function signatures).

- [ ] **Step 3: Commit**

```bash
git add packages/admin/src/lib/api.ts packages/admin/src/hooks/queries.ts
git commit -m "$(cat <<'EOF'
feat(admin): update API client and hooks for multi-project model

New API functions: registerNode, fetchPublicProjects, assignToken,
unassignToken. Updated TokenInfo type with node metadata and
projects array. New hooks for public registration.
EOF
)"
```

---

## Task 10: Admin UI — DataTable Component

Build the reusable datatable component.

**Files:**
- Create: `packages/admin/src/components/data-table.tsx`

- [ ] **Step 1: Create DataTable component**

Create `packages/admin/src/components/data-table.tsx`:

```tsx
import { useState } from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export interface Column<T> {
  header: string;
  accessor: keyof T | ((row: T) => React.ReactNode);
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyFn: (row: T) => string;
  expandable?: (row: T) => React.ReactNode;
  emptyMessage?: string;
  loading?: boolean;
}

export function DataTable<T>({
  columns, data, keyFn, expandable, emptyMessage = "No data", loading,
}: DataTableProps<T>) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  function toggleExpand(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((col) => (
            <TableHead key={col.header} className={col.className}>
              {col.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row) => {
          const key = keyFn(row);
          const isExpanded = expandedKeys.has(key);
          return (
            <>
              <TableRow
                key={key}
                className={expandable ? "cursor-pointer hover:bg-muted/50" : undefined}
                onClick={expandable ? () => toggleExpand(key) : undefined}
              >
                {columns.map((col) => (
                  <TableCell key={col.header} className={col.className}>
                    {typeof col.accessor === "function"
                      ? col.accessor(row)
                      : (row[col.accessor] as React.ReactNode)}
                  </TableCell>
                ))}
              </TableRow>
              {expandable && isExpanded && (
                <TableRow key={`${key}-expand`}>
                  <TableCell colSpan={columns.length} className="bg-muted/30 p-4">
                    {expandable(row)}
                  </TableCell>
                </TableRow>
              )}
            </>
          );
        })}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/admin/src/components/data-table.tsx
git commit -m "feat(admin): add reusable DataTable component with expandable rows"
```

---

## Task 11: Admin UI — Register Form (Public)

Build the self-registration form for unauthenticated users.

**Files:**
- Create: `packages/admin/src/components/register-form.tsx`

- [ ] **Step 1: Create RegisterForm component**

Create `packages/admin/src/components/register-form.tsx`:

```tsx
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn, slugify } from "@/lib/utils";
import { fetchPublicProjects, registerNode } from "@/lib/api";

export function RegisterForm() {
  const [project, setProject] = useState("");
  const [nodeId, setNodeId] = useState("");
  const [name, setName] = useState("");
  const [vertical, setVertical] = useState("");
  const [owner, setOwner] = useState("");
  const [result, setResult] = useState<{
    type: "success" | "error"; message: string; token?: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: projects = [] } = useQuery({
    queryKey: ["public-projects"],
    queryFn: fetchPublicProjects,
  });

  const mutation = useMutation({
    mutationFn: () =>
      registerNode({
        project,
        nodeId: slugify(nodeId),
        name: name.trim(),
        vertical: vertical.trim(),
        owner: owner.trim(),
      }),
    onSuccess: (data) => {
      setResult({ type: "success", message: "Registered!", token: data.token });
      setNodeId("");
      setName("");
      setVertical("");
      setOwner("");
    },
    onError: (err) => {
      setResult({ type: "error", message: err instanceof Error ? err.message : "Failed" });
    },
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!project || !nodeId.trim() || !name.trim()) return;
    setCopied(false);
    mutation.mutate();
  }

  async function copyToken(token: string) {
    await navigator.clipboard.writeText(token);
    setCopied(true);
  }

  return (
    <section className="mx-auto max-w-lg">
      <div className="mb-6 text-center">
        <h2 className="text-lg font-semibold text-foreground">Register Node</h2>
        <p className="text-sm text-muted-foreground">
          Join a project and get your authentication token
        </p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
            Project
          </label>
          <select
            value={project}
            onChange={(e) => setProject(e.target.value)}
            className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">Select a project</option>
            {projects.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
              Node ID
            </label>
            <Input placeholder="e.g. my-node" value={nodeId} onChange={(e) => setNodeId(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
              Name
            </label>
            <Input placeholder="e.g. My Node" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
              Vertical
            </label>
            <Input placeholder="e.g. dev, design" value={vertical} onChange={(e) => setVertical(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
              Owner
            </label>
            <Input placeholder="e.g. your-name" value={owner} onChange={(e) => setOwner(e.target.value)} />
          </div>
        </div>
        <Button
          type="submit"
          disabled={mutation.isPending || !project || !nodeId.trim() || !name.trim()}
          className="w-full bg-primary text-primary-foreground hover:bg-spice-bright"
        >
          {mutation.isPending ? "Registering..." : "Register"}
        </Button>
      </form>

      {result && (
        <div
          className={cn(
            "mt-4 border-l-2 bg-card p-3 font-mono text-[0.78rem]",
            result.type === "success"
              ? "border-success text-foreground"
              : "border-destructive text-destructive",
          )}
        >
          {result.type === "success" && result.token ? (
            <>
              Your token (copy it now — it won't be shown again):
              <br />
              <span
                className="cursor-pointer text-primary hover:text-spice-bright"
                onClick={() => copyToken(result.token!)}
              >
                {copied ? "copied!" : result.token}
              </span>
            </>
          ) : (
            result.message
          )}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/admin/src/components/register-form.tsx
git commit -m "feat(admin): add public self-registration form component"
```

---

## Task 12: Admin UI — Projects and Nodes Tables

Build the projects datatable with expandable rows and the nodes datatable.

**Files:**
- Create: `packages/admin/src/components/projects-table.tsx`
- Create: `packages/admin/src/components/nodes-table.tsx`

- [ ] **Step 1: Create ProjectsTable component**

Create `packages/admin/src/components/projects-table.tsx` — uses `<DataTable>` with expandable rows showing assigned nodes. Includes "Create Project" button, expand to show nodes with assign/unassign. Uses the hooks from queries.ts.

The component should:
- Show projects datatable with columns: Name, Nodes (count), Created, Actions (delete with AlertDialog)
- Expandable rows show assigned nodes from the tokens list filtered by project
- Include an "Assign Node" dropdown (nodes not yet in this project) and "Unassign" button
- "Create Project" button opens inline form above table

- [ ] **Step 2: Create NodesTable component**

Create `packages/admin/src/components/nodes-table.tsx` — uses `<DataTable>` to show all tokens/nodes. Includes "Create Node" button.

The component should:
- Show nodes datatable with columns: Node ID, Name, Vertical (badge), Owner, Projects, Token (masked + copy), Actions (delete with AlertDialog)
- "Create Node" button opens inline form: nodeId, name, vertical, owner inputs
- Token column shows first 8 chars + "..." with click-to-copy full token

- [ ] **Step 3: Commit**

```bash
git add packages/admin/src/components/projects-table.tsx packages/admin/src/components/nodes-table.tsx
git commit -m "feat(admin): add ProjectsTable and NodesTable datatable components"
```

---

## Task 13: Admin UI — App Layout Rewrite

Wire everything together in App.tsx with two-mode layout.

**Files:**
- Modify: `packages/admin/src/App.tsx`
- Delete or retire: `packages/admin/src/components/project-create-form.tsx`, `packages/admin/src/components/token-create-form.tsx`, `packages/admin/src/components/token-list.tsx`

- [ ] **Step 1: Rewrite App.tsx**

Replace `packages/admin/src/App.tsx` with the two-mode layout:

```tsx
import { useAuth } from "@/hooks/use-auth";
import { AuthGate } from "@/components/auth-gate";
import { MetricsStrip } from "@/components/metrics-strip";
import { ConnectedNodes } from "@/components/connected-nodes";
import { ServerLogs } from "@/components/server-logs";
import { RegisterForm } from "@/components/register-form";
import { ProjectsTable } from "@/components/projects-table";
import { NodesTable } from "@/components/nodes-table";
import { useMetrics, useNodes, useLogs } from "@/hooks/queries";

export default function App() {
  const { adminKey, setAdminKey, isAuthed } = useAuth();
  const metrics = useMetrics(isAuthed);
  const nodes = useNodes(adminKey);
  const logs = useLogs(adminKey);

  return (
    <div className="mx-auto max-w-[960px] px-[clamp(1rem,3vw,2rem)] py-8 font-sans">
      <header className="mb-8 text-center">
        <h1 className="font-sans text-[clamp(1.2rem,3vw,1.6rem)] font-bold tracking-tight text-foreground">
          Spacing Guild Console
        </h1>
        <p className="text-xs text-muted-foreground">inventory network control</p>
      </header>

      <AuthGate adminKey={adminKey} onKeyChange={setAdminKey} isAuthed={isAuthed} />

      {!isAuthed ? (
        /* Public mode: registration only */
        <RegisterForm />
      ) : (
        /* Admin mode: full console */
        <>
          <MetricsStrip metrics={metrics.data} changedFields={metrics.changedFields} />
          <ProjectsTable adminKey={adminKey} />
          <NodesTable adminKey={adminKey} />
          <ConnectedNodes
            nodes={nodes.data ?? []}
            isAuthed={isAuthed}
            onDisconnect={nodes.disconnect}
          />
          <ServerLogs logs={logs.data ?? []} isAuthed={isAuthed} />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Remove old components**

Delete:
- `packages/admin/src/components/project-create-form.tsx`
- `packages/admin/src/components/token-create-form.tsx`
- `packages/admin/src/components/token-list.tsx`

- [ ] **Step 3: Update ConnectedNodes for new ConnectedNode type**

In `packages/admin/src/components/connected-nodes.tsx`, update the table to show `projects` (array) instead of `project` (string). Change the "Project" column to show `node.projects.join(", ")`.

- [ ] **Step 4: Build admin to verify compilation**

Run: `cd packages/admin && pnpm build`
Expected: Build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/admin/src/
git commit -m "$(cat <<'EOF'
feat(admin): two-mode layout with public registration and admin datatables

Unauthenticated users see a registration form. Authenticated admins
see metrics, projects datatable with expandable node rows, nodes
datatable, connected nodes, and server logs.
EOF
)"
```

---

## Task 14: Apply Impeccable Design Polish

Use the impeccable skill to review and polish the admin UI.

**Files:**
- Modify: Various admin components as needed

- [ ] **Step 1: Run impeccable audit**

Invoke the `impeccable:audit` skill on the admin UI to identify design quality issues.

- [ ] **Step 2: Apply fixes**

Apply the impeccable skill recommendations (typography, spacing, color, consistency) to the admin components.

- [ ] **Step 3: Build and verify**

Run: `cd packages/admin && pnpm build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/admin/src/
git commit -m "style(admin): polish UI with impeccable design review"
```

---

## Task 15: Claude Code Status Line

Set up the status line to show node info after successful WS connection.

**Files:**
- Modify: `packages/node/src/channel.ts` (startup sequence)

- [ ] **Step 1: Add status line setup after WS connection**

In `startChannelServer` in `channel.ts`, after the WSClient successfully connects (after line 618 `await wsClient.connect()`), add status line output:

```typescript
try {
  await wsClient.connect();

  // Fetch online count for status line
  const httpUrl = config.server.url
    .replace(/^ws/, "http")
    .replace(/\/ws$/, "/api/online");
  const onlineRes = await fetch(`${httpUrl}?token=${config.server.token}`);
  let onlineCount = 0;
  if (onlineRes.ok) {
    const onlineData = await onlineRes.json() as {
      projects: { nodes: unknown[] }[];
    };
    const nodeIds = new Set<string>();
    for (const proj of onlineData.projects) {
      for (const n of proj.nodes as { nodeId: string }[]) {
        nodeIds.add(n.nodeId);
      }
    }
    onlineCount = nodeIds.size;
  }

  // Write Claude Code status line config
  const statusText = `inv: ${config.node.name} (${config.node.vertical}) · ${config.node.projects[0] ?? "no project"} · ${onlineCount} online`;
  const homedir = process.env.HOME || process.env.USERPROFILE || "~";
  const settingsPath = `${homedir}/.claude/settings.json`;
  try {
    const existingRaw = existsSync(settingsPath)
      ? JSON.parse(readFileSync(settingsPath, "utf-8"))
      : {};
    existingRaw.statusline = statusText;
    writeFileSync(settingsPath, JSON.stringify(existingRaw, null, 2) + "\n");
  } catch {
    // Non-fatal — status line is best-effort
  }
} catch {
  wsClient = null;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/node/src/channel.ts
git commit -m "$(cat <<'EOF'
feat(node): set Claude Code status line on successful WS connection

Shows: node name, vertical, primary project, online peer count.
Only activates after WS connects and token verifies.
EOF
)"
```

---

## Task 16: Update Remaining Tests

Fix any remaining test files that reference the old `Vertical` enum, `UPSTREAM_VERTICALS`, or `node.project` (singular).

**Files:**
- Modify: `packages/node/test/engine.test.ts`
- Modify: `packages/node/test/store.test.ts`
- Modify: `packages/node/test/scenarios-vote-challenge.test.ts`
- Modify: `packages/node/test/scenarios.test.ts`
- Modify: `packages/node/test/e2e-multinode.test.ts`
- Modify: `packages/node/test/channel.test.ts`
- Modify: `packages/shared/src/types.test.ts`

- [ ] **Step 1: Search and fix Vertical references in tests**

Run: `grep -rn "as Vertical\|: Vertical\|UPSTREAM_VERTICALS" packages/node/test/ packages/shared/src/types.test.ts`

For each match:
- Remove `as Vertical` casts (unnecessary since `Vertical` is now `string`)
- Remove any `UPSTREAM_VERTICALS` imports and tests
- Change `project: "..."` to `projects: ["..."]` in test fixtures where config objects are constructed

- [ ] **Step 2: Run full test suite**

Run: `bun test`
Expected: All tests pass (or document specific test failures that need further fixes).

- [ ] **Step 3: Commit**

```bash
git add packages/node/test/ packages/shared/src/types.test.ts
git commit -m "test: update tests for free-form verticals and multi-project config"
```

---

## Task 17: Full Build Verification

Run builds for all packages to ensure everything compiles.

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 2: Build node package**

Run: `bun run build:node`
Expected: Build succeeds.

- [ ] **Step 3: Build admin package**

Run: `bun run build:admin`
Expected: Build succeeds.

- [ ] **Step 4: Commit any final fixes**

If any build issues are found, fix them and commit.
