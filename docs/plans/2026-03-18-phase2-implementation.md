# Phase 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the inventory network feature set (query, sweep, reconcile, trace chain), add dual zerolog output, and build four layers of tests.

**Architecture:** Flat package at root. Engine orchestrates Store (SQLite) + StateMachine + SignalPropagator. CLI (Cobra) and MCP server both call Engine. DI via pumped-go. Two zerolog instances: agent (stdout) for data, system (stderr) for diagnostics.

**Tech Stack:** Go 1.25, SQLite (go-sqlite3), Cobra, mcp-go, pumped-go, zerolog

---

## Task 0: Initialize Git Repository

**Files:**
- Create: `.gitignore`

**Step 1: Create .gitignore**

```gitignore
inventory.db
*.db-wal
*.db-shm
```

**Step 2: Initialize repo and commit**

Run: `git init && git add -A && git commit -m "feat: initial inventory network implementation"`
Expected: Clean commit with all existing files.

---

## Task 1: Add `external_ref` Field to Items

**Files:**
- Modify: `network.go:47-60` (Item struct)
- Modify: `store.go:46-59` (items table schema)
- Modify: `store.go:204-218` (CreateItem)
- Modify: `store.go:220-235` (GetItem scan)
- Modify: `store.go:237-259` (ListItems scan)
- Modify: `store.go:262-285` (GetItemsByNodeAndStatus scan)
- Modify: `engine.go:33-48` (AddItem signature)
- Modify: `main.go:114-136` (item add CLI)
- Modify: `mcp_server.go:41-58` (inv_add_item MCP tool)

**Step 1: Add field to Item struct**

In `network.go:47-60`, add `ExternalRef` field after `Body`:

```go
type Item struct {
	ID          string     `json:"id"`
	NodeID      string     `json:"node_id"`
	Kind        ItemKind   `json:"kind"`
	Title       string     `json:"title"`
	Body        string     `json:"body"`
	ExternalRef string     `json:"external_ref,omitempty"`
	Status      ItemStatus `json:"status"`
	Evidence    string     `json:"evidence,omitempty"`
	ConfirmedBy string     `json:"confirmed_by,omitempty"`
	ConfirmedAt *time.Time `json:"confirmed_at,omitempty"`
	Version     int        `json:"version"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}
```

**Step 2: Add column to schema**

In `store.go`, inside the `items` CREATE TABLE, add after `body`:

```sql
external_ref TEXT DEFAULT '',
```

**Step 3: Update CreateItem to include external_ref**

In `store.go:204-218`, change the INSERT to include `external_ref`:

```go
func (s *Store) CreateItem(ctx context.Context, item *Item) error {
	if item.ID == "" {
		item.ID = uuid.New().String()
	}
	now := time.Now()
	item.CreatedAt = now
	item.UpdatedAt = now
	item.Status = StatusUnverified
	item.Version = 1
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO items (id, node_id, kind, title, body, external_ref, status, version, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		item.ID, item.NodeID, item.Kind, item.Title, item.Body, item.ExternalRef, item.Status, item.Version, item.CreatedAt, item.UpdatedAt)
	return err
}
```

**Step 4: Update ALL item scan queries**

Every SELECT on items must now include `external_ref`. The scan column list becomes:

```
id, node_id, kind, title, body, external_ref, status, evidence, confirmed_by, confirmed_at, version, created_at, updated_at
```

Update these functions in `store.go`:
- `GetItem` (line 220)
- `ListItems` (line 237)
- `GetItemsByNodeAndStatus` (line 262)

Each Scan call adds `&item.ExternalRef` after `&item.Body`.

**Step 5: Update Engine.AddItem signature**

In `engine.go:33-48`:

```go
func (e *Engine) AddItem(ctx context.Context, nodeID string, kind ItemKind, title, body, externalRef string) (*Item, error) {
	if _, err := e.store.GetNode(ctx, nodeID); err != nil {
		return nil, fmt.Errorf("node not found: %w", err)
	}

	item := &Item{
		NodeID:      nodeID,
		Kind:        kind,
		Title:       title,
		Body:        body,
		ExternalRef: externalRef,
	}
	if err := e.store.CreateItem(ctx, item); err != nil {
		return nil, fmt.Errorf("create item: %w", err)
	}
	return item, nil
}
```

**Step 6: Update CLI item add command**

In `main.go:114-136`, add `--ref` flag and pass to AddItem:

```go
addCmd := &cobra.Command{
	Use:   "add",
	Short: "Add an item to a node's inventory",
	RunE: func(cmd *cobra.Command, args []string) error {
		nodeID, _ := cmd.Flags().GetString("node")
		kind, _ := cmd.Flags().GetString("kind")
		title, _ := cmd.Flags().GetString("title")
		body, _ := cmd.Flags().GetString("body")
		ref, _ := cmd.Flags().GetString("ref")

		item, err := e.AddItem(context.Background(), nodeID, ItemKind(kind), title, body, ref)
		if err != nil {
			return err
		}
		fmt.Printf("Item created: %s [%s] %s (status: %s)\n", item.ID[:8], item.Kind, item.Title, item.Status)
		return nil
	},
}
addCmd.Flags().String("node", "", "Node ID")
addCmd.Flags().String("kind", "custom", "Item kind (adr, api-spec, data-model, epic, user-story, etc.)")
addCmd.Flags().String("title", "", "Item title")
addCmd.Flags().String("body", "", "Item body (markdown)")
addCmd.Flags().String("ref", "", "External reference (e.g., US-003, BUG-001)")
addCmd.MarkFlagRequired("node")
addCmd.MarkFlagRequired("title")
```

**Step 7: Update MCP inv_add_item tool**

In `mcp_server.go:41-58`, add `external_ref` param and pass to AddItem:

```go
s.AddTool(mcp.NewTool("inv_add_item",
	mcp.WithDescription("Add an item to a node's inventory"),
	mcp.WithString("node_id", mcp.Required(), mcp.Description("Node ID")),
	mcp.WithString("kind", mcp.Required(), mcp.Description("Item kind (adr, api-spec, data-model, epic, user-story, etc.)")),
	mcp.WithString("title", mcp.Required(), mcp.Description("Item title")),
	mcp.WithString("body", mcp.Description("Item body (markdown)")),
	mcp.WithString("external_ref", mcp.Description("External reference (e.g., US-003, BUG-001)")),
), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	nodeID, _ := req.RequireString("node_id")
	kind, _ := req.RequireString("kind")
	title, _ := req.RequireString("title")
	body, _ := req.GetArguments()["body"].(string)
	ref, _ := req.GetArguments()["external_ref"].(string)

	item, err := engine.AddItem(ctx, nodeID, ItemKind(kind), title, body, ref)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return resultJSON(item)
})
```

**Step 8: Verify compilation**

Run: `go build ./...`
Expected: No errors.

**Step 9: Commit**

```bash
git add network.go store.go engine.go main.go mcp_server.go
git commit -m "feat: add external_ref field to items for cross-system tracing"
```

---

## Task 2: Query — Text Search + Structured Filters

**Files:**
- Modify: `engine.go` (add QueryFilter type + QueryItems method)
- Modify: `store.go` (add QueryItems method)
- Modify: `main.go` (add query CLI command)
- Modify: `mcp_server.go` (add inv_query MCP tool)

**Step 1: Add QueryFilter type and Engine method**

Append to `engine.go`:

```go
type QueryFilter struct {
	Text        string
	Kind        ItemKind
	Status      ItemStatus
	NodeID      string
	ExternalRef string
}

