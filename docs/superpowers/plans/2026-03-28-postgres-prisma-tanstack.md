# Postgres/Prisma/TanStack Query Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Redis-backed auth with Postgres via Prisma repositories, add TanStack Query to admin frontend.

**Architecture:** Server gets a repository layer (`ProjectRepository`, `TokenRepository`) backed by Prisma/Postgres. Redis stays for hub/outbox only. Admin hooks migrate from manual useState/useEffect/setInterval to TanStack Query.

**Tech Stack:** Prisma (ORM + migrations), PostgreSQL 17, TanStack Query v5, Bun runtime

**Spec:** `docs/superpowers/specs/2026-03-28-postgres-prisma-tanstack-design.md`

---

## File Map

### Created
- `packages/server/prisma/schema.prisma` — Prisma schema with Project + Token models
- `packages/server/src/prisma.ts` — PrismaClient singleton
- `packages/server/src/repositories/project.repository.ts` — Project CRUD
- `packages/server/src/repositories/token.repository.ts` — Token CRUD + validation
- `packages/server/src/repositories/index.ts` — Re-exports + factory
- `packages/server/test/repositories.test.ts` — Repository tests against real Postgres
- `packages/admin/src/lib/query-client.ts` — QueryClient instance
- `packages/admin/src/hooks/queries.ts` — All TanStack Query hooks

### Modified
- `packages/server/package.json` — Add `prisma` + `@prisma/client` deps
- `packages/server/src/index.ts` — Replace RedisAuth with repositories, update CLI
- `packages/server/Dockerfile` — Add Prisma generate + migrate steps
- `packages/admin/package.json` — Add `@tanstack/react-query`
- `packages/admin/src/main.tsx` — Wrap with QueryClientProvider
- `packages/admin/src/App.tsx` — Use new hooks from queries.ts
- `docker-compose.yml` — Add Postgres service, add DATABASE_URL

### Removed
- `packages/server/src/auth.ts` — Replaced by repositories
- `packages/admin/src/hooks/use-metrics.ts` — Replaced by queries.ts
- `packages/admin/src/hooks/use-logs.ts` — Replaced by queries.ts
- `packages/admin/src/hooks/use-nodes.ts` — Replaced by queries.ts
- `packages/admin/src/hooks/use-tokens.ts` — Replaced by queries.ts
- `packages/admin/src/hooks/use-projects.ts` — Replaced by queries.ts

---

## Task 1: Prisma Schema + Generate

**Files:**
- Create: `packages/server/prisma/schema.prisma`
- Modify: `packages/server/package.json`

- [ ] **Step 1: Add Prisma dependencies**

```bash
cd packages/server && bun add prisma @prisma/client
```

- [ ] **Step 2: Create Prisma schema**

Create `packages/server/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Project {
  id        String   @id @default(uuid())
  name      String   @unique
  createdAt DateTime @default(now()) @map("created_at")
  tokens    Token[]

  @@map("projects")
}

model Token {
  id        String   @id @default(uuid())
  projectId String   @map("project_id")
  nodeId    String   @map("node_id")
  secret    String   @unique @default(uuid())
  createdAt DateTime @default(now()) @map("created_at")
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, nodeId])
  @@map("tokens")
}
```

- [ ] **Step 3: Generate Prisma client**

```bash
cd packages/server && bunx prisma generate
```

Expected: `@prisma/client` generated successfully.

- [ ] **Step 4: Create initial migration**

Start a local Postgres first (or use docker-compose — see Task 7). Then:

```bash
cd packages/server && DATABASE_URL="postgresql://inv:inv@localhost:5432/inv" bunx prisma migrate dev --name init
```

Expected: Migration file created in `packages/server/prisma/migrations/`.

- [ ] **Step 5: Commit**

```bash
git add packages/server/prisma packages/server/package.json packages/server/bun.lockb
git commit -m "feat(server): add Prisma schema with Project and Token models"
```

---

## Task 2: PrismaClient Singleton

**Files:**
- Create: `packages/server/src/prisma.ts`

- [ ] **Step 1: Create PrismaClient singleton**

Create `packages/server/src/prisma.ts`:

