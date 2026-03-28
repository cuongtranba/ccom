# Design: Repository Layer, Postgres via Prisma, TanStack Query

**Date:** 2026-03-28
**Status:** Approved
**Scope:** packages/server, packages/admin

## Summary

Migrate the server's persistent data (projects, tokens, node registry) from Redis hashes/sets to PostgreSQL via Prisma. Introduce a repository layer for clean data access. Replace the admin frontend's custom polling hooks with TanStack Query. Node and dashboard packages are unchanged.

## What Changes

| Package | Before | After |
|---------|--------|-------|
| `packages/server` | `RedisAuth` manages projects/tokens/nodes via Redis hashes/sets | Prisma repositories (`ProjectRepository`, `TokenRepository`) backed by Postgres |
| `packages/server` | `RedisHub` + `RedisOutbox` on Redis | Unchanged — Redis stays for presence, pub/sub, outbox |
| `packages/admin` | Custom `useState`/`useEffect` hooks with manual polling | TanStack Query with `useQuery`/`useMutation` |
| `packages/node` | Local SQLite via `bun:sqlite` | Unchanged |
| `packages/dashboard` | Astro SSR reading local SQLite | Unchanged |

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                 ADMIN SPA (React + TanStack Query)       │
│  useQuery(['projects']) / useMutation(createProject)     │
└─────────────────────────┬────────────────────────────────┘
                          │ HTTP REST
                          ▼
┌──────────────────────────────────────────────────────────┐
│                    SERVER (Bun)                           │
│                                                          │
│  ┌─────────────────────────────────────────────────┐     │
│  │           Repository Layer                       │     │
│  │  ProjectRepository  ─┐                           │     │
│  │  TokenRepository    ─┼── Prisma Client ── Postgres│    │
│  │  NodeRepository     ─┘                           │     │
│  └─────────────────────────────────────────────────┘     │
│                                                          │
│  ┌─────────────────────────────────────────────────┐     │
│  │           Messaging Layer (unchanged)            │     │
│  │  RedisHub (presence, routing, pub/sub)           │     │
│  │  RedisOutbox (offline message queues)            │     │
│  └─────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────┘
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
          Postgres      Redis      Nodes
        (persistent)  (ephemeral)  (local SQLite)