func (e *Engine) QueryItems(ctx context.Context, f QueryFilter) ([]Item, error) {
	return e.store.QueryItems(ctx, f)
}
```

**Step 2: Add Store.QueryItems with dynamic WHERE**

Append to `store.go`:

```go
func (s *Store) QueryItems(ctx context.Context, f QueryFilter) ([]Item, error) {
	query := `SELECT id, node_id, kind, title, body, external_ref, status, evidence, confirmed_by, confirmed_at, version, created_at, updated_at FROM items WHERE 1=1`
	var args []any

	if f.Text != "" {
		query += ` AND (title LIKE ? OR body LIKE ?)`
		pattern := "%" + f.Text + "%"
		args = append(args, pattern, pattern)
	}
	if f.Kind != "" {
		query += ` AND kind = ?`
		args = append(args, f.Kind)
	}
	if f.Status != "" {
		query += ` AND status = ?`
		args = append(args, f.Status)
	}
	if f.NodeID != "" {
		query += ` AND node_id = ?`
		args = append(args, f.NodeID)
	}
	if f.ExternalRef != "" {
		query += ` AND external_ref = ?`
		args = append(args, f.ExternalRef)
	}

	query += ` ORDER BY updated_at DESC`

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []Item
	for rows.Next() {
		var item Item
		var confirmedAt sql.NullTime
		if err := rows.Scan(&item.ID, &item.NodeID, &item.Kind, &item.Title, &item.Body, &item.ExternalRef, &item.Status,
			&item.Evidence, &item.ConfirmedBy, &confirmedAt, &item.Version, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		if confirmedAt.Valid {
			item.ConfirmedAt = &confirmedAt.Time
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
```

**Step 3: Add query CLI command**

Add to `main.go`, register in `root.AddCommand(...)`:

```go
func queryCmd(e *Engine) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "query [text]",
		Short: "Search items by text, kind, status, node, or external ref",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			f := QueryFilter{}
			if len(args) > 0 {
				f.Text = args[0]
			}
			kind, _ := cmd.Flags().GetString("kind")
			status, _ := cmd.Flags().GetString("status")
			node, _ := cmd.Flags().GetString("node")
			ref, _ := cmd.Flags().GetString("ref")

			f.Kind = ItemKind(kind)
			f.Status = ItemStatus(status)
			f.NodeID = node
			f.ExternalRef = ref

			items, err := e.QueryItems(context.Background(), f)
			if err != nil {
				return err
			}
			return printJSON(items)
		},
	}
	cmd.Flags().String("kind", "", "Filter by item kind")
	cmd.Flags().String("status", "", "Filter by status")
	cmd.Flags().String("node", "", "Filter by node ID")
	cmd.Flags().String("ref", "", "Filter by external reference")
	return cmd
}
```

Register: add `queryCmd(engine)` to `root.AddCommand(...)` in `main()`.

**Step 4: Add inv_query MCP tool**

Append to MCP tools in `mcp_server.go`:

```go
s.AddTool(mcp.NewTool("inv_query",
	mcp.WithDescription("Search items by text, kind, status, node, or external reference"),
	mcp.WithString("text", mcp.Description("Text search on title and body")),
	mcp.WithString("kind", mcp.Description("Filter by item kind")),
	mcp.WithString("status", mcp.Description("Filter by status")),
	mcp.WithString("node_id", mcp.Description("Filter by node ID")),
	mcp.WithString("external_ref", mcp.Description("Filter by external reference")),
), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	f := QueryFilter{}
	if v, ok := req.GetArguments()["text"].(string); ok {
		f.Text = v
	}
	if v, ok := req.GetArguments()["kind"].(string); ok {
		f.Kind = ItemKind(v)
	}
	if v, ok := req.GetArguments()["status"].(string); ok {
		f.Status = ItemStatus(v)
	}
	if v, ok := req.GetArguments()["node_id"].(string); ok {
		f.NodeID = v
	}
	if v, ok := req.GetArguments()["external_ref"].(string); ok {
		f.ExternalRef = v
	}

	items, err := engine.QueryItems(ctx, f)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return resultJSON(items)
})
```

**Step 5: Verify compilation**

Run: `go build ./...`
Expected: No errors.

**Step 6: Commit**

```bash
git add engine.go store.go main.go mcp_server.go
git commit -m "feat: add query command with text search and structured filters"
```

---

## Task 3: Sweep — External Ref Impact Propagation

**Files:**
- Modify: `engine.go` (add SweepResult type + Sweep method)
- Modify: `store.go` (add FindItemsByExternalRef)
- Modify: `main.go` (add sweep CLI command)
- Modify: `mcp_server.go` (add inv_sweep MCP tool)

**Step 1: Add FindItemsByExternalRef to Store**

Append to `store.go`:

```go
func (s *Store) FindItemsByExternalRef(ctx context.Context, ref string) ([]Item, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, node_id, kind, title, body, external_ref, status, evidence, confirmed_by, confirmed_at, version, created_at, updated_at
		 FROM items WHERE external_ref = ? ORDER BY created_at`, ref)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []Item
	for rows.Next() {
		var item Item
		var confirmedAt sql.NullTime
		if err := rows.Scan(&item.ID, &item.NodeID, &item.Kind, &item.Title, &item.Body, &item.ExternalRef, &item.Status,
			&item.Evidence, &item.ConfirmedBy, &confirmedAt, &item.Version, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		if confirmedAt.Valid {
			item.ConfirmedAt = &confirmedAt.Time
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
```

**Step 2: Add SweepResult type and Engine.Sweep method**

Append to `engine.go`:

```go
type SweepResult struct {
	TriggerRef     string `json:"trigger_ref"`
	MatchedItems   []Item `json:"matched_items"`
	AffectedItems  []Item `json:"affected_items"`
	SignalsCreated int    `json:"signals_created"`
}

func (e *Engine) Sweep(ctx context.Context, externalRef string) (*SweepResult, error) {
	matched, err := e.store.FindItemsByExternalRef(ctx, externalRef)
	if err != nil {
		return nil, fmt.Errorf("find items by ref: %w", err)
	}

	result := &SweepResult{
		TriggerRef:   externalRef,
		MatchedItems: matched,
	}

	seen := make(map[string]bool)
	for _, item := range matched {
		affected, err := e.ComputeImpact(ctx, item.ID)
		if err != nil {
			return nil, fmt.Errorf("compute impact for %s: %w", item.ID, err)
		}

		for _, dep := range affected {
			if seen[dep.ID] {
				continue
			}
			seen[dep.ID] = true

			if dep.Status == StatusSuspect || dep.Status == StatusBroke {
				result.AffectedItems = append(result.AffectedItems, dep)
				continue
			}

			signals, err := e.PropagateChange(ctx, item.ID)
			if err != nil {
				return nil, fmt.Errorf("propagate from %s: %w", item.ID, err)
			}
			result.SignalsCreated += len(signals)

			refreshed, err := e.store.GetItem(ctx, dep.ID)
			if err != nil {
				return nil, fmt.Errorf("refresh item %s: %w", dep.ID, err)
			}
			result.AffectedItems = append(result.AffectedItems, *refreshed)
		}
	}

	return result, nil
}
```

**Step 3: Add sweep CLI command**

Add to `main.go`, register in `root.AddCommand(...)`:

```go
func sweepCmd(e *Engine) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "sweep",
		Short: "Mark dependents suspect when an external reference changes",
		RunE: func(cmd *cobra.Command, args []string) error {
			ref, _ := cmd.Flags().GetString("ref")

			result, err := e.Sweep(context.Background(), ref)
			if err != nil {
				return err
			}
			return printJSON(result)
		},
	}
	cmd.Flags().String("ref", "", "External reference that changed (e.g., US-003)")
	cmd.MarkFlagRequired("ref")
	return cmd
}
```

Register: add `sweepCmd(engine)` to `root.AddCommand(...)`.

**Step 4: Add inv_sweep MCP tool**

Append to MCP tools in `mcp_server.go`:

```go
s.AddTool(mcp.NewTool("inv_sweep",
	mcp.WithDescription("When an external reference changes, find all items referencing it and mark their dependents suspect"),
	mcp.WithString("ref", mcp.Required(), mcp.Description("External reference that changed (e.g., US-003)")),
), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	ref, _ := req.RequireString("ref")

	result, err := engine.Sweep(ctx, ref)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return resultJSON(result)
})
```

**Step 5: Verify compilation**

Run: `go build ./...`
Expected: No errors.

**Step 6: Commit**

```bash
git add engine.go store.go main.go mcp_server.go
git commit -m "feat: add sweep command for external ref impact propagation"
```

---

## Task 4: Reconcile — Session-Based Re-verification

**Files:**
- Modify: `network.go` (add ReconciliationSession, ReconciliationEntry types)
- Modify: `store.go` (add tables + CRUD for sessions and entries)
- Modify: `engine.go` (add StartReconciliation, ResolveItem, CompleteReconciliation)
- Modify: `main.go` (add reconcile CLI subcommands)
- Modify: `mcp_server.go` (add 3 MCP tools)

**Step 1: Add types to network.go**

Append to `network.go`:

```go
type ReconciliationSession struct {
	ID          string                `json:"id"`
	TriggerRef  string                `json:"trigger_ref"`
	NodeID      string                `json:"node_id"`
	Status      string                `json:"status"`
	Entries     []ReconciliationEntry `json:"entries,omitempty"`
	StartedBy   string                `json:"started_by"`
	StartedAt   time.Time             `json:"started_at"`
	CompletedAt *time.Time            `json:"completed_at,omitempty"`
}

type ReconciliationEntry struct {
	ID        string    `json:"id"`
	SessionID string    `json:"session_id"`
	ItemID    string    `json:"item_id"`
	Decision  string    `json:"decision"`
	Evidence  string    `json:"evidence"`
	Actor     string    `json:"actor"`
	CreatedAt time.Time `json:"created_at"`
}
```

**Step 2: Add tables to schema in store.go migrate()**

Add after the `reconciliation_log` table in the schema string:

```sql
CREATE TABLE IF NOT EXISTS reconciliation_sessions (
    id           TEXT PRIMARY KEY,
    trigger_ref  TEXT NOT NULL,
    node_id      TEXT NOT NULL REFERENCES nodes(id),
    status       TEXT DEFAULT 'open',
    started_by   TEXT NOT NULL,
    started_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);

CREATE TABLE IF NOT EXISTS reconciliation_entries (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES reconciliation_sessions(id),
    item_id    TEXT NOT NULL REFERENCES items(id),
    decision   TEXT NOT NULL,
    evidence   TEXT DEFAULT '',
    actor      TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_recon_entries_session ON reconciliation_entries(session_id);
```

**Step 3: Add Store CRUD for reconciliation**

Append to `store.go`:

```go
func (s *Store) CreateReconciliationSession(ctx context.Context, sess *ReconciliationSession) error {
	if sess.ID == "" {
		sess.ID = uuid.New().String()
	}
	sess.StartedAt = time.Now()
	sess.Status = "open"
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO reconciliation_sessions (id, trigger_ref, node_id, status, started_by, started_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		sess.ID, sess.TriggerRef, sess.NodeID, sess.Status, sess.StartedBy, sess.StartedAt)
	return err
}

func (s *Store) GetReconciliationSession(ctx context.Context, id string) (*ReconciliationSession, error) {
	sess := &ReconciliationSession{}
	var completedAt sql.NullTime
	err := s.db.QueryRowContext(ctx,
		`SELECT id, trigger_ref, node_id, status, started_by, started_at, completed_at
		 FROM reconciliation_sessions WHERE id = ?`, id).
		Scan(&sess.ID, &sess.TriggerRef, &sess.NodeID, &sess.Status, &sess.StartedBy, &sess.StartedAt, &completedAt)
	if err != nil {
		return nil, err
	}
	if completedAt.Valid {
		sess.CompletedAt = &completedAt.Time
	}

	entries, err := s.GetReconciliationEntries(ctx, id)
	if err != nil {
		return nil, err
	}
	sess.Entries = entries
	return sess, nil
}

func (s *Store) CompleteReconciliationSession(ctx context.Context, id string) error {
	now := time.Now()
	_, err := s.db.ExecContext(ctx,
		`UPDATE reconciliation_sessions SET status = 'completed', completed_at = ? WHERE id = ?`,
		now, id)
	return err
}

func (s *Store) CreateReconciliationEntry(ctx context.Context, entry *ReconciliationEntry) error {
	if entry.ID == "" {
		entry.ID = uuid.New().String()
	}
	entry.CreatedAt = time.Now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO reconciliation_entries (id, session_id, item_id, decision, evidence, actor, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		entry.ID, entry.SessionID, entry.ItemID, entry.Decision, entry.Evidence, entry.Actor, entry.CreatedAt)
	return err
}

func (s *Store) GetReconciliationEntries(ctx context.Context, sessionID string) ([]ReconciliationEntry, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, session_id, item_id, decision, evidence, actor, created_at
		 FROM reconciliation_entries WHERE session_id = ? ORDER BY created_at`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []ReconciliationEntry
	for rows.Next() {
		var e ReconciliationEntry
		if err := rows.Scan(&e.ID, &e.SessionID, &e.ItemID, &e.Decision, &e.Evidence, &e.Actor, &e.CreatedAt); err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}
```

**Step 4: Add Engine reconciliation methods**

Append to `engine.go`:

```go
func (e *Engine) StartReconciliation(ctx context.Context, triggerRef, nodeID, actor string) (*ReconciliationSession, error) {
	if _, err := e.store.GetNode(ctx, nodeID); err != nil {
		return nil, fmt.Errorf("node not found: %w", err)
	}

	sess := &ReconciliationSession{
		TriggerRef: triggerRef,
		NodeID:     nodeID,
		StartedBy:  actor,
	}
	if err := e.store.CreateReconciliationSession(ctx, sess); err != nil {
		return nil, fmt.Errorf("create session: %w", err)
	}

	suspectItems, err := e.store.GetItemsByNodeAndStatus(ctx, nodeID, StatusSuspect)
	if err != nil {
		return nil, fmt.Errorf("get suspect items: %w", err)
	}

	sess.Entries = make([]ReconciliationEntry, 0)
	for _, item := range suspectItems {
		sess.Entries = append(sess.Entries, ReconciliationEntry{
			SessionID: sess.ID,
			ItemID:    item.ID,
			Decision:  "pending",
		})
	}

	return sess, nil
}

func (e *Engine) ResolveItem(ctx context.Context, sessionID, itemID, decision, evidence, actor string) (*ReconciliationEntry, error) {
	sess, err := e.store.GetReconciliationSession(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("get session: %w", err)
	}
	if sess.Status != "open" {
		return nil, fmt.Errorf("session %s is %s, not open", sessionID, sess.Status)
	}

	switch decision {
	case "re_verified":
		if err := e.VerifyItem(ctx, itemID, evidence, actor); err != nil {
			return nil, fmt.Errorf("verify item: %w", err)
		}
	case "marked_broke":
		if err := e.MarkBroken(ctx, itemID, evidence, actor); err != nil {
			return nil, fmt.Errorf("mark broken: %w", err)
		}
	case "deferred":
		// No state change, just record the decision
	default:
		return nil, fmt.Errorf("invalid decision: %s (must be re_verified, marked_broke, or deferred)", decision)
	}

	entry := &ReconciliationEntry{
		SessionID: sessionID,
		ItemID:    itemID,
		Decision:  decision,
		Evidence:  evidence,
		Actor:     actor,
	}
	if err := e.store.CreateReconciliationEntry(ctx, entry); err != nil {
		return nil, fmt.Errorf("create entry: %w", err)
	}
	return entry, nil
}

func (e *Engine) CompleteReconciliation(ctx context.Context, sessionID string) (*ReconciliationSession, error) {
	sess, err := e.store.GetReconciliationSession(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("get session: %w", err)
	}
	if sess.Status != "open" {
		return nil, fmt.Errorf("session %s is %s, not open", sessionID, sess.Status)
	}

	if err := e.store.CompleteReconciliationSession(ctx, sessionID); err != nil {
		return nil, fmt.Errorf("complete session: %w", err)
	}

	return e.store.GetReconciliationSession(ctx, sessionID)
}
```

**Step 5: Add reconcile CLI subcommands**

Add to `main.go`, register `reconcileCmd(engine)` in `root.AddCommand(...)`:

```go
func reconcileCmd(e *Engine) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "reconcile",
		Short: "Manage reconciliation sessions",
	}

	startCmd := &cobra.Command{
		Use:   "start",
		Short: "Start a reconciliation session for suspect items after a sweep",
		RunE: func(cmd *cobra.Command, args []string) error {
			ref, _ := cmd.Flags().GetString("ref")
			nodeID, _ := cmd.Flags().GetString("node")
			actor, _ := cmd.Flags().GetString("actor")

			sess, err := e.StartReconciliation(context.Background(), ref, nodeID, actor)
			if err != nil {
				return err
			}
			return printJSON(sess)
		},
	}
	startCmd.Flags().String("ref", "", "Trigger reference (external ref that caused the sweep)")
	startCmd.Flags().String("node", "", "Node ID to reconcile")
	startCmd.Flags().String("actor", "", "Who is starting the reconciliation")
	startCmd.MarkFlagRequired("ref")
	startCmd.MarkFlagRequired("node")
	startCmd.MarkFlagRequired("actor")

	resolveCmd := &cobra.Command{
		Use:   "resolve [item-id]",
		Short: "Resolve a suspect item within a reconciliation session",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			sessionID, _ := cmd.Flags().GetString("session")
			decision, _ := cmd.Flags().GetString("decision")
			evidence, _ := cmd.Flags().GetString("evidence")
			actor, _ := cmd.Flags().GetString("actor")

			entry, err := e.ResolveItem(context.Background(), sessionID, args[0], decision, evidence, actor)
			if err != nil {
				return err
			}
			return printJSON(entry)
		},
	}
	resolveCmd.Flags().String("session", "", "Reconciliation session ID")
	resolveCmd.Flags().String("decision", "", "Decision: re_verified, marked_broke, deferred")
	resolveCmd.Flags().String("evidence", "", "Evidence for the decision")
	resolveCmd.Flags().String("actor", "", "Who is resolving")
	resolveCmd.MarkFlagRequired("session")
	resolveCmd.MarkFlagRequired("decision")
	resolveCmd.MarkFlagRequired("actor")

	completeCmd := &cobra.Command{
		Use:   "complete [session-id]",
		Short: "Complete a reconciliation session",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			sess, err := e.CompleteReconciliation(context.Background(), args[0])
			if err != nil {
				return err
			}
			return printJSON(sess)
		},
	}

	cmd.AddCommand(startCmd, resolveCmd, completeCmd)
	return cmd
}
```

**Step 6: Add 3 MCP tools for reconciliation**

Append to MCP tools in `mcp_server.go`:

```go
s.AddTool(mcp.NewTool("inv_reconcile_start",
	mcp.WithDescription("Start a reconciliation session for suspect items after a sweep"),
	mcp.WithString("trigger_ref", mcp.Required(), mcp.Description("External reference that caused the sweep")),
	mcp.WithString("node_id", mcp.Required(), mcp.Description("Node ID to reconcile")),
	mcp.WithString("actor", mcp.Required(), mcp.Description("Who is starting")),
), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	ref, _ := req.RequireString("trigger_ref")
	nodeID, _ := req.RequireString("node_id")
	actor, _ := req.RequireString("actor")

	sess, err := engine.StartReconciliation(ctx, ref, nodeID, actor)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return resultJSON(sess)
})