```typescript
import { PrismaClient } from "@prisma/client";

let prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/prisma.ts
git commit -m "feat(server): add PrismaClient singleton"
```

---

## Task 3: ProjectRepository

**Files:**
- Create: `packages/server/src/repositories/project.repository.ts`
- Test: `packages/server/test/repositories.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/repositories.test.ts`:

```typescript
import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { PrismaClient } from "@prisma/client";
import { ProjectRepository } from "../src/repositories/project.repository";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://inv:inv@localhost:5432/inv_test";

let prisma: PrismaClient;
let repo: ProjectRepository;
let dbAvailable = false;

beforeAll(async () => {
  try {
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    await prisma.$connect();
    dbAvailable = true;
  } catch {
    console.warn("Postgres not available — skipping repository tests");
  }
});

afterAll(async () => {
  if (dbAvailable) await prisma.$disconnect();
});

describe("ProjectRepository", () => {
  beforeEach(async () => {
    if (!dbAvailable) return;
    await prisma.token.deleteMany();
    await prisma.project.deleteMany();
    repo = new ProjectRepository(prisma);
  });

  test("create and list projects", async () => {
    if (!dbAvailable) return;

    const project = await repo.create("my-project");
    expect(project.name).toBe("my-project");
    expect(project.id).toBeTruthy();

    const all = await repo.list();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("my-project");
  });

  test("create duplicate project throws", async () => {
    if (!dbAvailable) return;

    await repo.create("dup");
    await expect(repo.create("dup")).rejects.toThrow();
  });

  test("exists returns correct value", async () => {
    if (!dbAvailable) return;

    expect(await repo.exists("nope")).toBe(false);
    await repo.create("yes");
    expect(await repo.exists("yes")).toBe(true);
  });

  test("remove deletes project", async () => {
    if (!dbAvailable) return;

    const project = await repo.create("to-remove");
    await repo.remove(project.id);
    expect(await repo.exists("to-remove")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server && DATABASE_URL="postgresql://inv:inv@localhost:5432/inv_test" bun test test/repositories.test.ts
```

Expected: FAIL — `ProjectRepository` module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/server/src/repositories/project.repository.ts`:

```typescript
import type { PrismaClient, Project } from "@prisma/client";

export class ProjectRepository {
  constructor(private prisma: PrismaClient) {}

  async create(name: string): Promise<Project> {
    return this.prisma.project.create({ data: { name } });
  }

  async exists(name: string): Promise<boolean> {
    const count = await this.prisma.project.count({ where: { name } });
    return count > 0;
  }

  async list(): Promise<Project[]> {
    return this.prisma.project.findMany({ orderBy: { name: "asc" } });
  }