```

## Prisma Schema

Located at `packages/server/prisma/schema.prisma`.

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

Key decisions:
- `Token.secret` is the UUID string that nodes use to authenticate (what was previously the Redis key). It's unique and indexed.
- `Token.nodeId` is the routing identifier (e.g., "dev", "pm"). Unique per project via `@@unique([projectId, nodeId])`.
- `Project.name` is unique — enforced at database level.
- Cascade delete: removing a project removes all its tokens.
- Column names use `snake_case` in the database, `camelCase` in Prisma via `@map`.

## Repository Layer

### Directory Structure

```
packages/server/src/
├── repositories/
│   ├── index.ts              # Re-exports + createRepositories() factory
│   ├── project.repository.ts
│   └── token.repository.ts
├── hub.ts                    # Unchanged (Redis)
├── outbox.ts                 # Unchanged (Redis)
├── index.ts                  # Server entry — uses repositories instead of RedisAuth
└── prisma.ts                 # PrismaClient singleton
```

### ProjectRepository

```typescript
interface ProjectRepository {
  create(name: string): Promise<Project>
  exists(name: string): Promise<boolean>
  list(): Promise<Project[]>
  remove(id: string): Promise<void>  // cascades to tokens
}
```

### TokenRepository

```typescript
interface TokenRepository {
  create(projectId: string, nodeId: string): Promise<Token>
  validate(secret: string): Promise<{ projectId: string; nodeId: string } | null>
  revoke(secret: string): Promise<void>
  revokeByNode(projectId: string, nodeId: string): Promise<number>
  revokeByProject(projectId: string): Promise<number>
  nodeExists(projectId: string, nodeId: string): Promise<boolean>
  listAll(): Promise<TokenInfo[]>
  listByProject(projectId: string): Promise<TokenInfo[]>
}
```

`TokenInfo` is the same shape as today: `{ projectId, nodeId, createdAt }`. The `secret` field is never returned in list operations.

### Factory

```typescript
function createRepositories(prisma: PrismaClient) {
  return {
    projects: new ProjectRepository(prisma),
    tokens: new TokenRepository(prisma),
  };
}
```

## Server Changes

### Removed

- `RedisAuth` class (`auth.ts`) — fully replaced by `ProjectRepository` + `TokenRepository`
- Redis keys: `projects` (set), `token:{token}` (hash), `project_tokens:{projectId}` (set)

### Kept Unchanged

- `RedisHub` — presence (`presence:{projectId}` hash), pub/sub (`route:{projectId}` channel), local WS connections
- `RedisOutbox` — offline message queues (`outbox:{projectId}:{nodeId}` list)
- `LogBuffer` — in-memory log ring buffer

### API Endpoints

No endpoint signatures change. The handler code switches from `auth.xxx()` to `repos.projects.xxx()` / `repos.tokens.xxx()`.

| Endpoint | Before | After |
|----------|--------|-------|
| `POST /api/project/create` | `auth.createProject()` | `repos.projects.create()` |
| `GET /api/project/list` | `auth.listProjects()` | `repos.projects.list()` |
| `DELETE /api/project/:id` | `auth.revokeByProject()` | `repos.projects.remove()` |
| `POST /api/token/create` | `auth.createToken()` | `repos.tokens.create()` |
| `GET /api/token/list` | `auth.listAllTokens()` | `repos.tokens.listAll()` |
| `DELETE /api/node/:proj/:node` | `auth.revokeByNode()` | `repos.tokens.revokeByNode()` |
| WS upgrade `validateToken()` | `auth.validateToken()` | `repos.tokens.validate()` |
| `GET /api/online` | `auth.validateToken()` | `repos.tokens.validate()` |

### Startup

```typescript
// Before
const redis = new Redis(redisUrl);
const auth = new RedisAuth(redis);
const outbox = new RedisOutbox(redis);
const hub = new RedisHub(redis, outbox, instanceId);

// After
const prisma = new PrismaClient();
const repos = createRepositories(prisma);
const redis = new Redis(redisUrl);
const outbox = new RedisOutbox(redis);
const hub = new RedisHub(redis, outbox, instanceId);
```

### CLI Token Commands

The CLI commands (`token create`, `token list`, `token revoke`) switch from Redis to Prisma:

```typescript
// Before
const redis = new Redis(redisUrl);
const auth = new RedisAuth(redis);
const token = await auth.createToken(project, nodeId);

// After
const prisma = new PrismaClient();
const repos = createRepositories(prisma);
const token = await repos.tokens.create(projectId, nodeId);
```

CLI accepts `--database-url` instead of `--redis` for token operations. The `start` command still accepts `--redis` for the hub/outbox.

## Admin Frontend: TanStack Query Migration

### New Dependencies

```
pnpm add @tanstack/react-query
```

### QueryClient Setup

In `main.tsx`:

```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Wrap <App /> with <QueryClientProvider client={queryClient}>
```

### Hook Replacements

Each custom hook becomes a thin wrapper around TanStack Query:

**`useProjects(adminKey)`**
```typescript
// Query
const { data: projects } = useQuery({
  queryKey: ['projects'],
  queryFn: () => listProjects(adminKey),
  enabled: !!adminKey,
});

// Mutation
const createMutation = useMutation({
  mutationFn: (name: string) => createProject(adminKey, name),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
});
```

**`useTokens(adminKey)`**
```typescript
const { data: tokens, isLoading } = useQuery({
  queryKey: ['tokens'],
  queryFn: () => listAllTokens(adminKey),
  enabled: !!adminKey,
});

const createMutation = useMutation({
  mutationFn: ({ project, nodeId }) => createToken(adminKey, project, nodeId),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tokens'] }),
});

const removeNodeMutation = useMutation({
  mutationFn: ({ projectId, nodeId }) => removeNode(adminKey, projectId, nodeId),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['tokens'] });
    queryClient.invalidateQueries({ queryKey: ['projects'] });
  },
});