s.AddTool(mcp.NewTool("inv_reconcile_resolve",
	mcp.WithDescription("Resolve a suspect item within a reconciliation session"),
	mcp.WithString("session_id", mcp.Required(), mcp.Description("Session ID")),
	mcp.WithString("item_id", mcp.Required(), mcp.Description("Item ID to resolve")),
	mcp.WithString("decision", mcp.Required(), mcp.Description("Decision: re_verified, marked_broke, deferred")),
	mcp.WithString("evidence", mcp.Description("Evidence for the decision")),
	mcp.WithString("actor", mcp.Required(), mcp.Description("Who is resolving")),
), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	sessionID, _ := req.RequireString("session_id")
	itemID, _ := req.RequireString("item_id")
	decision, _ := req.RequireString("decision")
	evidence, _ := req.GetArguments()["evidence"].(string)
	actor, _ := req.RequireString("actor")

	entry, err := engine.ResolveItem(ctx, sessionID, itemID, decision, evidence, actor)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return resultJSON(entry)
})

s.AddTool(mcp.NewTool("inv_reconcile_complete",
	mcp.WithDescription("Complete a reconciliation session"),
	mcp.WithString("session_id", mcp.Required(), mcp.Description("Session ID to complete")),
), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	sessionID, _ := req.RequireString("session_id")

	sess, err := engine.CompleteReconciliation(ctx, sessionID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return resultJSON(sess)
})
```

**Step 7: Verify compilation**

Run: `go build ./...`
Expected: No errors.

**Step 8: Commit**

```bash
git add network.go store.go engine.go main.go mcp_server.go
git commit -m "feat: add reconciliation sessions with start/resolve/complete workflow"
```

---

## Task 5: Trace Up / Trace Down

**Files:**
- Modify: `engine.go` (add TraceChainEntry, TraceUp, TraceDown)
- Modify: `store.go` (add GetUpstreamTraces)
- Modify: `main.go` (replace trace show with up/down subcommands)
- Modify: `mcp_server.go` (add inv_trace_up, inv_trace_down)

**Step 1: Add GetUpstreamTraces to Store**

Append to `store.go`:

```go
func (s *Store) GetUpstreamTraces(ctx context.Context, itemID string) ([]Trace, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, from_item_id, from_node_id, to_item_id, to_node_id, relation, confirmed_by, confirmed_at, created_at
		 FROM traces WHERE from_item_id = ?`, itemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var traces []Trace
	for rows.Next() {
		var t Trace
		var confirmedAt sql.NullTime
		if err := rows.Scan(&t.ID, &t.FromItemID, &t.FromNodeID, &t.ToItemID, &t.ToNodeID, &t.Relation,
			&t.ConfirmedBy, &confirmedAt, &t.CreatedAt); err != nil {
			return nil, err
		}
		if confirmedAt.Valid {
			t.ConfirmedAt = &confirmedAt.Time
		}
		traces = append(traces, t)
	}
	return traces, rows.Err()
}
```

**Step 2: Add TraceChainEntry and Engine methods**

Append to `engine.go`:

```go
type TraceChainEntry struct {
	Depth    int           `json:"depth"`
	Item     Item          `json:"item"`
	Relation TraceRelation `json:"relation"`
}

func (e *Engine) TraceUp(ctx context.Context, itemID string) ([]TraceChainEntry, error) {
	visited := make(map[string]bool)
	return e.collectTraceUp(ctx, itemID, visited, 0)
}

func (e *Engine) collectTraceUp(ctx context.Context, itemID string, visited map[string]bool, depth int) ([]TraceChainEntry, error) {
	if visited[itemID] {
		return nil, nil
	}
	visited[itemID] = true

	traces, err := e.store.GetUpstreamTraces(ctx, itemID)
	if err != nil {
		return nil, err
	}

	var chain []TraceChainEntry
	for _, t := range traces {
		if visited[t.ToItemID] {
			continue
		}
		item, err := e.store.GetItem(ctx, t.ToItemID)
		if err != nil {
			return nil, err
		}
		chain = append(chain, TraceChainEntry{
			Depth:    depth + 1,
			Item:     *item,
			Relation: t.Relation,
		})

		deeper, err := e.collectTraceUp(ctx, t.ToItemID, visited, depth+1)
		if err != nil {
			return nil, err
		}
		chain = append(chain, deeper...)
	}
	return chain, nil
}

func (e *Engine) TraceDown(ctx context.Context, itemID string) ([]TraceChainEntry, error) {
	visited := make(map[string]bool)
	return e.collectTraceDown(ctx, itemID, visited, 0)
}

func (e *Engine) collectTraceDown(ctx context.Context, itemID string, visited map[string]bool, depth int) ([]TraceChainEntry, error) {
	if visited[itemID] {
		return nil, nil
	}
	visited[itemID] = true

	traces, err := e.store.GetDependentTraces(ctx, itemID)
	if err != nil {
		return nil, err
	}

	var chain []TraceChainEntry
	for _, t := range traces {
		if visited[t.FromItemID] {
			continue
		}
		item, err := e.store.GetItem(ctx, t.FromItemID)
		if err != nil {
			return nil, err
		}
		chain = append(chain, TraceChainEntry{
			Depth:    depth + 1,
			Item:     *item,
			Relation: t.Relation,
		})

		deeper, err := e.collectTraceDown(ctx, t.FromItemID, visited, depth+1)
		if err != nil {
			return nil, err
		}
		chain = append(chain, deeper...)
	}
	return chain, nil
}
```

**Step 3: Replace trace show with up/down in CLI**

In `main.go`, replace the `showCmd` inside `traceCmd` with `upCmd` and `downCmd`:

```go
upCmd := &cobra.Command{
	Use:   "up [item-id]",
	Short: "Show what this item depends on (upstream trace chain)",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		chain, err := e.TraceUp(context.Background(), args[0])
		if err != nil {
			return err
		}
		return printJSON(chain)
	},
}

downCmd := &cobra.Command{
	Use:   "down [item-id]",
	Short: "Show what depends on this item (downstream trace chain)",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		chain, err := e.TraceDown(context.Background(), args[0])
		if err != nil {
			return err
		}
		return printJSON(chain)
	},
}

cmd.AddCommand(addCmd, upCmd, downCmd)
```

**Step 4: Add MCP tools for trace up/down**

Append to MCP tools in `mcp_server.go`:

```go
s.AddTool(mcp.NewTool("inv_trace_up",
	mcp.WithDescription("Show what this item depends on — walks upstream through the trace graph"),
	mcp.WithString("item_id", mcp.Required(), mcp.Description("Item ID to trace upstream")),
), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	itemID, _ := req.RequireString("item_id")

	chain, err := engine.TraceUp(ctx, itemID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return resultJSON(chain)
})

s.AddTool(mcp.NewTool("inv_trace_down",
	mcp.WithDescription("Show what depends on this item — walks downstream through the trace graph"),
	mcp.WithString("item_id", mcp.Required(), mcp.Description("Item ID to trace downstream")),
), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	itemID, _ := req.RequireString("item_id")

	chain, err := engine.TraceDown(ctx, itemID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return resultJSON(chain)
})
```

**Step 5: Verify compilation**

Run: `go build ./...`
Expected: No errors.

**Step 6: Commit**

```bash
git add engine.go store.go main.go mcp_server.go
git commit -m "feat: add trace up/down commands for directional graph traversal"
```

---

## Task 6: Dual Zerolog Output

**Files:**
- Modify: `go.mod` (add zerolog dependency)
- Modify: `graph.go` (add AppConfig fields, SystemLogger, AgentLogger providers)
- Modify: `engine.go` (accept loggers in Engine)
- Modify: `main.go` (refactor all commands to use dual loggers)
- Modify: `mcp_server.go` (use agent logger for results)
- Modify: `signal.go` (use system logger for propagation diagnostics)

**Step 1: Add zerolog dependency**

Run: `go get github.com/rs/zerolog`

**Step 2: Update AppConfig and add logger providers in graph.go**

Replace `graph.go` entirely:

```go
package main

import (
	"fmt"
	"os"

	pumped "github.com/pumped-fn/pumped-go"
	"github.com/rs/zerolog"
)

type AppConfig struct {
	DBPath      string
	Project     string
	SystemLevel zerolog.Level
	AgentLevel  zerolog.Level
}

var Config = pumped.Provide(func(ctx *pumped.ResolveCtx) (*AppConfig, error) {
	return &AppConfig{
		DBPath:      "inventory.db",
		Project:     "clinic-checkin",
		SystemLevel: zerolog.InfoLevel,
		AgentLevel:  zerolog.InfoLevel,
	}, nil
})

var SystemLog = pumped.Derive1(
	Config,
	func(ctx *pumped.ResolveCtx, cfgCtrl *pumped.Controller[*AppConfig]) (*zerolog.Logger, error) {
		cfg, err := cfgCtrl.Get()
		if err != nil {
			return nil, fmt.Errorf("failed to get config: %w", err)
		}
		logger := zerolog.New(os.Stderr).With().Timestamp().Str("source", "system").Logger().Level(cfg.SystemLevel)
		return &logger, nil
	},
)

var AgentLog = pumped.Derive1(
	Config,
	func(ctx *pumped.ResolveCtx, cfgCtrl *pumped.Controller[*AppConfig]) (*zerolog.Logger, error) {
		cfg, err := cfgCtrl.Get()
		if err != nil {
			return nil, fmt.Errorf("failed to get config: %w", err)
		}
		logger := zerolog.New(os.Stdout).With().Str("source", "agent").Logger().Level(cfg.AgentLevel)
		return &logger, nil
	},
)

var DBStore = pumped.Derive1(
	Config,
	func(ctx *pumped.ResolveCtx, cfgCtrl *pumped.Controller[*AppConfig]) (*Store, error) {
		cfg, err := cfgCtrl.Get()
		if err != nil {
			return nil, fmt.Errorf("failed to get config: %w", err)
		}

		store, err := NewStore(cfg.DBPath)
		if err != nil {
			return nil, fmt.Errorf("failed to open store: %w", err)
		}

		ctx.OnCleanup(func() error {
			return store.Close()
		})

		return store, nil
	},
)

var ItemStateMachine = pumped.Provide(func(ctx *pumped.ResolveCtx) (*StateMachine, error) {
	return NewStateMachine(), nil
})

var CRStateMachineExec = pumped.Provide(func(ctx *pumped.ResolveCtx) (*CRStateMachine, error) {
	return NewCRStateMachine(), nil
})

var Propagator = pumped.Derive2(
	DBStore,
	ItemStateMachine,
	func(ctx *pumped.ResolveCtx, storeCtrl *pumped.Controller[*Store], smCtrl *pumped.Controller[*StateMachine]) (*SignalPropagator, error) {
		store, err := storeCtrl.Get()
		if err != nil {
			return nil, fmt.Errorf("failed to get store: %w", err)
		}
		sm, err := smCtrl.Get()
		if err != nil {
			return nil, fmt.Errorf("failed to get state machine: %w", err)
		}
		return NewSignalPropagator(store, sm), nil
	},
)

var NetworkEngine = pumped.Derive3(
	DBStore,
	Propagator,
	CRStateMachineExec,
	func(ctx *pumped.ResolveCtx, storeCtrl *pumped.Controller[*Store], propCtrl *pumped.Controller[*SignalPropagator], crsmCtrl *pumped.Controller[*CRStateMachine]) (*Engine, error) {
		store, err := storeCtrl.Get()
		if err != nil {
			return nil, fmt.Errorf("failed to get store: %w", err)
		}
		prop, err := propCtrl.Get()
		if err != nil {
			return nil, fmt.Errorf("failed to get propagator: %w", err)
		}
		crsm, err := crsmCtrl.Get()
		if err != nil {
			return nil, fmt.Errorf("failed to get CR state machine: %w", err)
		}
		return NewEngine(store, prop, crsm), nil
	},
)
```

**Step 3: Refactor main.go**

Key changes:
- Resolve `AgentLog` and `SystemLog` from scope alongside `NetworkEngine`
- Pass both loggers to each command function
- Replace all `fmt.Printf` / `tabwriter` / `printJSON` calls with `agentLog.Info().RawJSON("data", ...).Str("command", "...").Msg("...")`
- Replace all `fmt.Fprintf(os.Stderr, ...)` with `sysLog.Error().Err(err).Msg("...")`
- Remove `printJSON` function, remove `"text/tabwriter"` import
- Keep `"encoding/json"` for marshaling data into RawJSON

Example pattern for a command:

```go
func nodeCmd(e *Engine, agentLog, sysLog *zerolog.Logger) *cobra.Command {
	// ...
	listCmd := &cobra.Command{
		Use:   "list",
		Short: "List all nodes in the network",
		RunE: func(cmd *cobra.Command, args []string) error {
			project, _ := cmd.Flags().GetString("project")
			nodes, err := e.ListNodes(context.Background(), project)
			if err != nil {
				sysLog.Error().Err(err).Str("project", project).Msg("failed to list nodes")
				return err
			}
			data, _ := json.Marshal(nodes)
			agentLog.Info().RawJSON("data", data).Str("command", "node.list").Msg("nodes listed")
			return nil
		},
	}
	// ...
}
```

Apply this pattern to ALL command functions: `nodeCmd`, `itemCmd`, `traceCmd`, `verifyCmd`, `impactCmd`, `auditCmd`, `crCmd`, `askCmd`, `queryCmd`, `sweepCmd`, `reconcileCmd`.

Update `main()`:

```go
func main() {
	scope := pumped.NewScope()
	defer scope.Dispose()

	engine, err := pumped.Resolve(scope, NetworkEngine)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to resolve engine: %v\n", err)
		os.Exit(1)
	}

	agentLog, err := pumped.Resolve(scope, AgentLog)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to resolve agent logger: %v\n", err)
		os.Exit(1)
	}

	sysLog, err := pumped.Resolve(scope, SystemLog)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to resolve system logger: %v\n", err)
		os.Exit(1)
	}

	root := &cobra.Command{
		Use:   "inv",
		Short: "Inventory Network — a distributed inventory protocol for teams and AI agents",
	}

	root.AddCommand(
		nodeCmd(engine, agentLog, sysLog),
		itemCmd(engine, agentLog, sysLog),
		traceCmd(engine, agentLog, sysLog),
		verifyCmd(engine, agentLog, sysLog),
		impactCmd(engine, agentLog, sysLog),
		auditCmd(engine, agentLog, sysLog),
		crCmd(engine, agentLog, sysLog),
		askCmd(engine, agentLog, sysLog),
		queryCmd(engine, agentLog, sysLog),
		sweepCmd(engine, agentLog, sysLog),
		reconcileCmd(engine, agentLog, sysLog),
		mcpCmd(scope),
	)

	if err := root.Execute(); err != nil {
		sysLog.Error().Err(err).Msg("command failed")
		os.Exit(1)
	}
}
```

**Step 4: Update mcp_server.go**

No tabwriter changes needed (already JSON). Keep `resultJSON` helper as-is — MCP protocol handles its own output format.

**Step 5: Remove dead code**

- Delete `printJSON` function from `main.go`
- Remove `"text/tabwriter"` import from `main.go`

**Step 6: Verify compilation**

Run: `go build ./...`
Expected: No errors.

**Step 7: Commit**

```bash
git add go.mod go.sum graph.go main.go engine.go signal.go mcp_server.go
git commit -m "refactor: dual zerolog output — agent (stdout) and system (stderr)"
```

---

## Task 7: Tests Layer 1 — State Machine Unit Tests

**Files:**
- Create: `state_test.go`

**Step 1: Write item state machine tests**

```go
package main

import (
	"testing"
	"time"
)

func TestStateMachine_VerifyFromUnverified(t *testing.T) {
	sm := NewStateMachine()
	transition := Transition{
		Kind:      TransitionVerify,
		From:      StatusUnverified,
		Evidence:  "test passed",
		Actor:     "tester",
		Timestamp: time.Now(),
	}
	got, err := sm.Apply(transition)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != StatusProven {
		t.Errorf("got %s, want %s", got, StatusProven)
	}
}

func TestStateMachine_SuspectFromProven(t *testing.T) {
	sm := NewStateMachine()
	transition := Transition{
		Kind:      TransitionSuspect,
		From:      StatusProven,
		Reason:    "upstream changed",
		Actor:     "system",
		Timestamp: time.Now(),
	}
	got, err := sm.Apply(transition)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != StatusSuspect {
		t.Errorf("got %s, want %s", got, StatusSuspect)
	}
}

func TestStateMachine_ReVerifyFromSuspect(t *testing.T) {
	sm := NewStateMachine()
	transition := Transition{
		Kind:      TransitionReVerify,
		From:      StatusSuspect,
		Evidence:  "re-tested",
		Reason:    "still valid",
		Actor:     "tester",
		Timestamp: time.Now(),
	}
	got, err := sm.Apply(transition)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != StatusProven {
		t.Errorf("got %s, want %s", got, StatusProven)
	}
}

func TestStateMachine_BreakFromSuspect(t *testing.T) {
	sm := NewStateMachine()
	transition := Transition{
		Kind:      TransitionBreak,
		From:      StatusSuspect,
		Reason:    "confirmed broken",
		Actor:     "tester",
		Timestamp: time.Now(),
	}
	got, err := sm.Apply(transition)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != StatusBroke {
		t.Errorf("got %s, want %s", got, StatusBroke)
	}
}

func TestStateMachine_FixFromBroke(t *testing.T) {
	sm := NewStateMachine()
	transition := Transition{
		Kind:      TransitionFix,
		From:      StatusBroke,
		Evidence:  "fixed and tested",
		Reason:    "bug resolved",
		Actor:     "dev",
		Timestamp: time.Now(),
	}
	got, err := sm.Apply(transition)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != StatusProven {
		t.Errorf("got %s, want %s", got, StatusProven)
	}
}

func TestStateMachine_InvalidTransition(t *testing.T) {
	sm := NewStateMachine()
	tests := []struct {
		name string
		from ItemStatus
		kind TransitionKind
	}{
		{"unverified to broke", StatusUnverified, TransitionBreak},
		{"proven to proven", StatusProven, TransitionVerify},
		{"broke to suspect", StatusBroke, TransitionSuspect},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			transition := Transition{
				Kind:      tt.kind,
				From:      tt.from,
				Reason:    "test",
				Evidence:  "test",
				Actor:     "test",
				Timestamp: time.Now(),
			}
			_, err := sm.Apply(transition)
			if err == nil {
				t.Error("expected error for invalid transition")
			}
		})
	}
}

func TestStateMachine_MissingEvidence(t *testing.T) {
	sm := NewStateMachine()
	transition := Transition{
		Kind:      TransitionVerify,
		From:      StatusUnverified,
		Evidence:  "",
		Actor:     "tester",
		Timestamp: time.Now(),
	}
	_, err := sm.Apply(transition)
	if err == nil {
		t.Error("expected error for missing evidence")
	}
}

func TestStateMachine_MissingActor(t *testing.T) {
	sm := NewStateMachine()
	transition := Transition{
		Kind:      TransitionVerify,
		From:      StatusUnverified,
		Evidence:  "proof",
		Actor:     "",
		Timestamp: time.Now(),
	}
	_, err := sm.Apply(transition)
	if err == nil {
		t.Error("expected error for missing actor")
	}
}

func TestCRStateMachine_FullLifecycle(t *testing.T) {
	sm := NewCRStateMachine()

	steps := []struct {
		from CRStatus
		kind CRTransitionKind
		want CRStatus
	}{
		{CRDraft, CRSubmit, CRProposed},
		{CRProposed, CROpen, CRVoting},
		{CRVoting, CRApprove, CRApproved},
		{CRApproved, CRApplyT, CRApplied},
		{CRApplied, CRArchive, CRArchived},
	}

	current := CRDraft
	for _, step := range steps {
		if current != step.from {
			t.Fatalf("expected current=%s, got %s", step.from, current)
		}
		got, err := sm.Apply(current, step.kind)
		if err != nil {
			t.Fatalf("step %s->%s: %v", step.from, step.want, err)
		}
		if got != step.want {
			t.Errorf("step %s: got %s, want %s", step.kind, got, step.want)
		}
		current = got
	}
}

func TestCRStateMachine_RejectPath(t *testing.T) {
	sm := NewCRStateMachine()

	got, err := sm.Apply(CRVoting, CRReject)
	if err != nil {
		t.Fatalf("reject: %v", err)
	}
	if got != CRRejected {
		t.Errorf("got %s, want %s", got, CRRejected)
	}

	got, err = sm.Apply(CRRejected, CRArchive)
	if err != nil {
		t.Fatalf("archive: %v", err)
	}
	if got != CRArchived {
		t.Errorf("got %s, want %s", got, CRArchived)
	}
}

func TestCRStateMachine_InvalidTransition(t *testing.T) {
	sm := NewCRStateMachine()
	_, err := sm.Apply(CRDraft, CRApprove)
	if err == nil {
		t.Error("expected error for invalid CR transition")
	}
}
```

**Step 2: Run tests**

Run: `go test -run TestStateMachine -v ./...`
Run: `go test -run TestCRStateMachine -v ./...`
Expected: All PASS.

**Step 3: Commit**

```bash
git add state_test.go
git commit -m "test: add unit tests for item and CR state machines"
```

---

## Task 8: Tests Layer 2 — Store Integration Tests

**Files:**
- Create: `store_test.go`

**Step 1: Write test helper and store tests**

```go
package main

import (
	"context"
	"testing"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := NewStore(":memory:")
	if err != nil {
		t.Fatalf("create test store: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	return store
}

func createTestNode(t *testing.T, s *Store, name string, vertical Vertical) *Node {
	t.Helper()
	n := &Node{Name: name, Vertical: vertical, Project: "test-project", Owner: "tester"}
	if err := s.CreateNode(context.Background(), n); err != nil {
		t.Fatalf("create node: %v", err)
	}
	return n
}

func createTestItem(t *testing.T, s *Store, nodeID, title string, ref string) *Item {
	t.Helper()
	item := &Item{NodeID: nodeID, Kind: KindADR, Title: title, Body: "body", ExternalRef: ref}
	if err := s.CreateItem(context.Background(), item); err != nil {
		t.Fatalf("create item: %v", err)
	}
	return item
}

func TestStore_NodeCRUD(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	node := createTestNode(t, s, "dev-node", VerticalDev)

	got, err := s.GetNode(ctx, node.ID)
	if err != nil {
		t.Fatalf("get node: %v", err)
	}
	if got.Name != "dev-node" {
		t.Errorf("got name %q, want %q", got.Name, "dev-node")
	}

	nodes, err := s.ListNodes(ctx, "test-project")
	if err != nil {
		t.Fatalf("list nodes: %v", err)
	}
	if len(nodes) != 1 {
		t.Errorf("got %d nodes, want 1", len(nodes))
	}
}

func TestStore_ItemCRUD(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	node := createTestNode(t, s, "dev-node", VerticalDev)
	item := createTestItem(t, s, node.ID, "Test ADR", "US-001")

	got, err := s.GetItem(ctx, item.ID)
	if err != nil {
		t.Fatalf("get item: %v", err)
	}
	if got.Title != "Test ADR" {
		t.Errorf("got title %q, want %q", got.Title, "Test ADR")
	}
	if got.ExternalRef != "US-001" {
		t.Errorf("got ref %q, want %q", got.ExternalRef, "US-001")
	}
	if got.Status != StatusUnverified {
		t.Errorf("got status %q, want %q", got.Status, StatusUnverified)
	}

	items, err := s.ListItems(ctx, node.ID)
	if err != nil {
		t.Fatalf("list items: %v", err)
	}
	if len(items) != 1 {
		t.Errorf("got %d items, want 1", len(items))
	}
}

func TestStore_ItemUpdateWithEvidence(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	node := createTestNode(t, s, "dev-node", VerticalDev)
	item := createTestItem(t, s, node.ID, "Test ADR", "")

	err := s.UpdateItemWithEvidence(ctx, item.ID, StatusProven, "test passed", "tester")
	if err != nil {
		t.Fatalf("update: %v", err)
	}

	got, _ := s.GetItem(ctx, item.ID)
	if got.Status != StatusProven {
		t.Errorf("got status %q, want %q", got.Status, StatusProven)
	}
	if got.Version != 2 {
		t.Errorf("got version %d, want 2", got.Version)
	}
}

func TestStore_TraceCRUD(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	node := createTestNode(t, s, "dev-node", VerticalDev)
	item1 := createTestItem(t, s, node.ID, "ADR-1", "")
	item2 := createTestItem(t, s, node.ID, "ADR-2", "")

	trace := &Trace{
		FromItemID: item1.ID, FromNodeID: node.ID,
		ToItemID: item2.ID, ToNodeID: node.ID,
		Relation: RelationTracedFrom, ConfirmedBy: "tester",
	}
	if err := s.CreateTrace(ctx, trace); err != nil {
		t.Fatalf("create trace: %v", err)
	}

	downstream, err := s.GetDependentTraces(ctx, item2.ID)
	if err != nil {
		t.Fatalf("get dependents: %v", err)
	}
	if len(downstream) != 1 {
		t.Errorf("got %d dependents, want 1", len(downstream))
	}

	upstream, err := s.GetUpstreamTraces(ctx, item1.ID)
	if err != nil {
		t.Fatalf("get upstream: %v", err)
	}
	if len(upstream) != 1 {
		t.Errorf("got %d upstream, want 1", len(upstream))
	}
}

func TestStore_FindItemsByExternalRef(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	node := createTestNode(t, s, "dev-node", VerticalDev)
	createTestItem(t, s, node.ID, "ADR tagged", "US-003")
	createTestItem(t, s, node.ID, "ADR not tagged", "")
	createTestItem(t, s, node.ID, "ADR also tagged", "US-003")

	items, err := s.FindItemsByExternalRef(ctx, "US-003")
	if err != nil {
		t.Fatalf("find by ref: %v", err)
	}
	if len(items) != 2 {
		t.Errorf("got %d items, want 2", len(items))
	}
}

func TestStore_QueryItems(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	node := createTestNode(t, s, "dev-node", VerticalDev)
	createTestItem(t, s, node.ID, "WebSocket ADR", "US-001")
	createTestItem(t, s, node.ID, "REST API Spec", "US-002")

	tests := []struct {
		name   string
		filter QueryFilter
		want   int
	}{
		{"text match", QueryFilter{Text: "WebSocket"}, 1},
		{"text no match", QueryFilter{Text: "GraphQL"}, 0},
		{"by ref", QueryFilter{ExternalRef: "US-001"}, 1},
		{"all items", QueryFilter{}, 2},
		{"combined", QueryFilter{Text: "API", ExternalRef: "US-002"}, 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			items, err := s.QueryItems(ctx, tt.filter)
			if err != nil {
				t.Fatalf("query: %v", err)
			}
			if len(items) != tt.want {
				t.Errorf("got %d items, want %d", len(items), tt.want)
			}
		})
	}
}

func TestStore_ReconciliationSessionCRUD(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	node := createTestNode(t, s, "dev-node", VerticalDev)
	item := createTestItem(t, s, node.ID, "Suspect item", "")

	sess := &ReconciliationSession{
		TriggerRef: "US-003",
		NodeID:     node.ID,
		StartedBy:  "tester",
	}
	if err := s.CreateReconciliationSession(ctx, sess); err != nil {
		t.Fatalf("create session: %v", err)
	}

	entry := &ReconciliationEntry{
		SessionID: sess.ID,
		ItemID:    item.ID,
		Decision:  "re_verified",
		Evidence:  "still good",
		Actor:     "tester",
	}
	if err := s.CreateReconciliationEntry(ctx, entry); err != nil {
		t.Fatalf("create entry: %v", err)
	}

	got, err := s.GetReconciliationSession(ctx, sess.ID)
	if err != nil {
		t.Fatalf("get session: %v", err)
	}
	if got.Status != "open" {
		t.Errorf("got status %q, want %q", got.Status, "open")
	}
	if len(got.Entries) != 1 {
		t.Errorf("got %d entries, want 1", len(got.Entries))
	}

	if err := s.CompleteReconciliationSession(ctx, sess.ID); err != nil {
		t.Fatalf("complete: %v", err)
	}

	got, _ = s.GetReconciliationSession(ctx, sess.ID)
	if got.Status != "completed" {
		t.Errorf("got status %q, want %q", got.Status, "completed")
	}
}
```

**Step 2: Run tests**

Run: `go test -run TestStore -v ./...`
Expected: All PASS.

**Step 3: Commit**

```bash
git add store_test.go
git commit -m "test: add store integration tests with in-memory SQLite"
```

---

## Task 9: Tests Layer 3 — Engine Integration Tests

**Files:**
- Create: `engine_test.go`

**Step 1: Write engine test helper and tests**

```go
package main

import (
	"context"
	"testing"
)

func newTestEngine(t *testing.T) *Engine {
	t.Helper()
	store := newTestStore(t)
	sm := NewStateMachine()
	prop := NewSignalPropagator(store, sm)
	crsm := NewCRStateMachine()
	return NewEngine(store, prop, crsm)
}

func TestEngine_PropagationSingleHop(t *testing.T) {
	e := newTestEngine(t)
	ctx := context.Background()

	node, _ := e.RegisterNode(ctx, "dev", VerticalDev, "proj", "owner", false)
	upstream, _ := e.AddItem(ctx, node.ID, KindADR, "Upstream", "", "")
	downstream, _ := e.AddItem(ctx, node.ID, KindADR, "Downstream", "", "")

	e.AddTrace(ctx, downstream.ID, upstream.ID, RelationTracedFrom, "tester")

	// Verify both items first
	e.VerifyItem(ctx, upstream.ID, "proof", "tester")
	e.VerifyItem(ctx, downstream.ID, "proof", "tester")

	// Now verify upstream again — should propagate suspect to downstream
	e.VerifyItem(ctx, upstream.ID, "updated proof", "tester")
	signals, _ := e.PropagateChange(ctx, upstream.ID)

	got, _ := e.GetItem(ctx, downstream.ID)
	if got.Status != StatusSuspect {
		t.Errorf("got status %q, want %q", got.Status, StatusSuspect)
	}
	_ = signals // signals may be empty if already propagated by VerifyItem
}

func TestEngine_PropagationMultiHop(t *testing.T) {
	e := newTestEngine(t)
	ctx := context.Background()

	node, _ := e.RegisterNode(ctx, "dev", VerticalDev, "proj", "owner", false)
	a, _ := e.AddItem(ctx, node.ID, KindADR, "A", "", "")
	b, _ := e.AddItem(ctx, node.ID, KindADR, "B", "", "")
	c, _ := e.AddItem(ctx, node.ID, KindADR, "C", "", "")

	// C traces from B, B traces from A
	e.AddTrace(ctx, b.ID, a.ID, RelationTracedFrom, "t")
	e.AddTrace(ctx, c.ID, b.ID, RelationTracedFrom, "t")

	// Verify all
	e.VerifyItem(ctx, a.ID, "proof", "t")
	e.VerifyItem(ctx, b.ID, "proof", "t")
	e.VerifyItem(ctx, c.ID, "proof", "t")

	// Change at A should propagate to B and C
	signals, _ := e.PropagateChange(ctx, a.ID)
	if len(signals) < 2 {
		t.Errorf("got %d signals, want at least 2", len(signals))
	}

	gotB, _ := e.GetItem(ctx, b.ID)
	gotC, _ := e.GetItem(ctx, c.ID)
	if gotB.Status != StatusSuspect {
		t.Errorf("B: got %q, want suspect", gotB.Status)
	}
	if gotC.Status != StatusSuspect {
		t.Errorf("C: got %q, want suspect", gotC.Status)
	}
}

func TestEngine_PropagationSkipsNonProven(t *testing.T) {
	e := newTestEngine(t)
	ctx := context.Background()

	node, _ := e.RegisterNode(ctx, "dev", VerticalDev, "proj", "owner", false)
	a, _ := e.AddItem(ctx, node.ID, KindADR, "A", "", "")
	b, _ := e.AddItem(ctx, node.ID, KindADR, "B", "", "")

	e.AddTrace(ctx, b.ID, a.ID, RelationTracedFrom, "t")

	// Only verify A, leave B as unverified
	e.VerifyItem(ctx, a.ID, "proof", "t")

	signals, _ := e.PropagateChange(ctx, a.ID)
	if len(signals) != 0 {
		t.Errorf("got %d signals, want 0 (B is unverified)", len(signals))
	}
}

func TestEngine_Sweep(t *testing.T) {
	e := newTestEngine(t)
	ctx := context.Background()

	pmNode, _ := e.RegisterNode(ctx, "pm", VerticalPM, "proj", "pm-owner", false)
	devNode, _ := e.RegisterNode(ctx, "dev", VerticalDev, "proj", "dev-owner", false)

	userStory, _ := e.AddItem(ctx, pmNode.ID, KindUserStory, "US-003 Check-in Flow", "", "US-003")
	adr, _ := e.AddItem(ctx, devNode.ID, KindADR, "WebSocket ADR", "", "")

	e.AddTrace(ctx, adr.ID, userStory.ID, RelationTracedFrom, "dev")

	e.VerifyItem(ctx, userStory.ID, "approved", "pm")
	e.VerifyItem(ctx, adr.ID, "designed", "dev")

	result, err := e.Sweep(ctx, "US-003")
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if len(result.MatchedItems) != 1 {
		t.Errorf("matched: got %d, want 1", len(result.MatchedItems))
	}
	if len(result.AffectedItems) < 1 {
		t.Errorf("affected: got %d, want at least 1", len(result.AffectedItems))
	}
}

func TestEngine_ReconciliationWorkflow(t *testing.T) {
	e := newTestEngine(t)
	ctx := context.Background()

	node, _ := e.RegisterNode(ctx, "dev", VerticalDev, "proj", "owner", false)
	item, _ := e.AddItem(ctx, node.ID, KindADR, "ADR-1", "", "")

	// Verify then make suspect
	e.VerifyItem(ctx, item.ID, "proof", "tester")
	e.store.UpdateItemStatus(ctx, item.ID, StatusSuspect)

	sess, err := e.StartReconciliation(ctx, "US-003", node.ID, "tester")
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if sess.Status != "open" {
		t.Errorf("got status %q, want open", sess.Status)
	}

	entry, err := e.ResolveItem(ctx, sess.ID, item.ID, "re_verified", "re-tested OK", "tester")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if entry.Decision != "re_verified" {
		t.Errorf("got decision %q, want re_verified", entry.Decision)
	}

	got, _ := e.GetItem(ctx, item.ID)
	if got.Status != StatusProven {
		t.Errorf("got status %q, want proven", got.Status)
	}

	completed, err := e.CompleteReconciliation(ctx, sess.ID)
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if completed.Status != "completed" {
		t.Errorf("got status %q, want completed", completed.Status)
	}
}

func TestEngine_TraceUp(t *testing.T) {
	e := newTestEngine(t)
	ctx := context.Background()

	pm, _ := e.RegisterNode(ctx, "pm", VerticalPM, "proj", "pm", false)
	dev, _ := e.RegisterNode(ctx, "dev", VerticalDev, "proj", "dev", false)

	story, _ := e.AddItem(ctx, pm.ID, KindUserStory, "US-003", "", "")
	adr, _ := e.AddItem(ctx, dev.ID, KindADR, "ADR", "", "")

	e.AddTrace(ctx, adr.ID, story.ID, RelationTracedFrom, "dev")

	chain, err := e.TraceUp(ctx, adr.ID)
	if err != nil {
		t.Fatalf("trace up: %v", err)
	}
	if len(chain) != 1 {
		t.Fatalf("got %d entries, want 1", len(chain))
	}
	if chain[0].Item.ID != story.ID {
		t.Errorf("got item %s, want %s", chain[0].Item.ID, story.ID)
	}
	if chain[0].Depth != 1 {
		t.Errorf("got depth %d, want 1", chain[0].Depth)
	}
}

func TestEngine_TraceDown(t *testing.T) {
	e := newTestEngine(t)
	ctx := context.Background()

	pm, _ := e.RegisterNode(ctx, "pm", VerticalPM, "proj", "pm", false)
	dev, _ := e.RegisterNode(ctx, "dev", VerticalDev, "proj", "dev", false)

	story, _ := e.AddItem(ctx, pm.ID, KindUserStory, "US-003", "", "")
	adr, _ := e.AddItem(ctx, dev.ID, KindADR, "ADR", "", "")

	e.AddTrace(ctx, adr.ID, story.ID, RelationTracedFrom, "dev")

	chain, err := e.TraceDown(ctx, story.ID)
	if err != nil {
		t.Fatalf("trace down: %v", err)
	}
	if len(chain) != 1 {
		t.Fatalf("got %d entries, want 1", len(chain))
	}
	if chain[0].Item.ID != adr.ID {
		t.Errorf("got item %s, want %s", chain[0].Item.ID, adr.ID)
	}
}

func TestEngine_TraceUpDeepChain(t *testing.T) {
	e := newTestEngine(t)
	ctx := context.Background()

	node, _ := e.RegisterNode(ctx, "dev", VerticalDev, "proj", "dev", false)
	a, _ := e.AddItem(ctx, node.ID, KindADR, "A", "", "")
	b, _ := e.AddItem(ctx, node.ID, KindADR, "B", "", "")
	c, _ := e.AddItem(ctx, node.ID, KindADR, "C", "", "")

	// C -> B -> A (traces from)
	e.AddTrace(ctx, c.ID, b.ID, RelationTracedFrom, "t")
	e.AddTrace(ctx, b.ID, a.ID, RelationTracedFrom, "t")

	chain, err := e.TraceUp(ctx, c.ID)
	if err != nil {
		t.Fatalf("trace up: %v", err)
	}
	if len(chain) != 2 {
		t.Fatalf("got %d entries, want 2", len(chain))
	}
	// B at depth 1, A at depth 2
	if chain[0].Depth != 1 {
		t.Errorf("first entry depth: got %d, want 1", chain[0].Depth)
	}
	if chain[1].Depth != 2 {
		t.Errorf("second entry depth: got %d, want 2", chain[1].Depth)
	}
}
```

**Step 2: Run tests**

Run: `go test -run TestEngine -v ./...`
Expected: All PASS.

**Step 3: Commit**

```bash
git add engine_test.go
git commit -m "test: add engine integration tests for propagation, sweep, reconcile, trace"
```

---

## Task 10: Tests Layer 4 — Scenario Tests

**Files:**
- Create: `scenario_test.go`

**Step 1: Write full workflow scenario tests**

```go
package main

import (
	"context"
	"testing"
)

func TestScenario_PMChangesSpec(t *testing.T) {
	e := newTestEngine(t)
	ctx := context.Background()

	// Setup: PM and Dev nodes
	pm, _ := e.RegisterNode(ctx, "pm-node", VerticalPM, "clinic-checkin", "pm-lead", false)
	dev, _ := e.RegisterNode(ctx, "dev-node", VerticalDev, "clinic-checkin", "dev-lead", false)

	// PM adds user story with external ref
	us, _ := e.AddItem(ctx, pm.ID, KindUserStory, "Check-in flow redesign", "User can check in via kiosk", "US-003")
	e.VerifyItem(ctx, us.ID, "Product approved", "pm-lead")

	// Dev traces ADR and API spec from the user story
	adr, _ := e.AddItem(ctx, dev.ID, KindADR, "WebSocket for real-time updates", "", "")
	api, _ := e.AddItem(ctx, dev.ID, KindAPISpec, "Check-in API v2", "", "")
	e.AddTrace(ctx, adr.ID, us.ID, RelationTracedFrom, "dev-lead")
	e.AddTrace(ctx, api.ID, us.ID, RelationTracedFrom, "dev-lead")
	e.VerifyItem(ctx, adr.ID, "Design reviewed", "dev-lead")
	e.VerifyItem(ctx, api.ID, "Spec reviewed", "dev-lead")

	// PM changes the user story — sweep by external ref
	result, err := e.Sweep(ctx, "US-003")
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if len(result.MatchedItems) != 1 {
		t.Errorf("matched: got %d, want 1", len(result.MatchedItems))
	}

	// Dev's items should now be suspect
	gotADR, _ := e.GetItem(ctx, adr.ID)
	gotAPI, _ := e.GetItem(ctx, api.ID)
	if gotADR.Status != StatusSuspect {
		t.Errorf("ADR status: got %q, want suspect", gotADR.Status)
	}
	if gotAPI.Status != StatusSuspect {
		t.Errorf("API status: got %q, want suspect", gotAPI.Status)
	}

	// Dev reconciles
	sess, _ := e.StartReconciliation(ctx, "US-003", dev.ID, "dev-lead")
	e.ResolveItem(ctx, sess.ID, adr.ID, "re_verified", "Still valid after spec change", "dev-lead")
	e.ResolveItem(ctx, sess.ID, api.ID, "marked_broke", "API needs v3 endpoint", "dev-lead")
	completed, _ := e.CompleteReconciliation(ctx, sess.ID)

	if completed.Status != "completed" {
		t.Errorf("session status: got %q, want completed", completed.Status)
	}
	if len(completed.Entries) != 2 {
		t.Errorf("entries: got %d, want 2", len(completed.Entries))
	}

	// Verify final states
	gotADR, _ = e.GetItem(ctx, adr.ID)
	gotAPI, _ = e.GetItem(ctx, api.ID)
	if gotADR.Status != StatusProven {
		t.Errorf("ADR final: got %q, want proven", gotADR.Status)
	}
	if gotAPI.Status != StatusBroke {
		t.Errorf("API final: got %q, want broke", gotAPI.Status)
	}
}

func TestScenario_CrossTeamCR(t *testing.T) {
	e := newTestEngine(t)
	ctx := context.Background()

	dev, _ := e.RegisterNode(ctx, "dev-node", VerticalDev, "clinic-checkin", "dev-lead", false)
	pm, _ := e.RegisterNode(ctx, "pm-node", VerticalPM, "clinic-checkin", "pm-lead", false)
	qa, _ := e.RegisterNode(ctx, "qa-node", VerticalQA, "clinic-checkin", "qa-lead", false)

	// Dev creates a CR
	cr, err := e.CreateCR(ctx, "Switch to WebSocket", "Replace polling with WebSocket for real-time", "dev-lead", dev.ID, nil)
	if err != nil {
		t.Fatalf("create CR: %v", err)
	}
	if cr.Status != CRDraft {
		t.Errorf("got status %q, want draft", cr.Status)
	}

	// Submit and open voting
	e.SubmitCR(ctx, cr.ID)
	e.OpenVoting(ctx, cr.ID)

	// PM and QA vote
	e.CastVote(ctx, cr.ID, pm.ID, "pm-lead", VoteApprove, "Aligns with product goals", false)
	e.CastVote(ctx, cr.ID, qa.ID, "qa-lead", VoteApprove, "Test plan looks solid", false)

	// Resolve
	err = e.ResolveCR(ctx, cr.ID)
	if err != nil {
		t.Fatalf("resolve CR: %v", err)
	}

	got, _ := e.store.GetChangeRequest(ctx, cr.ID)
	if got.Status != CRApproved {
		t.Errorf("got status %q, want approved", got.Status)
	}
}

func TestScenario_DeepPropagation(t *testing.T) {
	e := newTestEngine(t)
	ctx := context.Background()

	pm, _ := e.RegisterNode(ctx, "pm", VerticalPM, "proj", "pm", false)
	design, _ := e.RegisterNode(ctx, "design", VerticalDesign, "proj", "designer", false)
	dev, _ := e.RegisterNode(ctx, "dev", VerticalDev, "proj", "dev", false)

	// PM: business requirement
	bizReq, _ := e.AddItem(ctx, pm.ID, KindEpic, "Kiosk check-in", "", "BIZ-001")

	// Design: screen spec traces from biz req
	screen, _ := e.AddItem(ctx, design.ID, KindScreenSpec, "Check-in screen", "", "")
	e.AddTrace(ctx, screen.ID, bizReq.ID, RelationTracedFrom, "designer")

	// Dev: data model traces from screen spec
	model, _ := e.AddItem(ctx, dev.ID, KindDataModel, "CheckIn table", "", "")
	e.AddTrace(ctx, model.ID, screen.ID, RelationTracedFrom, "dev")

	// Dev: test case traces from data model
	test, _ := e.AddItem(ctx, dev.ID, KindTestCase, "CheckIn CRUD test", "", "")
	e.AddTrace(ctx, test.ID, model.ID, RelationTracedFrom, "dev")

	// Verify all
	e.VerifyItem(ctx, bizReq.ID, "approved", "pm")
	e.VerifyItem(ctx, screen.ID, "reviewed", "designer")
	e.VerifyItem(ctx, model.ID, "implemented", "dev")
	e.VerifyItem(ctx, test.ID, "passing", "dev")

	// Change at root — propagate
	signals, err := e.PropagateChange(ctx, bizReq.ID)
	if err != nil {
		t.Fatalf("propagate: %v", err)
	}

	// All 3 downstream items should be suspect
	if len(signals) < 3 {
		t.Errorf("got %d signals, want at least 3", len(signals))
	}

	gotScreen, _ := e.GetItem(ctx, screen.ID)
	gotModel, _ := e.GetItem(ctx, model.ID)
	gotTest, _ := e.GetItem(ctx, test.ID)

	if gotScreen.Status != StatusSuspect {
		t.Errorf("screen: got %q, want suspect", gotScreen.Status)
	}
	if gotModel.Status != StatusSuspect {
		t.Errorf("model: got %q, want suspect", gotModel.Status)
	}
	if gotTest.Status != StatusSuspect {
		t.Errorf("test: got %q, want suspect", gotTest.Status)
	}

	// Reconcile from leaf up
	sess, _ := e.StartReconciliation(ctx, "BIZ-001", dev.ID, "dev")
	e.ResolveItem(ctx, sess.ID, test.ID, "re_verified", "test still passes", "dev")
	e.ResolveItem(ctx, sess.ID, model.ID, "re_verified", "schema unchanged", "dev")
	e.CompleteReconciliation(ctx, sess.ID)

	gotModel, _ = e.GetItem(ctx, model.ID)
	gotTest, _ = e.GetItem(ctx, test.ID)
	if gotModel.Status != StatusProven {
		t.Errorf("model after reconcile: got %q, want proven", gotModel.Status)
	}
	if gotTest.Status != StatusProven {
		t.Errorf("test after reconcile: got %q, want proven", gotTest.Status)
	}
}
```

**Step 2: Run all tests**

Run: `go test -v ./...`
Expected: All PASS.

**Step 3: Commit**

```bash
git add scenario_test.go
git commit -m "test: add scenario tests for PM-spec-change, cross-team-CR, deep-propagation"
```

---

## Task 11: Add `mark-broken` CLI Command and `inv_mark_broken` MCP Tool

**Files:**
- Modify: `main.go` (add `mark-broken` CLI command)
- Modify: `mcp_server.go` (add `inv_mark_broken` MCP tool)

**Step 1: Write failing test**

Add to `engine_test.go` (or verify the existing `TestMarkBroken` covers reason+actor):

```go
func TestEngine_MarkBrokenCLILevel(t *testing.T) {
	e := newTestEngine(t)
	ctx := context.Background()

	node, _ := e.RegisterNode(ctx, "dev", VerticalDev, "proj", "owner", false)
	item, _ := e.AddItem(ctx, node.ID, KindADR, "ADR", "", "")

	// Verify then make suspect (MarkBroken requires suspect status)
	e.VerifyItem(ctx, item.ID, "proof", "dev")
	e.store.UpdateItemStatus(ctx, item.ID, StatusSuspect)

	err := e.MarkBroken(ctx, item.ID, "API contract changed", "cuong")
	if err != nil {
		t.Fatalf("mark broken: %v", err)
	}

	got, _ := e.GetItem(ctx, item.ID)
	if got.Status != StatusBroke {
		t.Errorf("got status %q, want broke", got.Status)
	}
}
```

Run: `go test -run TestEngine_MarkBrokenCLILevel -v ./...`
Expected: PASS (engine method already exists).

**Step 2: Add `mark-broken` CLI command**

Add to `main.go`, register `markBrokenCmd(engine, agentLog, sysLog)` in `root.AddCommand(...)`:

```go
func markBrokenCmd(e *Engine, agentLog, sysLog *zerolog.Logger) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "mark-broken [item-id]",
		Short: "Mark an item as broken with a reason",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			reason, _ := cmd.Flags().GetString("reason")
			actor, _ := cmd.Flags().GetString("actor")

			err := e.MarkBroken(context.Background(), args[0], reason, actor)
			if err != nil {
				sysLog.Error().Err(err).Str("item_id", args[0]).Msg("failed to mark broken")
				return err
			}

			item, err := e.GetItem(context.Background(), args[0])
			if err != nil {
				return err
			}
			data, _ := json.Marshal(item)
			agentLog.Info().RawJSON("data", data).Str("command", "mark-broken").Msg("item marked broken")
			return nil
		},
	}
	cmd.Flags().String("reason", "", "Reason for marking broken")
	cmd.Flags().String("actor", "", "Who is marking this broken")
	cmd.MarkFlagRequired("reason")
	cmd.MarkFlagRequired("actor")
	return cmd
}
```

Register: add `markBrokenCmd(engine, agentLog, sysLog)` to `root.AddCommand(...)`.

**Step 3: Add `inv_mark_broken` MCP tool**

Append to MCP tools in `mcp_server.go`:

```go
s.AddTool(mcp.NewTool("inv_mark_broken",
	mcp.WithDescription("Mark an item as broken with a reason"),
	mcp.WithString("item_id", mcp.Required(), mcp.Description("Item ID to mark as broken")),
	mcp.WithString("reason", mcp.Required(), mcp.Description("Reason for marking broken")),
	mcp.WithString("actor", mcp.Required(), mcp.Description("Who is marking this broken")),
), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	itemID, _ := req.RequireString("item_id")
	reason, _ := req.RequireString("reason")
	actor, _ := req.RequireString("actor")

	err := engine.MarkBroken(ctx, itemID, reason, actor)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	item, err := engine.GetItem(ctx, itemID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return resultJSON(item)
})
```

**Step 4: Verify compilation**

Run: `go build ./...`
Expected: No errors.

**Step 5: Commit**

```bash
git add main.go mcp_server.go engine_test.go
git commit -m "feat: add mark-broken CLI command and inv_mark_broken MCP tool"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 0 | Git init | `.gitignore` |
| 1 | `external_ref` field | `network.go`, `store.go`, `engine.go`, `main.go`, `mcp_server.go` |
| 2 | Query command | `engine.go`, `store.go`, `main.go`, `mcp_server.go` |
| 3 | Sweep command | `engine.go`, `store.go`, `main.go`, `mcp_server.go` |
| 4 | Reconcile workflow | `network.go`, `store.go`, `engine.go`, `main.go`, `mcp_server.go` |
| 5 | Trace up/down | `engine.go`, `store.go`, `main.go`, `mcp_server.go` |
| 6 | Dual zerolog | `go.mod`, `graph.go`, `main.go` |
| 7 | State machine tests | `state_test.go` |
| 8 | Store tests | `store_test.go` |
| 9 | Engine tests | `engine_test.go` |
| 10 | Scenario tests | `scenario_test.go` |
| 11 | `mark-broken` CLI + MCP | `main.go`, `mcp_server.go`, `engine_test.go` |
