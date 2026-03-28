# Admin UI Redesign + Multi-Project Nodes + CLI Simplification

**Date:** 2026-03-28
**Status:** Approved

## Overview

Six interconnected features that restructure how nodes, projects, and tokens relate to each other, redesign the admin UI around datatables, simplify the CLI wizard, enhance the MCP online-nodes tool, and add a Claude Code status line.

## 1. Data Model Changes

### Current State

```
Project (id, name)
  └─ Token (id, projectId FK, nodeId, secret)
       @@unique([projectId, nodeId])
```

One token = one node in one project. No node metadata stored server-side.

### New State

```
Project (id, name, createdAt)
  └─ TokenProject (tokenId FK, projectId FK)  ← new join table
       └─ Token (id, nodeId, name, vertical, owner, secret, createdAt)
```

**Token model changes:**
- Remove `projectId` FK (replaced by join table)
- Add `name` (String) — human-readable node name
- Add `vertical` (String) — free-form role label (no longer an enum)
- Add `owner` (String) — who owns this node
- Keep `nodeId` (slug), `secret` (UUID auth token)
- Add relation: `tokenProjects → TokenProject[]`

**TokenProject join table:**
- `tokenId` (FK → Token.id)
- `projectId` (FK → Project.id)
- Composite PK/unique on `[tokenId, projectId]`
- Cascade delete from both sides

**Vertical type change:**
- `Vertical` in `shared/src/types.ts`: change from `"pm" | "design" | "dev" | "qa" | "devops"` union to `string`
- Remove `UPSTREAM_VERTICALS` constant entirely
- Signal propagation works only through explicit item traces (BFS through `traces` table), not vertical hierarchy
- All references to the old enum (CLI validation, type guards, etc.) updated to accept any string

### Token Validation

`repos.tokens.validate(secret)` now returns:

```typescript
{
  tokenId: string;
  nodeId: string;
  name: string;
  vertical: string;
  owner: string;
  projects: { id: string; name: string }[];
}
```

### Migration

Prisma migration that:
1. Adds `name`, `vertical`, `owner` columns to `Token` (default empty string)
2. Creates `TokenProject` table
3. Migrates existing `Token.projectId` data into `TokenProject` rows
4. Drops `projectId` column from `Token`

## 2. Server API Changes

### New Public Endpoints (no auth)

**`GET /api/project/public-list`**
- Returns: `{ projects: string[] }` (project names only)
- Used by the registration form and CLI

**`POST /api/register`**
- Body: `{ project: string, nodeId: string, name: string, vertical: string, owner: string }`
- Validates project exists, slugifies `nodeId`
- Creates token with node metadata, assigns to the specified project
- Returns: `{ token: string, nodeId: string, name: string, vertical: string, owner: string, project: string }`
- This is the only public write endpoint

**`GET /api/token/info?token=<secret>`**
- Authenticated by the token itself (not admin key)
- Returns: `{ nodeId: string, name: string, vertical: string, owner: string, projects: { name: string }[] }`
- Used by CLI wizard to auto-populate config

### Modified Admin Endpoints

**`POST /api/token/create`** (admin)
- Body: `{ nodeId: string, name: string, vertical: string, owner: string }`
- Creates a token with node metadata (no project assignment yet)
- Returns: `{ token: string, nodeId: string }`

**`POST /api/token/assign`** (admin, new)
- Body: `{ tokenId: string, project: string }`
- Adds a project to a token's assigned projects
- Returns: `{ assigned: true }`

**`POST /api/token/unassign`** (admin, new)
- Body: `{ tokenId: string, project: string }`
- Removes a project from a token
- Returns: `{ unassigned: true }`

**`GET /api/token/list`** (admin, modified)
- Returns tokens with their node metadata and assigned project names
- `{ tokens: { id, nodeId, name, vertical, owner, projects: string[], createdAt }[] }`

**`GET /api/online?token=<secret>`** (token-auth, modified)
- Returns nodes grouped by project:
```json
{
  "projects": [
    {
      "name": "core-pvs-111",
      "nodes": [
        { "nodeId": "design-team", "name": "Design Team", "vertical": "design" }
      ]
    }
  ]
}
```

### Hub Changes

- `register(projectIds: string[], nodeId, ws)` — registers presence in ALL assigned projects
- `unregister(projectIds: string[], nodeId)` — removes from all projects
- Connection metadata stores the list of project IDs
- `listOnline(projectId)` unchanged — still per-project
- Message routing unchanged — uses envelope's `projectId` field

## 3. Admin UI Redesign

### Two Modes

**Unauthenticated (public):** Registration form only
- Project dropdown (from `GET /api/project/public-list`)
- Node ID, Name, Vertical, Owner text inputs
- "Register" button → displays token secret (one-time, copy to clipboard)
- No other admin features visible

**Authenticated (admin key entered):** Full admin console
- MetricsStrip
- Projects DataTable
- Nodes/Tokens DataTable
- Connected Nodes table
- Server Logs

