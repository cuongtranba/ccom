# NATS WebSocket Hub — Design Spec

**Date:** 2026-03-19
**Status:** Approved
**Author:** cuong + claude

## Problem

The current libp2p P2P architecture is too complex for reliable cross-internet connectivity. NAT traversal, DHT discovery, relay servers, and handshake protocols create a fragile stack that's hard to debug and maintain. Two nodes behind NAT struggle to find and talk to each other.

## Decision

Replace the P2P transport layer with a **central NATS-based WebSocket hub**. Nodes connect to the hub via WebSocket, and the hub routes messages using NATS pub/sub. All existing business logic (engine, store, state machines, signal propagation) remains unchanged — only the transport layer changes.

### Why NATS (not in-memory routing)

A single hub instance could route messages in-memory without NATS. NATS is chosen for:
- **Multi-hub scaling**: If the project grows, multiple hub instances can share state via NATS without code changes.
- **Message durability**: NATS JetStream can be enabled later for guaranteed delivery without rewriting the hub.
- **Decoupled design**: Hub restart does not lose subscription state — NATS maintains topics independently.

For the current scale (handful of nodes), NATS adds one extra service but keeps the architecture future-proof.

## Architecture

```
┌──────────────┐     WebSocket      ┌─────────────┐     NATS     ┌──────────┐
│  Node (dev)  │ ◄──────────────►  │   Hub Server  │ ◄──────────► │  NATS    │
│  inv serve   │                    │  (inv-hub)    │              │  Server  │
└──────────────┘                    └───────┬───────┘              └──────────┘
                                            │ WebSocket
┌──────────────┐                            │
│  Node (pm)   │ ◄─────────────────────────┘
│  inv serve   │
└──────────────┘
```

### Components

#### 1. NATS Server

Standard NATS server running on VPS. Handles pub/sub message routing.

**Topics:**
- `inv.{project}.broadcast` — all nodes in a project receive
- `inv.{project}.node.{peer_id}` — direct messages to a specific node
- `inv.{project}.registry` — node join/leave events

#### 2. Hub Server (`inv-hub`)

Separate Go binary deployed on VPS. Bridges WebSocket connections to NATS.

**Responsibilities:**
- Accept WebSocket connections from nodes
- Validate project tokens on connect
- Maintain in-memory registry of connected nodes (name, vertical, project, online status)
- Bridge messages: WebSocket → NATS publish, NATS subscription → WebSocket write
- Track online/offline status via WebSocket heartbeat (30s ping/pong)
- Broadcast join/leave events to project nodes
- **Echo suppression**: When forwarding broadcast messages from NATS to WebSockets, the hub skips the sender's WebSocket (filters by `from_peer` in the Envelope)
- Admin CLI: create projects, generate tokens, list connected nodes

**No business logic.** The hub does not understand inventory items, traces, or state machines. It routes opaque protobuf envelopes.

#### 3. Node Client (`inv serve`)

Nodes connect to the hub via WebSocket instead of running a libp2p host.

**Changes from P2P:**
- Replace `NewP2PHost()` with `NewHubClient(hubURL, token, nodeConfig)`
- Replace `P2PSender.SendEnvelope()` with WebSocket message write
- Replace `P2PSender.BroadcastEnvelope()` with publish to broadcast topic
- Replace peer discovery (DHT/mDNS) with hub registry events
- Keep local outbox for offline resilience (queue when disconnected, drain on reconnect)
- **On reconnect**: HubClient fires a reconnect callback that calls `DrainAllOutbox()` to flush queued messages

## Sender Interface

To swap transport without changing business logic, define an interface:

```go
type Sender interface {
    SendEnvelope(ctx context.Context, toPeerID string, envelope []byte) error
    BroadcastEnvelope(ctx context.Context, project string, selfPeerID string, envelope []byte) error
}
```

Both `P2PSender` (current) and `HubSender` (new) implement this interface. Engine and handler code depends only on the interface, not the concrete transport.

## Node Identity

Nodes are identified by a **UUID** generated at `inv init` time. No Ed25519 keypair or libp2p peer ID.

- `inv init` generates a UUID v4, stores it in `~/.inv/config.yaml` as `node.id`
- The UUID replaces `PeerID` everywhere (Peer struct, Envelope `from_peer`/`to_peer`, NATS topics)
- `~/.inv/identity.key` and `~/.inv/peer_id` files are removed
- `network.go` Peer struct: `PeerID string` field keeps its name but holds a UUID instead of `12D3KooW...` format