  async remove(id: string): Promise<void> {
    await this.prisma.project.delete({ where: { id } });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server && DATABASE_URL="postgresql://inv:inv@localhost:5432/inv_test" bun test test/repositories.test.ts
```

Expected: All ProjectRepository tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/repositories/project.repository.ts packages/server/test/repositories.test.ts
git commit -m "feat(server): add ProjectRepository with Prisma"
```

---

## Task 4: TokenRepository

**Files:**
- Create: `packages/server/src/repositories/token.repository.ts`
- Modify: `packages/server/test/repositories.test.ts`

- [ ] **Step 1: Add token tests to test file**

Append to `packages/server/test/repositories.test.ts`:

```typescript
import { TokenRepository } from "../src/repositories/token.repository";

describe("TokenRepository", () => {
  let projectRepo: ProjectRepository;
  let tokenRepo: TokenRepository;
  let projectId: string;

  beforeEach(async () => {
    if (!dbAvailable) return;
    await prisma.token.deleteMany();
    await prisma.project.deleteMany();
    projectRepo = new ProjectRepository(prisma);
    tokenRepo = new TokenRepository(prisma);
    const project = await projectRepo.create("test-project");
    projectId = project.id;
  });

  test("create token and validate by secret", async () => {
    if (!dbAvailable) return;

    const token = await tokenRepo.create(projectId, "dev");
    expect(token.secret).toBeTruthy();
    expect(token.nodeId).toBe("dev");

    const info = await tokenRepo.validate(token.secret);
    expect(info).not.toBeNull();
    expect(info!.nodeId).toBe("dev");
    expect(info!.projectId).toBe(projectId);
  });

  test("validate returns null for invalid secret", async () => {
    if (!dbAvailable) return;

    const info = await tokenRepo.validate("nonexistent");
    expect(info).toBeNull();
  });

  test("create duplicate node in same project throws", async () => {
    if (!dbAvailable) return;

    await tokenRepo.create(projectId, "dev");
    await expect(tokenRepo.create(projectId, "dev")).rejects.toThrow();
  });

  test("nodeExists returns correct value", async () => {
    if (!dbAvailable) return;

    expect(await tokenRepo.nodeExists(projectId, "dev")).toBe(false);
    await tokenRepo.create(projectId, "dev");
    expect(await tokenRepo.nodeExists(projectId, "dev")).toBe(true);
  });

  test("revokeByNode removes tokens for a node", async () => {
    if (!dbAvailable) return;

    await tokenRepo.create(projectId, "dev");
    await tokenRepo.create(projectId, "pm");

    const revoked = await tokenRepo.revokeByNode(projectId, "dev");
    expect(revoked).toBe(1);

    const remaining = await tokenRepo.listByProject(projectId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].nodeId).toBe("pm");
  });

  test("revokeByProject removes all tokens in project", async () => {
    if (!dbAvailable) return;

    await tokenRepo.create(projectId, "dev");
    await tokenRepo.create(projectId, "pm");

    const revoked = await tokenRepo.revokeByProject(projectId);
    expect(revoked).toBe(2);

    const remaining = await tokenRepo.listAll();
    expect(remaining).toHaveLength(0);
  });

  test("listAll returns all tokens across projects", async () => {
    if (!dbAvailable) return;

    const p2 = await projectRepo.create("project-2");
    await tokenRepo.create(projectId, "dev");
    await tokenRepo.create(p2.id, "qa");

    const all = await tokenRepo.listAll();
    expect(all).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server && DATABASE_URL="postgresql://inv:inv@localhost:5432/inv_test" bun test test/repositories.test.ts
```

Expected: FAIL — `TokenRepository` module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/server/src/repositories/token.repository.ts`:

```typescript
import type { PrismaClient, Token } from "@prisma/client";

export interface TokenInfo {
  projectId: string;
  nodeId: string;
  createdAt: string;
}

export class TokenRepository {
  constructor(private prisma: PrismaClient) {}

  async create(projectId: string, nodeId: string): Promise<Token> {
    return this.prisma.token.create({
      data: { projectId, nodeId },
    });
  }

  async validate(secret: string): Promise<{ projectId: string; nodeId: string } | null> {
    const token = await this.prisma.token.findUnique({
      where: { secret },
      select: { projectId: true, nodeId: true },
    });
    return token;
  }

  async revoke(secret: string): Promise<void> {
    await this.prisma.token.deleteMany({ where: { secret } });
  }

  async revokeByNode(projectId: string, nodeId: string): Promise<number> {
    const result = await this.prisma.token.deleteMany({
      where: { projectId, nodeId },
    });
    return result.count;
  }

  async revokeByProject(projectId: string): Promise<number> {
    const result = await this.prisma.token.deleteMany({
      where: { projectId },
    });
    return result.count;
  }

  async nodeExists(projectId: string, nodeId: string): Promise<boolean> {
    const count = await this.prisma.token.count({
      where: { projectId, nodeId },
    });
    return count > 0;
  }

  async listAll(): Promise<TokenInfo[]> {
    const tokens = await this.prisma.token.findMany({
      select: { projectId: true, nodeId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    return tokens.map((t) => ({
      projectId: t.projectId,
      nodeId: t.nodeId,
      createdAt: t.createdAt.toISOString(),
    }));
  }

  async listByProject(projectId: string): Promise<TokenInfo[]> {
    const tokens = await this.prisma.token.findMany({
      where: { projectId },
      select: { projectId: true, nodeId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    return tokens.map((t) => ({
      projectId: t.projectId,
      nodeId: t.nodeId,
      createdAt: t.createdAt.toISOString(),
    }));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server && DATABASE_URL="postgresql://inv:inv@localhost:5432/inv_test" bun test test/repositories.test.ts
```

Expected: All repository tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/repositories/token.repository.ts packages/server/test/repositories.test.ts
git commit -m "feat(server): add TokenRepository with Prisma"
```

---

## Task 5: Repository Index + Factory

**Files:**
- Create: `packages/server/src/repositories/index.ts`

- [ ] **Step 1: Create the factory module**

Create `packages/server/src/repositories/index.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";
import { ProjectRepository } from "./project.repository";
import { TokenRepository } from "./token.repository";

export { ProjectRepository } from "./project.repository";
export { TokenRepository } from "./token.repository";
export type { TokenInfo } from "./token.repository";

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

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/repositories/index.ts
git commit -m "feat(server): add repository factory"
```

---

## Task 6: Replace RedisAuth in Server

**Files:**
- Modify: `packages/server/src/index.ts`
- Remove: `packages/server/src/auth.ts`

This is the largest task. It replaces all `auth.*` calls with `repos.*` calls in the server entry point and CLI.

- [ ] **Step 1: Update imports in index.ts**

Replace the import section at the top of `packages/server/src/index.ts`. Remove `RedisAuth` imports and add Prisma + repositories:

```typescript
// Remove these lines:
import { RedisAuth } from "./auth";
export { RedisAuth } from "./auth";
export type { TokenInfo } from "./auth";

// Add these lines:
import { getPrisma, disconnectPrisma } from "./prisma";
import { createRepositories, type Repositories } from "./repositories";
export { createRepositories } from "./repositories";
export type { TokenInfo } from "./repositories";
```

- [ ] **Step 2: Update startServer function signature and initialization**

Change the `startServer` function signature to accept `databaseUrl`:

```typescript
export function startServer(options: { port: number; redisUrl: string; databaseUrl?: string }): void {
```

Replace the auth initialization (lines 44-45) with Prisma:

```typescript
// Remove:
const redis = new Redis(options.redisUrl);
const auth = new RedisAuth(redis);

// Replace with:
const prisma = getPrisma();
const repos = createRepositories(prisma);
const redis = new Redis(options.redisUrl);
```

- [ ] **Step 3: Replace all auth calls in API handlers**

In the `fetch` handler, replace every `auth.*` call. Each replacement is mechanical:

`POST /api/project/create`:
```typescript
// Before: const created = await auth.createProject(body.project);
// After:
const exists = await repos.projects.exists(body.project);
if (exists) {
  return Response.json({ error: `Project "${body.project}" already exists` }, { status: 409 });
}
const project = await repos.projects.create(body.project);
return Response.json({ project: body.project, created: true });
```

`GET /api/project/list`:
```typescript
// Before: const projects = await auth.listProjects();
const projects = await repos.projects.list();
return Response.json({ projects: projects.map((p) => p.name) });
```

`POST /api/token/create`:
```typescript
// Before: if (!(await auth.projectExists(body.project)))
const projectExists = await repos.projects.exists(body.project);
if (!projectExists) {
  return Response.json({ error: `Project "${body.project}" does not exist.` }, { status: 400 });
}
// Before: if (await auth.nodeExists(body.project, body.nodeId))
// Need to resolve project name → id first
const projectRecord = (await repos.projects.list()).find((p) => p.name === body.project);
if (!projectRecord) {
  return Response.json({ error: `Project "${body.project}" does not exist.` }, { status: 400 });
}
if (await repos.tokens.nodeExists(projectRecord.id, body.nodeId)) {
  return Response.json({ error: `Node "${body.nodeId}" already exists in project "${body.project}"` }, { status: 409 });
}
const token = await repos.tokens.create(projectRecord.id, body.nodeId);
return Response.json({ token: token.secret, project: body.project, nodeId: body.nodeId });
```

`GET /api/token/list`:
```typescript
const tokens = await repos.tokens.listAll();
return Response.json({ tokens });
```

`POST /api/token/revoke`:
```typescript
await repos.tokens.revoke(body.token);
return Response.json({ revoked: true });
```

`DELETE /api/project/:id` — resolve project name to id:
```typescript
const project = (await repos.projects.list()).find((p) => p.name === projectId);
if (!project) {
  return Response.json({ error: "Project not found" }, { status: 404 });
}
const disconnected = await hub.disconnectProject(project.id);
const revoked = await repos.tokens.revokeByProject(project.id);
await repos.projects.remove(project.id);
```

`DELETE /api/node/:proj/:node` — resolve project name:
```typescript
const project = (await repos.projects.list()).find((p) => p.name === projectId);
if (!project) {
  return Response.json({ error: "Project not found" }, { status: 404 });
}
const disconnected = await hub.disconnect(project.id, nodeId);
const revoked = await repos.tokens.revokeByNode(project.id, nodeId);
```

WS upgrade `validateToken`:
```typescript
// Before: const info = await auth.validateToken(token);
const info = await repos.tokens.validate(token);
```

`GET /api/online`:
```typescript
// Before: const info = await auth.validateToken(token);
const info = await repos.tokens.validate(token);
```

- [ ] **Step 4: Update CLI commands**

Replace the CLI section. Each command now uses Prisma instead of Redis for token operations.

Update `parseArgs` to accept `--database-url`:

```typescript
function parseArgs(args: string[]): { port: number; redisUrl: string; databaseUrl: string } {
  let port = 4400;
  let redisUrl = "redis://127.0.0.1:6379";
  let databaseUrl = process.env.DATABASE_URL || "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--redis" && args[i + 1]) {
      redisUrl = args[i + 1];
      i++;
    } else if (args[i] === "--database-url" && args[i + 1]) {
      databaseUrl = args[i + 1];
      i++;
    }
  }

  return { port, redisUrl, databaseUrl };
}
```

Replace `tokenCreate`, `tokenList`, `tokenRevoke` to use Prisma:

```typescript
async function tokenCreate(args: string[]): Promise<void> {
  let project = "";
  let nodeId = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--project" && args[i + 1]) {
      project = args[i + 1]; i++;
    } else if (args[i] === "--node" && args[i + 1]) {
      nodeId = args[i + 1]; i++;
    }
  }

  if (!project || !nodeId) {
    console.error("Usage: token create --project <project> --node <nodeId>");
    process.exit(1);
  }

  const prisma = getPrisma();
  const repos = createRepositories(prisma);
  try {
    let projectRecord = (await repos.projects.list()).find((p) => p.name === project);
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
      project = args[i + 1]; i++;
    }
  }

  if (!project) {
    console.error("Usage: token list --project <project>");
    process.exit(1);
  }

  const prisma = getPrisma();
  const repos = createRepositories(prisma);
  try {
    const projectRecord = (await repos.projects.list()).find((p) => p.name === project);
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
      token = args[i]; break;
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
```

- [ ] **Step 5: Add graceful Prisma shutdown**

In the `SIGINT`/`SIGTERM` handlers, add:

```typescript
process.on("SIGINT", async () => {
  await hub.shutdown();
  await disconnectPrisma();
  redis.disconnect();
  server.stop();
  process.exit(0);
});
```

- [ ] **Step 6: Delete auth.ts**

```bash
rm packages/server/src/auth.ts
```

- [ ] **Step 7: Run existing hub/outbox tests to verify nothing broke**

```bash
bun test packages/server
```

Expected: RedisHub and RedisOutbox tests still PASS. Old RedisAuth tests FAIL (expected — we'll fix in next task).

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/index.ts packages/server/src/prisma.ts packages/server/src/repositories/
git rm packages/server/src/auth.ts
git commit -m "feat(server): replace RedisAuth with Prisma repositories"
```

---

## Task 7: Update Server Tests

**Files:**
- Modify: `packages/server/test/server.test.ts`

- [ ] **Step 1: Remove RedisAuth tests from server.test.ts**

Delete the entire `describe("RedisAuth", ...)` block (lines 33-151) from `packages/server/test/server.test.ts`. The repository tests in `test/repositories.test.ts` replace them.

Also remove the `RedisAuth` import at the top.

- [ ] **Step 2: Run tests**

```bash
bun test packages/server
```

Expected: All remaining tests (RedisOutbox, RedisHub) PASS. Repository tests PASS if Postgres is available.

- [ ] **Step 3: Commit**

```bash
git add packages/server/test/server.test.ts
git commit -m "test(server): remove RedisAuth tests, replaced by repository tests"
```

---

## Task 8: Update Docker Compose + Dockerfile

**Files:**
- Modify: `docker-compose.yml`
- Modify: `packages/server/Dockerfile`

- [ ] **Step 1: Update docker-compose.yml**

Replace the entire `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: inv
      POSTGRES_PASSWORD: inv
      POSTGRES_DB: inv
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  server:
    build:
      context: .
      dockerfile: packages/server/Dockerfile
    ports:
      - "4400:4400"
    environment:
      DATABASE_URL: postgresql://inv:inv@postgres:5432/inv
      REDIS_URL: redis://redis:6379
      ADMIN_KEY: ${ADMIN_KEY}
    depends_on:
      - postgres
      - redis

volumes:
  pgdata:
```

- [ ] **Step 2: Update Dockerfile**

Add Prisma generate and migrate steps to `packages/server/Dockerfile`. In the server runtime stage, after copying packages and before `bun install`:

```dockerfile
# Copy Prisma schema
COPY packages/server/prisma ./packages/server/prisma
```

After `bun install`, add:

```dockerfile
# Generate Prisma client
RUN cd packages/server && bunx prisma generate
```

Update the CMD to run migrations before starting:

```dockerfile
CMD sh -c "cd packages/server && bunx prisma migrate deploy && cd /app && bun run packages/server/src/index.ts start --port 4400 --redis redis://redis:6379"
```

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml packages/server/Dockerfile
git commit -m "infra: add Postgres to docker-compose, update Dockerfile for Prisma"
```

---

## Task 9: TanStack Query Setup in Admin

**Files:**
- Modify: `packages/admin/package.json`
- Create: `packages/admin/src/lib/query-client.ts`
- Modify: `packages/admin/src/main.tsx`

- [ ] **Step 1: Install TanStack Query**

```bash
cd packages/admin && pnpm add @tanstack/react-query
```

- [ ] **Step 2: Create QueryClient**

Create `packages/admin/src/lib/query-client.ts`:

```typescript
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
```

- [ ] **Step 3: Wrap App with QueryClientProvider**

Update `packages/admin/src/main.tsx`:

```typescript
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import "./index.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 4: Build to verify no errors**

```bash
cd packages/admin && pnpm build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/admin/package.json packages/admin/pnpm-lock.yaml packages/admin/src/lib/query-client.ts packages/admin/src/main.tsx
git commit -m "feat(admin): add TanStack Query with QueryClientProvider"
```

---

## Task 10: Migrate Admin Hooks to TanStack Query

**Files:**
- Create: `packages/admin/src/hooks/queries.ts`
- Modify: `packages/admin/src/App.tsx`
- Remove: `packages/admin/src/hooks/use-metrics.ts`
- Remove: `packages/admin/src/hooks/use-logs.ts`
- Remove: `packages/admin/src/hooks/use-nodes.ts`
- Remove: `packages/admin/src/hooks/use-tokens.ts`
- Remove: `packages/admin/src/hooks/use-projects.ts`

- [ ] **Step 1: Create all TanStack Query hooks**

Create `packages/admin/src/hooks/queries.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchMetrics,
  fetchNodes,
  fetchLogs,
  listAllTokens,
  listProjects,
  createProject,
  createToken,
  removeNode,
  removeProject,
  disconnectNode,
  type TokenInfo,
  type ConnectedNode,
  type Metrics,
  type LogEntry,
} from "@/lib/api";

// ── Projects ──────────────────────────────────────────────

export function useProjects(adminKey: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["projects"],
    queryFn: () => listProjects(adminKey),
    enabled: !!adminKey,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => createProject(adminKey, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  return {
    projects: query.data ?? [],
    create: createMutation.mutateAsync,
    createResult: createMutation.isSuccess
      ? { type: "success" as const, message: `Project created` }
      : createMutation.isError
        ? { type: "error" as const, message: createMutation.error?.message ?? "Failed" }
        : null,
  };
}

// ── Tokens ────────────────────────────────────────────────

export function useTokens(adminKey: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["tokens"],
    queryFn: () => listAllTokens(adminKey),
    enabled: !!adminKey,
  });

  const createMutation = useMutation({
    mutationFn: ({ project, nodeId }: { project: string; nodeId: string }) =>
      createToken(adminKey, project, nodeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tokens"] });
    },
  });

  const removeNodeMutation = useMutation({
    mutationFn: ({ projectId, nodeId }: { projectId: string; nodeId: string }) =>
      removeNode(adminKey, projectId, nodeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tokens"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const removeProjectMutation = useMutation({
    mutationFn: (projectId: string) => removeProject(adminKey, projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tokens"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  return {
    tokens: query.data ?? [],
    loading: query.isLoading,
    createResult: createMutation.isSuccess
      ? {
          type: "success" as const,
          message: `Token created`,
          token: (createMutation.data as { token?: string })?.token,
          nodeId: (createMutation.data as { nodeId?: string })?.nodeId,
        }
      : createMutation.isError
        ? { type: "error" as const, message: createMutation.error?.message ?? "Failed" }
        : null,
    create: async (project: string, nodeId: string) => {
      await createMutation.mutateAsync({ project, nodeId });
    },
    removeNode: async (projectId: string, nodeId: string) => {
      await removeNodeMutation.mutateAsync({ projectId, nodeId });
    },
    removeProject: async (projectId: string) => {
      await removeProjectMutation.mutateAsync(projectId);
    },
  };
}

// ── Connected Nodes ───────────────────────────────────────

export function useNodes(adminKey: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["nodes"],
    queryFn: () => fetchNodes(adminKey),
    enabled: !!adminKey,
    refetchInterval: 5000,
  });

  const disconnectMutation = useMutation({
    mutationFn: ({ projectId, nodeId }: { projectId: string; nodeId: string }) =>
      disconnectNode(adminKey, projectId, nodeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nodes"] });
    },
  });

  return {
    nodes: query.data ?? [],
    disconnect: async (projectId: string, nodeId: string) => {
      await disconnectMutation.mutateAsync({ projectId, nodeId });
    },
  };
}

// ── Metrics ───────────────────────────────────────────────

export function useMetrics() {
  const query = useQuery({
    queryKey: ["metrics"],
    queryFn: fetchMetrics,
    refetchInterval: 3000,
  });

  return {
    metrics: query.data ?? null,
    changed: new Set<string>(), // simplified — MetricsStrip can diff internally if needed
  };
}

// ── Logs ──────────────────────────────────────────────────

export function useLogs(adminKey: string) {
  const query = useQuery({
    queryKey: ["logs"],
    queryFn: () => fetchLogs(adminKey),
    enabled: !!adminKey,
    refetchInterval: 3000,
  });

  return {
    logs: query.data ?? [],
  };
}
```

- [ ] **Step 2: Update App.tsx to use new hooks**

Replace `packages/admin/src/App.tsx`:

```typescript
import { useAuth } from "@/hooks/use-auth";
import { useMetrics, useProjects, useTokens, useNodes, useLogs } from "@/hooks/queries";
import { AuthGate } from "@/components/auth-gate";
import { MetricsStrip } from "@/components/metrics-strip";
import { ProjectCreateForm } from "@/components/project-create-form";
import { TokenCreateForm } from "@/components/token-create-form";
import { TokenList } from "@/components/token-list";
import { ConnectedNodes } from "@/components/connected-nodes";
import { ServerLogs } from "@/components/server-logs";

export default function App() {
  const { adminKey, setAdminKey, isAuthed } = useAuth();
  const { metrics, changed } = useMetrics();
  const { projects, create: createProject, createResult: projectCreateResult } = useProjects(adminKey);
  const {
    tokens,
    loading,
    createResult,
    create,
    removeNode: removeNodeFn,
    removeProject: removeProjectFn,
  } = useTokens(adminKey);
  const { nodes, disconnect } = useNodes(adminKey);
  const { logs } = useLogs(adminKey);

  return (
    <div className="mx-auto max-w-[860px] px-[clamp(1rem,3vw,2rem)] py-[clamp(2rem,5vw,4rem)]">
      <header className="mb-12">
        <div className="mb-2 text-[0.7rem] font-medium uppercase tracking-[0.25em] text-spice-dim">
          Spacing Guild Console
        </div>
        <h1 className="text-[clamp(1.6rem,4vw,2.2rem)] font-bold leading-tight tracking-tight">
          inv-server <span className="text-primary">command post</span>
        </h1>
        <div className="mt-1 text-sm text-muted-foreground">
          Token management and signal monitoring
        </div>
      </header>

      <AuthGate
        adminKey={adminKey}
        onKeyChange={setAdminKey}
        isAuthed={isAuthed}
      />

      <MetricsStrip metrics={metrics} changed={changed} />

      <ProjectCreateForm
        disabled={!isAuthed}
        onSubmit={createProject}
        result={projectCreateResult}
      />

      <TokenCreateForm
        disabled={!isAuthed}
        projects={projects}
        onSubmit={create}
        result={createResult}
      />

      <TokenList
        disabled={!isAuthed}
        tokens={tokens}
        loading={loading}
        onRemoveNode={removeNodeFn}
        onRemoveProject={removeProjectFn}
      />

      <ConnectedNodes nodes={nodes} disabled={!isAuthed} onDisconnect={disconnect} />

      <ServerLogs logs={logs} disabled={!isAuthed} />
    </div>
  );
}
```

- [ ] **Step 3: Delete old hook files**

```bash
rm packages/admin/src/hooks/use-metrics.ts
rm packages/admin/src/hooks/use-logs.ts
rm packages/admin/src/hooks/use-nodes.ts
rm packages/admin/src/hooks/use-tokens.ts
rm packages/admin/src/hooks/use-projects.ts
```

- [ ] **Step 4: Build to verify**

```bash
cd packages/admin && pnpm build
```

Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/admin/src/hooks/queries.ts packages/admin/src/App.tsx
git rm packages/admin/src/hooks/use-metrics.ts packages/admin/src/hooks/use-logs.ts packages/admin/src/hooks/use-nodes.ts packages/admin/src/hooks/use-tokens.ts packages/admin/src/hooks/use-projects.ts
git commit -m "feat(admin): migrate all hooks to TanStack Query"
```

---

## Task 11: Update Exports and Verify Full Build

**Files:**
- Modify: `packages/server/src/index.ts` (exports)

- [ ] **Step 1: Clean up server exports**

Verify `packages/server/src/index.ts` no longer references `RedisAuth` in any export. The exports should be:

```typescript
export { RedisOutbox } from "./outbox";
export { RedisHub } from "./hub";
export { createRepositories } from "./repositories";
export type { TokenInfo } from "./repositories";
export type { HubWebSocket } from "./hub";
export type { ConnectedNode } from "./hub";
```

- [ ] **Step 2: Run all tests**

```bash
bun test packages/node
bun test packages/server
```

Expected: Node tests all PASS (unchanged). Server tests PASS (hub/outbox + repositories).

- [ ] **Step 3: Build admin**

```bash
bun run build:admin
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "chore: clean up server exports after RedisAuth removal"
```

---

## Task 12: End-to-End Smoke Test

- [ ] **Step 1: Start infra**

```bash
docker-compose up -d postgres redis
```

- [ ] **Step 2: Run Prisma migrations**

```bash
cd packages/server && DATABASE_URL="postgresql://inv:inv@localhost:5432/inv" bunx prisma migrate deploy
```

- [ ] **Step 3: Start server**

```bash
DATABASE_URL="postgresql://inv:inv@localhost:5432/inv" ADMIN_KEY=test bun run packages/server/src/index.ts start --port 4400 --redis redis://localhost:6379
```

- [ ] **Step 4: Test project + token flow via CLI**

```bash
DATABASE_URL="postgresql://inv:inv@localhost:5432/inv" bun run packages/server/src/index.ts token create --project smoke-test --node dev
```

Expected: Prints a UUID token.

- [ ] **Step 5: Test admin UI**

Open `http://localhost:4400/admin`, enter admin key `test`, verify:
- Create project works
- Create token (select project from dropdown) works
- Token list shows the token
- Remove node/project works

- [ ] **Step 6: Test node connection**

Use the token from step 4 to connect a node and verify WS works.

- [ ] **Step 7: Commit any final fixes**

```bash
git add -A && git commit -m "chore: final adjustments from smoke test"
```