const removeProjectMutation = useMutation({
  mutationFn: (projectId: string) => removeProject(adminKey, projectId),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['tokens'] });
    queryClient.invalidateQueries({ queryKey: ['projects'] });
  },
});
```

**`useNodes(adminKey)`**
```typescript
const { data: nodes } = useQuery({
  queryKey: ['nodes'],
  queryFn: () => fetchNodes(adminKey),
  enabled: !!adminKey,
  refetchInterval: 5000,
});
```

**`useMetrics()`**
```typescript
const { data: metrics } = useQuery({
  queryKey: ['metrics'],
  queryFn: fetchMetrics,
  refetchInterval: 3000,
});
```

**`useLogs(adminKey)`**
```typescript
const { data: logs } = useQuery({
  queryKey: ['logs'],
  queryFn: () => fetchLogs(adminKey),
  enabled: !!adminKey,
  refetchInterval: 3000,
});
```

### What TanStack Query gives us

- Automatic cache invalidation after mutations (no manual `refresh()` callbacks)
- Background refetching with stale-while-revalidate
- Loading/error states built in
- No more `useState` + `useEffect` + `setInterval` boilerplate
- Automatic retry on failure

### Files Removed

- `hooks/use-auth.ts` — stays (localStorage only, no fetching)
- `hooks/use-metrics.ts` — replaced
- `hooks/use-logs.ts` — replaced
- `hooks/use-nodes.ts` — replaced
- `hooks/use-tokens.ts` — replaced
- `hooks/use-projects.ts` — replaced

### Files Added

- `hooks/queries.ts` — all TanStack Query hooks in one file (they're small wrappers)
- `lib/query-client.ts` — QueryClient instance

## Docker / Deployment

### docker-compose.yml

Add Postgres service alongside Redis:

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
    build: .
    depends_on: [postgres, redis]
    environment:
      DATABASE_URL: postgresql://inv:inv@postgres:5432/inv
      REDIS_URL: redis://redis:6379
      ADMIN_KEY: ${ADMIN_KEY}
    ports:
      - "4400:4400"

volumes:
  pgdata:
```

### Server Dockerfile

Add Prisma generate step to the build:

```dockerfile
# In the build stage
COPY packages/server/prisma ./prisma
RUN bunx prisma generate

# Before starting
RUN bunx prisma migrate deploy
```

### Environment Variables

| Variable | Before | After |
|----------|--------|-------|
| `DATABASE_URL` | N/A | `postgresql://user:pass@host:5432/db` (new, required) |
| `REDIS_URL` | Used for everything | Used for hub/outbox only |
| `ADMIN_KEY` | Unchanged | Unchanged |

## Migration Strategy

### Order of operations

1. Add Prisma schema + generate client
2. Create repository layer with Prisma implementations
3. Replace `RedisAuth` usage in `index.ts` with repositories
4. Remove `auth.ts`
5. Update server tests
6. Update docker-compose with Postgres
7. Add TanStack Query to admin
8. Replace admin hooks one by one
9. Remove old hook files

### Data Migration

For existing deployments, a one-time migration script reads Redis keys and inserts into Postgres:

```typescript
// scripts/migrate-redis-to-postgres.ts
// 1. Read all projects from Redis set "projects"
// 2. Insert into Postgres Project table
// 3. Read all tokens from Redis hashes "token:*"
// 4. Insert into Postgres Token table
// 5. Verify counts match
```

This script runs once during the upgrade. New deployments start fresh with Postgres.

## Testing

### Server Tests

- Existing `server.test.ts` tests for `RedisAuth` are replaced with repository tests
- Repository tests use a test Postgres database (or Prisma's built-in test utilities)
- `RedisHub` and `RedisOutbox` tests remain unchanged
- Add integration test: create project via API → create token → validate token → WS connect

### Admin Tests

- No test changes needed (admin has no tests currently)
- TanStack Query hooks can be tested with `@tanstack/react-query` test utilities if needed later

## Not In Scope

- Node package (`packages/node`) — keeps local SQLite, no changes
- Dashboard (`packages/dashboard`) — keeps Astro SSR with local SQLite
- Message envelope format — unchanged
- WebSocket protocol — unchanged
- MCP tools — unchanged
- Redis pub/sub routing — unchanged