## Authentication

### Auth message format

The first message after WebSocket connect is a **JSON text frame** (not protobuf). All subsequent messages are **binary frames** containing serialized protobuf Envelopes.

```json
{
  "token": "proj_abc123",
  "node_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "name": "dev-inventory",
  "vertical": "dev",
  "project": "my-inventory",
  "owner": "cuong",
  "is_ai": false
}
```

Hub responds with JSON:

```json
{
  "status": "ok",
  "online_nodes": [
    { "node_id": "f9e8d7c6-...", "name": "pm-inventory", "vertical": "pm", "owner": "cuong" }
  ]
}
```

Or on failure:

```json
{ "status": "error", "message": "invalid token" }
```

### Project token flow

1. Hub admin creates a project: `inv-hub project create my-inventory` → prints token
2. Node init: `inv init --hub-url wss://hub.example.com/ws --hub-token proj_abc123`
3. On WebSocket connect: node sends JSON auth message
4. Hub validates token, registers node, responds with online node list

### Token storage on hub

The hub stores project-token mappings in a **SQLite database** (`inv-hub.db`):

```sql
CREATE TABLE projects (
  name TEXT PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

- Tokens are **multi-use**: all nodes in a project share the same token
- Token revocation: `inv-hub project revoke my-inventory` → generates new token, disconnects all nodes using old token
- No token expiry (revoke explicitly)

## Wire Format

- **All messages are JSON text WebSocket frames** — no protobuf, no binary frames
- First message is the auth handshake (see Authentication section)
- All subsequent messages are JSON-serialized `Envelope` structs
- **One frame = one Envelope** — no length prefix needed (WebSocket frames are already length-delimited)
- **Max frame size**: 1MB (existing limit, enforced by hub)
- `proto/` directory and all protobuf dependencies are removed entirely

## Data Flow

### Node sends broadcast (e.g., signal propagation after verify)

```
Node A (dev)
  → JSON WebSocket frame: Envelope (to_peer = "")
  → Hub receives, publishes to NATS inv.my-inventory.broadcast
  → NATS delivers to Hub's subscription
  → Hub writes to all project WebSockets EXCEPT Node A (echo suppression)
  → Node B receives, dispatches to handler
```

### Direct message (e.g., query response to specific node)

```
Node A
  → JSON WebSocket frame: Envelope (to_peer = "peer_id_of_B")
  → Hub publishes to NATS inv.my-inventory.node.{peer_id_of_B}
  → Hub writes to Node B WebSocket
```

### Node connects

```
1. Node opens WebSocket to wss://hub.example.com/ws
2. Sends JSON auth message: { token, name, vertical, project, owner, is_ai, peer_id }
3. Hub validates token → closes with 4001 if invalid
4. Hub registers node in memory
5. Hub subscribes to NATS inv.{project}.node.{peer_id} for direct messages
6. Hub publishes join event to inv.{project}.registry
7. Hub responds with JSON: { status: "ok", online_nodes: [...] }
8. All connected nodes receive join event, update local peer store
```

### Node disconnects

```
1. WebSocket closes (or ping timeout after 30s)
2. Hub removes from in-memory registry
3. Hub unsubscribes from NATS direct topic
4. Hub publishes leave event to inv.{project}.registry
5. Connected nodes receive leave event, update peer status
```

## Error Handling

| Scenario | Behavior |
|---|---|
| Hub goes down | Nodes reconnect with exponential backoff (1s, 2s, 4s, ... max 60s). Local outbox queues messages. On reconnect, `DrainAllOutbox()` flushes queue. |
| NATS goes down | Hub returns errors to nodes. Nodes queue to local outbox. Hub reconnects to NATS automatically. |
| Node disconnects | Hub detects via ping timeout (30s). Publishes leave event. |
| Invalid token | Hub closes WebSocket with code 4001 and error message. |
| Duplicate peer_id | Hub rejects with error. Node must use unique identity. |
| Message too large | Hub rejects messages > 1MB (existing limit). |

## Configuration

### Before (P2P)

```yaml
network:
  listen_port: 9090
  bootstrap_peers:
    - /ip4/51.195.102.97/tcp/4001/p2p/12D3KooW...
  enable_mdns: true
  enable_dht: true
  enable_relay: true
```

### After (Hub)

```yaml
network:
  hub_url: "wss://51.195.102.97:8080/ws"
  hub_token: "proj_abc123"
