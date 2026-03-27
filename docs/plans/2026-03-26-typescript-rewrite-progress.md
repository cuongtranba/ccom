# TypeScript Rewrite — Progress Tracker

**Design:** [typescript-rewrite-design.md](./2026-03-26-typescript-rewrite-design.md)
**Implementation Plan:** [typescript-rewrite-implementation.md](./2026-03-26-typescript-rewrite-implementation.md)

## V1 Status

### Completed (2026-03-26)

| # | Task | Tests | Commit | Status |
|---|------|-------|--------|--------|
| 1 | Monorepo scaffold (Bun workspaces) | — | `81b7690` | Done |
| 2 | Shared types + message envelope | 29 | `190068b` | Done |
| 3 | Item + CR state machines | 42 | `ac33171` | Done |
| 4 | SQLite store (bun:sqlite) | 18 | `c48f902` | Done |
| 5 | Signal propagation | 11 | `fe595bf` | Done |
| 6 | Engine | 34 | `467849a` | Done |
| 7 | Central server (Redis hub/outbox/auth + WS) | 20 | `203e000` | Done |
| 8 | WebSocket client + event bus + handlers | 16 | `befb319` | Done |
| 9 | Node config + autonomy settings | 9 | `402ff45` | Done |
| 10 | Chat TUI + Claude Agent SDK | — (UI) | `41ace41` | Done |
| 11 | Integration test | 4 | `04f9887` | Done |
| 12 | Cleanup + gitignore | — | `e7d0666` | Done |

**Total: 183 tests, 0 failures**

### Channel Integration (2026-03-27)

| # | Task | Tests | Commit | Status |
|---|------|-------|--------|--------|
| 1 | ToolArgs type + permission message types | 4 | `041d523` | Done |
| 2 | Permission events in EventBus | — | `1d83a7b` | Done |
| 3 | Permission handling in WSHandlers | — | `48e4815` | Done |
| 4 | Swap Agent SDK for MCP SDK | — | `657951e` | Done |
| 5 | MCP channel server with tools + permission relay | 3 | `f342573` | Done |
| 6 | `inv init` CLI wizard | 3 | `551912e` | Done |
| 7 | CLI router entry point | — | `eaf8dbf` | Done |
| 8 | Remove agent.ts + tui.ts | — | `4f724e8` | Done |
| 9 | Init script + gitignore updates | — | `5e241d1` | Done |
| 10 | Scenario tests (all roles, vote/challenge, multi-node E2E) | 74 | — | Done |

**Total: 267 tests, 4 skipped, 0 failures (749 expect() calls across 17 files)**

### V2 Big-Bang Implementation (2026-03-27)

| # | Task | Tests | Commit | Status |
|---|------|-------|--------|--------|
| 1 | Shared V2 types (CR, Vote, PairSession, Checklist, KindMapping) | 10 | `8760048` | Done |
| 2 | CR and Vote store layer | 8 | `1f8d6fc` | Done |
| 3 | Pairing, Checklist, Kind Mapping store layer | 11 | `17922fd` | Done |
| 4 | Proposal/Voting engine methods | 11 | `d8246e3` | Done |
| 5 | Challenge engine methods | 4 | `7dee1ac` | Done |
| 6 | Pairing, Checklist, Kind Mapping engine methods | 9 | `53ef941` | Done |
| 7 | V2 MCP tools + EventBus + WSHandlers (12 new tools) | 6 | `86489cc` | Done |
| 8 | Node auto-registration (persist ID to config) | 1 | `e3744a9` | Done |
| 9 | Error handling — structured error events | 2 | `ae0d24a` | Done |
| 10 | Structured JSON logger | 3 | `8ecb4ac` | Done |
| 11 | Verify ToolArgs completeness (19 tools) | — | — | Done |
| 12 | Full test suite + progress update | — | — | Done |

**Total: 330 tests, 4 skipped, 0 failures (912 expect() calls across 18 files)**