### Projects DataTable

| Column | Content |
|--------|---------|
| Name | Project slug |
| Nodes | Count of assigned tokens |
| Created | Relative timestamp |
| Actions | Delete (confirm dialog) |

- "Create Project" button above table
- **Expandable rows:** clicking a project expands to show:
  - Assigned nodes list (nodeId, name, vertical, owner, online status indicator)
  - "Assign Node" dropdown to add existing unassigned nodes
  - "Unassign" button per node

### Nodes / Tokens DataTable

| Column | Content |
|--------|---------|
| Node ID | Slug |
| Name | Human name |
| Vertical | Badge |
| Owner | Owner string |
| Projects | Comma-separated names |
| Token | Masked, click to copy |
| Actions | Delete (confirm dialog) |

- "Create Node" button above table → form: nodeId, name, vertical, owner

### DataTable Component

Reusable `<DataTable>` with:
- Column definitions (header, accessor, cell renderer)
- Optional expandable row content (render prop)
- Loading state, empty state
- No sorting/filtering/pagination (small scale)

### Design Quality

Use the impeccable skill during implementation to ensure the redesigned UI meets high design standards — consistent spacing, typography, color usage, and the existing theme (Space Grotesk / JetBrains Mono, spice/sand palette).

## 4. CLI Wizard Simplification

### New Flow

```
Inventory Node Setup
────────────────────

Server URL (ws://localhost:8080/ws): https://inv-server.apps.quickable.co/ws
Auth token: ********
Database path (./inventory.db):

Fetching node info from server... ✓
  Node: cuong-private
  Vertical: dev
  Owner: cuong
  Projects: core-pvs-111, clinic-app

Writing ./inv-config.json... ✓
Writing ./.mcp.json... ✓
```

User enters only 3 things: server URL, token, database path.

### Implementation

1. After collecting token + server URL, call `GET /api/token/info?token=<secret>`
2. Convert ws URL to http (e.g., `wss://host/ws` → `https://host/api/token/info`)
3. Display fetched info for confirmation
4. Write config with all fetched values

### Config Format Change

```json
{
  "node": {
    "id": "",
    "name": "cuong-private",
    "vertical": "dev",
    "projects": ["core-pvs-111", "clinic-app"],
    "owner": "cuong",
    "isAI": false
  }
}
```

- `node.project` (string) → `node.projects` (string array)
- All node metadata comes from server, stored locally for offline reference

## 5. MCP Tool: Enhanced `inv_online_nodes`

### Output Format

```
Online Nodes

── core-pvs-111 ──
  design-team (design) — online
  qa-bot (qa) — online

── clinic-app ──
  frontend-dev (dev) — online

Total: 3 nodes online across 2 projects
```

### Implementation

- Call updated `GET /api/online?token=<secret>`
- Format response as structured text grouped by project
- Each node shows: nodeId, vertical in parentheses, online status
- Summary line with totals

## 6. Claude Code Status Line

### Format

```
inv: cuong-private (dev) · core-pvs-111 · 5 online
```

Shows: node name, vertical, first assigned project (from config `node.projects[0]`), online peer count across all assigned projects.

### Behavior

- Only activates after WS connection succeeds AND token verification returns successfully
- "Current project" = `node.projects[0]` from config (the first assigned project)
- Online count = total unique online peers across all assigned projects
- Updates when online count changes
- If WS disconnects, status line clears or shows "disconnected"
- Implemented in `channel.ts` startup sequence, after WSClient connects

### Implementation

- Use the `statusline-setup` agent to configure the Claude Code status line
- The status line command reads from the node's runtime state

## File Impact Summary

| Package | Files Modified | Files Created |
|---------|---------------|---------------|
| `shared` | `types.ts` (Vertical → string, remove UPSTREAM_VERTICALS) | — |
| `server` | `schema.prisma`, `token.repository.ts`, `project.repository.ts`, `index.ts`, `hub.ts` | `prisma/migrations/...` |
| `admin` | `App.tsx`, `auth-gate.tsx`, `project-create-form.tsx`, `token-create-form.tsx`, `token-list.tsx`, `connected-nodes.tsx`, `lib/api.ts`, `hooks/queries.ts` | `components/data-table.tsx`, `components/register-form.tsx`, `components/projects-table.tsx`, `components/nodes-table.tsx` |
| `node` | `cli.ts`, `config.ts`, `channel.ts`, `ws-client.ts`, `engine.ts`, `store.ts` | — |

## Testing Strategy

- **Data model:** Update existing server tests for new schema, test token validation returns full metadata
- **API:** Test new endpoints (register, token/info, assign/unassign, public-list)
- **Admin UI:** Manual testing via browser (no existing e2e framework)
- **CLI:** Test wizard with mocked fetch to `/api/token/info`
- **MCP tool:** Test `inv_online_nodes` output format in existing channel tests
- **Status line:** Manual verification in Claude Code