```

## Deployment

### VPS

```bash
# NATS server
docker run -d --name nats -p 4222:4222 nats:latest

# Hub server (behind nginx for TLS, or with self-signed cert for IP-based access)
./inv-hub --nats-url nats://localhost:4222 --port 8080
```

**TLS note:** Let's Encrypt does not issue certificates for bare IP addresses. Either:
- Point a domain (e.g., `hub.tini.works`) at the VPS and use Let's Encrypt
- Use nginx as a TLS termination proxy
- Use `ws://` (unencrypted) for development/testing

### Node setup

```bash
inv init --name dev-inventory --vertical dev --project my-inventory --owner cuong \
  --hub-url ws://51.195.102.97:8080/ws --hub-token proj_abc123
inv serve
```

## What Gets Removed

| File | Reason |
|---|---|
| `p2p.go` | libp2p host, DHT, mDNS, relay — replaced by WebSocket client |
| `p2p_handshake.go` | Handshake protocol — replaced by hub auth |
| `identity.go` (or equivalent) | Ed25519 keypair generation — replaced by UUID |
| `p2p_discovery_test.go` | P2P discovery tests — no longer applicable |
| `scenario_p2p_test.go` | P2P scenario tests — replaced by hub integration tests |
| `p2p_test.go` | P2P unit tests — no longer applicable |
| `relay/` | Standalone relay server — no longer needed |
| `proto/` | Protobuf definitions — replaced by Go structs with JSON serialization |
| libp2p deps in `go.mod` | ~30 transitive dependencies removed |
| protobuf deps in `go.mod` | `google.golang.org/protobuf`, `protoc-gen-go` removed |

**Proto cleanup:** Entire `proto/` directory removed. All message types become Go structs with `json` tags. The `Envelope` struct and all payload types (SignalChange, QueryAsk, ProposalCreate, etc.) are defined in a new `messages.go` file.

## What Gets Kept (Unchanged)

| File | Reason |
|---|---|
| `engine.go` | Core business logic |
| `store.go` | SQLite persistence, peer CRUD, outbox |
| `network.go` | Domain types (Peer, OutboxMessage, etc.) — Peer.PeerID remains the same format |
| `state.go` | Item + CR state machines |
| `signal.go` | Change propagation |

## What Gets Modified

| File | Changes |
|---|---|
| `p2p_sender.go` → `sender.go` | Extract `Sender` interface. Implement `HubSender` using WebSocket. Remove libp2p imports. |
| `p2p_handlers.go` → `handlers.go` | Same event dispatch, different transport source. Rename `P2PEventBus` → `EventBus`, `P2PHandlers` → `Handlers`. |
| `config.go` | Replace P2P network fields (`listen_port`, `bootstrap_peers`, `enable_mdns/dht/relay`) with `hub_url` and `hub_token`. |
| `main.go` | `serve` connects to hub instead of starting libp2p. `init` accepts `--hub-url` and `--hub-token` flags instead of `--from-peer`. Remove or adapt `network` subcommands to query hub API. |
| `graph.go` | Replace `P2PHost` provider with `HubClient` provider. Replace `P2PSender` provider with `HubSender`. Update `P2PHandlersProvider` → `HandlersProvider`. |
| `mcp_server.go` | Wire `HubSender` (via `Sender` interface) instead of `P2PSender` for MCP tools that trigger network operations (e.g., `inv_ask`, `inv_vote`). |

## New Files

| File | Purpose |
|---|---|
| `messages.go` | Go struct definitions for Envelope and all payload types (replaces proto/inv.proto), with JSON tags |
| `hub_client.go` | WebSocket client — connect, JSON auth, send/receive JSON frames, reconnect with backoff, drain outbox on reconnect |
| `sender.go` | `Sender` interface + `HubSender` implementation |
| `cmd/inv-hub/main.go` | Hub server binary — WebSocket server, NATS bridge, admin CLI |
| `cmd/inv-hub/registry.go` | In-memory node registry with echo suppression |
| `cmd/inv-hub/auth.go` | Project token validation against SQLite |
| `cmd/inv-hub/store.go` | Hub SQLite for project/token storage |

## Testing Strategy

- **Unit tests:** Hub registry, auth validation, message routing, echo suppression
- **Integration tests:** Node connects to hub, sends message, other node receives. Test reconnect + outbox drain.
- **E2E test:** Two nodes on different machines communicate through hub
- **Existing tests:** All engine/store/state tests remain unchanged (transport-independent)
