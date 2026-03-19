# inv — Inventory Network

A distributed inventory protocol for teams and AI agents. Each vertical (PM, Design, Dev, QA, DevOps) owns an independent inventory of artifacts with traces, lifecycle states, and reconciliation logs.

Built for the Constitution framework (`tini-works/const`).

## Prerequisites

- Go 1.25+ ([install](https://go.dev/doc/install))
- GCC (required by `go-sqlite3` CGO dependency)
  - macOS: `xcode-select --install`
  - Ubuntu/Debian: `sudo apt install build-essential`

## Install

### From source

```bash
git clone https://github.com/tini-works/my-inventory.git
cd my-inventory
go build -o inv .
```

Move to PATH:

```bash
sudo mv inv /usr/local/bin/
```

### One-liner (build + install)

```bash
go install github.com/tini-works/my-inventory@latest
```

> Note: CGO must be enabled. If you get linker errors, run `CGO_ENABLED=1 go install ...`

## Verify

```bash
inv --help
```

## Quick Start

```bash
# Register nodes for your team
inv node add --name "dev-inventory" --vertical dev --project clinic-checkin --owner cuong
inv node add --name "pm-inventory" --vertical pm --project clinic-checkin --owner duke

# Add items to a node
inv item add --node <node-id> --kind adr --title "WebSocket for real-time updates"
inv item add --node <node-id> --kind api-spec --title "Check-in API v2"

# Create traces between items
inv trace add --from <item-id> --to <item-id> --relation traced_from --actor cuong

# Verify an item with evidence
inv verify <item-id> --evidence "Load test passed" --actor cuong

# Check what breaks if something changes
inv impact <item-id>

# Audit a node's health
inv audit <node-id>

# Change requests with voting
inv cr create --title "Switch to WebSocket" --proposer cuong --node <node-id>
inv cr submit <cr-id>
inv cr vote <cr-id> --node <other-node-id> --voter duke --decision approve --reason "Aligns with goals"
inv cr resolve <cr-id>

# Ask questions across the network
inv ask --asker cuong --node <node-id> --question "What uses the check-in API?"
```

## MCP Server (AI Agent Integration)

Start the MCP server for use with Claude Code, Cursor, or any MCP-compatible client:

```bash
inv mcp
```

### Setup with Claude Code

The repo includes a `.mcp.json` that auto-configures the inventory MCP server. Just build and open Claude Code:

```bash
go build -o inv .
claude
```

Claude Code will detect `.mcp.json` and connect to the inventory server automatically. Run `/mcp` inside Claude Code to verify the server is active.

### Alternative setup

**CLI command (if `inv` is on your PATH):**

```bash
claude mcp add --transport stdio --scope project inventory -- inv mcp
```

For all your projects (global):

```bash
claude mcp add --transport stdio --scope user inventory -- inv mcp
```

**Verify:**

```bash
claude mcp list              # List all configured servers
claude mcp get inventory     # Check inventory server config
```

### Available MCP Tools

| Tool | Description |
|---|---|
| `inv_register_node` | Register a new node in the network |
| `inv_add_item` | Add an item to a node's inventory |
| `inv_add_trace` | Create a trace between two items |
| `inv_verify` | Verify an item with evidence |
| `inv_impact` | Show what would be affected if an item changes |
| `inv_audit` | Audit a node's inventory health |
| `inv_create_cr` | Create a change request |
| `inv_vote` | Vote on a change request |
| `inv_ask` | Ask a question to the network |
| `inv_list_nodes` | List all nodes in a project |
| `inv_list_items` | List all items in a node |

## Item Lifecycle

```
unverified ──verify──> proven ──suspect──> suspect ──re_verify──> proven
                                              │
                                              └──break──> broke ──fix──> proven
```

## Run Tests

```bash
go test -v ./...
```

## Project Structure

```
my-inventory/
├── main.go          # CLI commands (Cobra)
├── engine.go        # Core domain logic
├── store.go         # SQLite persistence
├── network.go       # Domain types (Node, Item, Trace, etc.)
├── state.go         # Item + CR state machines
├── signal.go        # Change propagation through trace graph
├── graph.go         # DI wiring (pumped-go)
├── mcp_server.go    # MCP tool handlers
├── state_test.go    # State machine unit tests
├── store_test.go    # Store integration tests
├── engine_test.go   # Engine integration tests
├── scenario_test.go # Full workflow scenario tests
└── docs/plans/      # Design documents
```

## Tech Stack

- **Go** — core language
- **SQLite** (go-sqlite3) — embedded database
- **Cobra** — CLI framework
- **mcp-go** — MCP server protocol
- **pumped-go** — dependency injection
- **testify** — test suites and assertions
