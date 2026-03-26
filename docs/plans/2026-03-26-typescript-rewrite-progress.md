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

---

## TODO — Remaining Work

### High Priority (Get it running end-to-end)

- [ ] **Deploy central server to Dokploy** — build Docker image for `packages/server`, deploy to lowbit.link with Redis
- [ ] **Create sample `inv-config.json`** — example config for running a node locally
- [ ] **End-to-end test with 2 nodes** — start server, connect 2 nodes, verify messages route correctly
- [ ] **Test Chat TUI manually** — run `bun run node -- ./inv-config.json`, interact with Claude, verify tools work
- [ ] **Remove Go code** — delete all `.go` files, `go.mod`, `go.sum`, `proto/`, `relay/`, compiled binaries, `.mcp.json`

### Medium Priority (Polish)

- [ ] **Server CLI** — `bun run server token create/list/revoke` commands (currently only `start` works)
- [ ] **Node auto-registration** — when node connects, register with server if node.id is empty
- [ ] **Reconnect drain** — verify outbox drains correctly on reconnect
- [ ] **Cross-instance pub/sub** — test Redis pub/sub routing between multiple server instances
- [ ] **Error handling** — add proper error responses back to sender (error envelope)
- [ ] **Logging** — replace console.log with structured logging

### V2 Features (Deferred)

- [ ] Proposals/voting system
- [ ] Challenge system
- [ ] Pairing sessions
- [ ] Checklist feature
- [ ] Observability/metrics
- [ ] Kind mapping
- [ ] Web UI for pending actions

---

## Architecture Quick Reference

```
packages/
├── shared/src/          # Types + message envelope
│   ├── types.ts         # Node, Item, Trace, Signal, etc.
│   ├── messages.ts      # Envelope, MessagePayload, createEnvelope, parseEnvelope
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
    ├── agent.ts         # Claude SDK wrapper with 6 inventory tools
    ├── tui.ts           # readline Chat TUI with live events
    └── index.ts         # Wires everything, starts TUI
```

## How to Run

```bash
# Install
bun install

# Run tests
bun test packages/

# Start server (needs Redis)
bun run server start --port 8080 --redis redis://localhost:6379

# Start node (needs config file)
bun run node -- ./inv-config.json

# Example inv-config.json:
# {
#   "node": { "name": "dev-inventory", "vertical": "dev", "project": "clinic-checkin", "owner": "cuong" },
#   "server": { "url": "ws://localhost:8080/ws", "token": "your-token" },
#   "database": { "path": "./inventory.db" }
# }
```