---

## TODO — Remaining Work

### High Priority (Get it running end-to-end)

- [x] **Remove Go code** — deleted all `.go` files, `go.mod`, `go.sum`, `proto/`, `relay/`, compiled binary, `.mcp.json`, `inventory.db*`
- [x] **Create sample `inv-config.json`** — `inv-config.example.json` at repo root
- [x] **Server CLI** — `token create/list/revoke` subcommands added to server entry point
- [x] **Dockerfile + docker-compose** — `packages/server/Dockerfile` + `docker-compose.yml` (server + redis)
- [ ] **Deploy central server to Dokploy** — push Docker image, deploy to lowbit.link with Redis
- [x] **End-to-end test with 2 nodes** — `packages/node/test/e2e.test.ts` — 4 tests (broadcast, direct msg, echo suppression, auth rejection). Run with `E2E_DEV_TOKEN=... E2E_PM_TOKEN=... bun test packages/node/test/e2e.test.ts`
- [x] **Channel integration** — replaced Chat TUI + Agent SDK with MCP channel server. Run `bun run init` to set up, then `claude` to start

### Medium Priority (Polish)

- [x] **Node auto-registration** — when node connects, register with server if node.id is empty; persists ID back to config file
- [ ] **Reconnect drain** — verify outbox drains correctly on reconnect
- [ ] **Cross-instance pub/sub** — test Redis pub/sub routing between multiple server instances
- [x] **Error handling** — structured error events emitted via EventBus (SIGNAL_CHANGE_FAILED, SWEEP_FAILED, etc.)
- [x] **Logging** — structured JSON logger replacing console.log/error/warn

### V2 Features

- [x] Proposals/voting system — full lifecycle with tie-breaking via upstream verticals
- [x] Challenge system — uphold marks item suspect + cascades, dismiss archives
- [x] Pairing sessions — invite/join/end/list
- [x] Checklist feature — add/check/uncheck/list per item
- [x] Kind mapping — vertical-to-vertical kind translation
- [ ] Observability/metrics
- [ ] Web UI for pending actions

---

## Architecture Quick Reference

```
packages/
├── shared/src/          # Types + message envelope
│   ├── types.ts         # Node, Item, Trace, Signal, ToolArgs, etc.
│   ├── messages.ts      # Envelope, MessagePayload (incl. permission_request/verdict)
│   └── index.ts         # Re-exports
├── server/src/          # Central server (deploy to Dokploy)
│   ├── auth.ts          # RedisAuth — token CRUD
│   ├── hub.ts           # RedisHub — presence, routing, pub/sub
│   ├── outbox.ts        # RedisOutbox — offline message queue
│   └── index.ts         # Bun.serve WebSocket server
└── node/src/            # Node client (runs locally)
    ├── state.ts         # StateMachine (item) + CRStateMachine
    ├── store.ts         # SQLite via bun:sqlite — all tables + CRUD
    ├── signal.ts        # SignalPropagator — recursive change cascade
    ├── engine.ts        # Engine — orchestrates store/state/signal
    ├── config.ts        # NodeConfig + autonomy settings
    ├── event-bus.ts     # Typed pub/sub for network events
    ├── ws-client.ts     # WebSocket connection + auto-reconnect
    ├── ws-handlers.ts   # Message dispatch to engine
    ├── logger.ts        # Structured JSON logger (stderr)
    ├── channel.ts       # MCP channel server — 19 tools + permission relay
    ├── cli.ts           # inv init wizard — generates configs
    └── index.ts         # CLI router: "init" → wizard, default → channel server
```

## How to Run

```bash
# Install
bun install

# Run tests
bun test packages/

# Start server (needs Redis)
bun run server start --port 8080 --redis redis://localhost:6379

# Set up a new node (interactive wizard)
bun run init

# Start Claude Code with channel integration
claude

# Or start channel server directly (needs inv-config.json)
bun run node -- ./inv-config.json
```
