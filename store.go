package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

type Store struct {
	db *sql.DB
}

func NewStore(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) migrate() error {
	schema := `
	CREATE TABLE IF NOT EXISTS nodes (
		id          TEXT PRIMARY KEY,
		name        TEXT NOT NULL,
		vertical    TEXT NOT NULL,
		project     TEXT NOT NULL,
		owner       TEXT NOT NULL,
		is_ai       INTEGER DEFAULT 0,
		created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS items (
		id           TEXT PRIMARY KEY,
		node_id      TEXT NOT NULL REFERENCES nodes(id),
		kind         TEXT NOT NULL,
		title        TEXT NOT NULL,
		body         TEXT DEFAULT '',
		external_ref TEXT DEFAULT '',
		status       TEXT DEFAULT 'unverified',
		evidence     TEXT DEFAULT '',
		confirmed_by TEXT DEFAULT '',
		confirmed_at DATETIME,
		version      INTEGER DEFAULT 1,
		created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS traces (
		id           TEXT PRIMARY KEY,
		from_item_id TEXT NOT NULL REFERENCES items(id),
		from_node_id TEXT NOT NULL REFERENCES nodes(id),
		to_item_id   TEXT NOT NULL REFERENCES items(id),
		to_node_id   TEXT NOT NULL REFERENCES nodes(id),
		relation     TEXT NOT NULL,
		confirmed_by TEXT DEFAULT '',
		confirmed_at DATETIME,
		created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS signals (
		id          TEXT PRIMARY KEY,
		kind        TEXT NOT NULL,
		source_item TEXT NOT NULL,
		source_node TEXT NOT NULL,
		target_item TEXT NOT NULL,
		target_node TEXT NOT NULL,
		payload     TEXT DEFAULT '',
		processed   INTEGER DEFAULT 0,
		created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS transitions (
		id        TEXT PRIMARY KEY,
		item_id   TEXT NOT NULL REFERENCES items(id),
		kind      TEXT NOT NULL,
		from_s    TEXT NOT NULL,
		to_s      TEXT NOT NULL,
		evidence  TEXT DEFAULT '',
		reason    TEXT DEFAULT '',
		actor     TEXT NOT NULL,
		timestamp DATETIME NOT NULL
	);

	CREATE TABLE IF NOT EXISTS change_requests (
		id             TEXT PRIMARY KEY,
		title          TEXT NOT NULL,
		description    TEXT DEFAULT '',
		proposer_id    TEXT NOT NULL,
		node_id        TEXT NOT NULL REFERENCES nodes(id),
		status         TEXT DEFAULT 'draft',
		affected_items TEXT DEFAULT '[]',
		created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS votes (
		id        TEXT PRIMARY KEY,
		cr_id     TEXT NOT NULL REFERENCES change_requests(id),
		node_id   TEXT NOT NULL REFERENCES nodes(id),
		voter_id  TEXT NOT NULL,
		decision  TEXT NOT NULL,
		reason    TEXT DEFAULT '',
		is_ai     INTEGER DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS queries (
		id          TEXT PRIMARY KEY,
		asker_id    TEXT NOT NULL,
		asker_node  TEXT NOT NULL,
		question    TEXT NOT NULL,
		context     TEXT DEFAULT '',
		target_node TEXT DEFAULT '',
		resolved    INTEGER DEFAULT 0,
		created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS query_responses (
		id           TEXT PRIMARY KEY,
		query_id     TEXT NOT NULL REFERENCES queries(id),
		responder_id TEXT NOT NULL,
		node_id      TEXT NOT NULL,
		answer       TEXT NOT NULL,
		is_ai        INTEGER DEFAULT 0,
		created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS reconciliation_log (
		id             TEXT PRIMARY KEY,
		node_id        TEXT NOT NULL REFERENCES nodes(id),
		trigger_ref    TEXT NOT NULL,
		summary        TEXT NOT NULL,
		items_affected TEXT DEFAULT '[]',
		assessed_by    TEXT NOT NULL,
		created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
	);

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

	CREATE TABLE IF NOT EXISTS checklist_entries (
		id         TEXT PRIMARY KEY,
		item_id    TEXT NOT NULL REFERENCES items(id),
		criterion  TEXT NOT NULL,
		checked    INTEGER DEFAULT 0,
		proof      TEXT DEFAULT '',
		checked_by TEXT DEFAULT '',
		checked_at DATETIME,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_items_node ON items(node_id);
	CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
	CREATE INDEX IF NOT EXISTS idx_traces_from ON traces(from_item_id);
	CREATE INDEX IF NOT EXISTS idx_traces_to ON traces(to_item_id);
	CREATE INDEX IF NOT EXISTS idx_signals_target ON signals(target_node, processed);
	CREATE INDEX IF NOT EXISTS idx_votes_cr ON votes(cr_id);
	CREATE INDEX IF NOT EXISTS idx_transitions_item ON transitions(item_id);
	CREATE INDEX IF NOT EXISTS idx_checklist_item ON checklist_entries(item_id);
	`
	_, err := s.db.Exec(schema)
	return err
}

func (s *Store) CreateNode(ctx context.Context, n *Node) error {
	if n.ID == "" {
		n.ID = uuid.New().String()
	}
	n.CreatedAt = time.Now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO nodes (id, name, vertical, project, owner, is_ai, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		n.ID, n.Name, n.Vertical, n.Project, n.Owner, n.IsAI, n.CreatedAt)
	return err
}

func (s *Store) GetNode(ctx context.Context, id string) (*Node, error) {
	n := &Node{}
	err := s.db.QueryRowContext(ctx,
		`SELECT id, name, vertical, project, owner, is_ai, created_at FROM nodes WHERE id = ?`, id).
		Scan(&n.ID, &n.Name, &n.Vertical, &n.Project, &n.Owner, &n.IsAI, &n.CreatedAt)
	if err != nil {
		return nil, err
	}
	return n, nil
}

func (s *Store) ListNodes(ctx context.Context, project string) ([]Node, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, name, vertical, project, owner, is_ai, created_at FROM nodes WHERE project = ? ORDER BY created_at`, project)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var nodes []Node
	for rows.Next() {
		var n Node
		if err := rows.Scan(&n.ID, &n.Name, &n.Vertical, &n.Project, &n.Owner, &n.IsAI, &n.CreatedAt); err != nil {
			return nil, err
		}
		nodes = append(nodes, n)
	}
	return nodes, rows.Err()
}

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

func (s *Store) GetItem(ctx context.Context, id string) (*Item, error) {
	item := &Item{}
	var confirmedAt sql.NullTime
	err := s.db.QueryRowContext(ctx,
		`SELECT id, node_id, kind, title, body, external_ref, status, evidence, confirmed_by, confirmed_at, version, created_at, updated_at
		 FROM items WHERE id = ?`, id).
		Scan(&item.ID, &item.NodeID, &item.Kind, &item.Title, &item.Body, &item.ExternalRef, &item.Status,
			&item.Evidence, &item.ConfirmedBy, &confirmedAt, &item.Version, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if confirmedAt.Valid {
		item.ConfirmedAt = &confirmedAt.Time
	}
	return item, nil
}

func (s *Store) ListItems(ctx context.Context, nodeID string) ([]Item, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, node_id, kind, title, body, external_ref, status, evidence, confirmed_by, confirmed_at, version, created_at, updated_at
		 FROM items WHERE node_id = ? ORDER BY created_at`, nodeID)
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

func (s *Store) GetItemsByNodeAndStatus(ctx context.Context, nodeID string, status ItemStatus) ([]Item, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, node_id, kind, title, body, external_ref, status, evidence, confirmed_by, confirmed_at, version, created_at, updated_at
		 FROM items WHERE node_id = ? AND status = ? ORDER BY updated_at DESC`, nodeID, status)
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

func (s *Store) UpdateItemStatus(ctx context.Context, itemID string, status ItemStatus) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE items SET status = ?, updated_at = ? WHERE id = ?`,
		status, time.Now(), itemID)
	return err
}

func (s *Store) UpdateItemWithEvidence(ctx context.Context, itemID string, status ItemStatus, evidence string, confirmedBy string) error {
	now := time.Now()
	_, err := s.db.ExecContext(ctx,
		`UPDATE items SET status = ?, evidence = ?, confirmed_by = ?, confirmed_at = ?, version = version + 1, updated_at = ? WHERE id = ?`,
		status, evidence, confirmedBy, now, now, itemID)
	return err
}

func (s *Store) CreateTrace(ctx context.Context, t *Trace) error {
	if t.ID == "" {
		t.ID = uuid.New().String()
	}
	t.CreatedAt = time.Now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO traces (id, from_item_id, from_node_id, to_item_id, to_node_id, relation, confirmed_by, confirmed_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		t.ID, t.FromItemID, t.FromNodeID, t.ToItemID, t.ToNodeID, t.Relation, t.ConfirmedBy, t.ConfirmedAt, t.CreatedAt)
	return err
}

func (s *Store) GetDependentTraces(ctx context.Context, itemID string) ([]Trace, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, from_item_id, from_node_id, to_item_id, to_node_id, relation, confirmed_by, confirmed_at, created_at
		 FROM traces WHERE to_item_id = ?`, itemID)
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

func (s *Store) GetItemTraces(ctx context.Context, itemID string) ([]Trace, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, from_item_id, from_node_id, to_item_id, to_node_id, relation, confirmed_by, confirmed_at, created_at
		 FROM traces WHERE from_item_id = ? OR to_item_id = ?`, itemID, itemID)
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

func (s *Store) CreateSignal(ctx context.Context, sig *Signal) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO signals (id, kind, source_item, source_node, target_item, target_node, payload, processed, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		sig.ID, sig.Kind, sig.SourceItem, sig.SourceNode, sig.TargetItem, sig.TargetNode, sig.Payload, sig.Processed, sig.CreatedAt)
	return err
}

func (s *Store) MarkSignalProcessed(ctx context.Context, sigID string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE signals SET processed = 1 WHERE id = ?`, sigID)
	return err
}

func (s *Store) RecordTransition(ctx context.Context, itemID string, t *Transition) error {
	id := uuid.New().String()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO transitions (id, item_id, kind, from_s, to_s, evidence, reason, actor, timestamp)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, itemID, t.Kind, t.From, t.To, t.Evidence, t.Reason, t.Actor, t.Timestamp)
	return err
}

func (s *Store) GetItemTransitions(ctx context.Context, itemID string) ([]Transition, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT kind, from_s, to_s, evidence, reason, actor, timestamp
		 FROM transitions WHERE item_id = ? ORDER BY timestamp`, itemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var transitions []Transition
	for rows.Next() {
		var t Transition
		if err := rows.Scan(&t.Kind, &t.From, &t.To, &t.Evidence, &t.Reason, &t.Actor, &t.Timestamp); err != nil {
			return nil, err
		}
		transitions = append(transitions, t)
	}
	return transitions, rows.Err()
}

func (s *Store) CreateChangeRequest(ctx context.Context, cr *ChangeRequest) error {
	if cr.ID == "" {
		cr.ID = uuid.New().String()
	}
	now := time.Now()
	cr.CreatedAt = now
	cr.UpdatedAt = now
	cr.Status = CRDraft
	affected, err := json.Marshal(cr.AffectedItems)
	if err != nil {
		return fmt.Errorf("marshal affected items: %w", err)
	}
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO change_requests (id, title, description, proposer_id, node_id, status, affected_items, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		cr.ID, cr.Title, cr.Description, cr.ProposerID, cr.NodeID, cr.Status, string(affected), cr.CreatedAt, cr.UpdatedAt)
	return err
}

func (s *Store) GetChangeRequest(ctx context.Context, id string) (*ChangeRequest, error) {
	cr := &ChangeRequest{}
	var affected string
	err := s.db.QueryRowContext(ctx,
		`SELECT id, title, description, proposer_id, node_id, status, affected_items, created_at, updated_at
		 FROM change_requests WHERE id = ?`, id).
		Scan(&cr.ID, &cr.Title, &cr.Description, &cr.ProposerID, &cr.NodeID, &cr.Status, &affected, &cr.CreatedAt, &cr.UpdatedAt)
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(affected), &cr.AffectedItems)
	return cr, nil
}

func (s *Store) UpdateCRStatus(ctx context.Context, id string, status CRStatus) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE change_requests SET status = ?, updated_at = ? WHERE id = ?`,
		status, time.Now(), id)
	return err
}

func (s *Store) CreateVote(ctx context.Context, v *Vote) error {
	if v.ID == "" {
		v.ID = uuid.New().String()
	}
	v.CreatedAt = time.Now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO votes (id, cr_id, node_id, voter_id, decision, reason, is_ai, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		v.ID, v.CRID, v.NodeID, v.VoterID, v.Decision, v.Reason, v.IsAI, v.CreatedAt)
	return err
}

func (s *Store) GetVotesForCR(ctx context.Context, crID string) ([]Vote, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, cr_id, node_id, voter_id, decision, reason, is_ai, created_at
		 FROM votes WHERE cr_id = ? ORDER BY created_at`, crID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var votes []Vote
	for rows.Next() {
		var v Vote
		if err := rows.Scan(&v.ID, &v.CRID, &v.NodeID, &v.VoterID, &v.Decision, &v.Reason, &v.IsAI, &v.CreatedAt); err != nil {
			return nil, err
		}
		votes = append(votes, v)
	}
	return votes, rows.Err()
}

func (s *Store) CreateQuery(ctx context.Context, q *Query) error {
	if q.ID == "" {
		q.ID = uuid.New().String()
	}
	q.CreatedAt = time.Now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO queries (id, asker_id, asker_node, question, context, target_node, resolved, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		q.ID, q.AskerID, q.AskerNode, q.Question, q.Context, q.TargetNode, q.Resolved, q.CreatedAt)
	return err
}

func (s *Store) CreateQueryResponse(ctx context.Context, r *QueryResponse) error {
	if r.ID == "" {
		r.ID = uuid.New().String()
	}
	r.CreatedAt = time.Now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO query_responses (id, query_id, responder_id, node_id, answer, is_ai, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		r.ID, r.QueryID, r.ResponderID, r.NodeID, r.Answer, r.IsAI, r.CreatedAt)
	return err
}

func (s *Store) AuditNode(ctx context.Context, nodeID string) (*AuditReport, error) {
	report := &AuditReport{NodeID: nodeID}

	node, err := s.GetNode(ctx, nodeID)
	if err != nil {
		return nil, err
	}

	items, err := s.ListItems(ctx, nodeID)
	if err != nil {
		return nil, err
	}

	upstreamVerticals := UpstreamVerticals[node.Vertical]

	report.TotalItems = len(items)
	for _, item := range items {
		switch item.Status {
		case StatusUnverified:
			report.Unverified = append(report.Unverified, item.ID)
		case StatusProven:
			report.Proven = append(report.Proven, item.ID)
		case StatusSuspect:
			report.Suspect = append(report.Suspect, item.ID)
		case StatusBroke:
			report.Broke = append(report.Broke, item.ID)
		}

		traces, err := s.GetItemTraces(ctx, item.ID)
		if err != nil {
			return nil, err
		}
		if len(traces) == 0 {
			report.Orphans = append(report.Orphans, item.ID)
		}

		// Check for missing upstream references
		if len(upstreamVerticals) > 0 {
			hasUpstreamRef := false
			for _, trace := range traces {
				// This item traces to an upstream item (from_item_id = this item)
				if trace.FromItemID == item.ID && trace.ToNodeID != nodeID {
					toNode, err := s.GetNode(ctx, trace.ToNodeID)
					if err == nil {
						for _, uv := range upstreamVerticals {
							if toNode.Vertical == uv {
								hasUpstreamRef = true
								break
							}
						}
					}
				}
				if hasUpstreamRef {
					break
				}
			}
			if !hasUpstreamRef {
				report.MissingUpstreamRefs = append(report.MissingUpstreamRefs, item.ID)
			}
		}

		// Check for incomplete checklists
		entries, err := s.GetChecklistEntries(ctx, item.ID)
		if err != nil {
			return nil, err
		}
		if len(entries) > 0 {
			for _, e := range entries {
				if !e.Checked {
					report.IncompleteChecklists = append(report.IncompleteChecklists, item.ID)
					break
				}
			}
		}
	}

	return report, nil
}

type AuditReport struct {
	NodeID              string   `json:"node_id"`
	TotalItems          int      `json:"total_items"`
	Unverified          []string `json:"unverified"`
	Proven              []string `json:"proven"`
	Suspect             []string `json:"suspect"`
	Broke               []string `json:"broke"`
	Orphans             []string `json:"orphans"`
	MissingUpstreamRefs []string `json:"missing_upstream_refs"`
	IncompleteChecklists []string `json:"incomplete_checklists"`
}

// --- Checklist CRUD ---

func (s *Store) CreateChecklistEntry(ctx context.Context, entry *ChecklistEntry) error {
	if entry.ID == "" {
		entry.ID = uuid.New().String()
	}
	entry.CreatedAt = time.Now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO checklist_entries (id, item_id, criterion, checked, proof, checked_by, checked_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		entry.ID, entry.ItemID, entry.Criterion, entry.Checked, entry.Proof, entry.CheckedBy, entry.CheckedAt, entry.CreatedAt)
	return err
}

func (s *Store) GetChecklistEntries(ctx context.Context, itemID string) ([]ChecklistEntry, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, item_id, criterion, checked, proof, checked_by, checked_at, created_at
		 FROM checklist_entries WHERE item_id = ? ORDER BY created_at`, itemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []ChecklistEntry
	for rows.Next() {
		var e ChecklistEntry
		var checkedAt sql.NullTime
		if err := rows.Scan(&e.ID, &e.ItemID, &e.Criterion, &e.Checked, &e.Proof, &e.CheckedBy, &checkedAt, &e.CreatedAt); err != nil {
			return nil, err
		}
		if checkedAt.Valid {
			e.CheckedAt = &checkedAt.Time
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

func (s *Store) CheckChecklistEntry(ctx context.Context, entryID string, proof string, checkedBy string) error {
	now := time.Now()
	_, err := s.db.ExecContext(ctx,
		`UPDATE checklist_entries SET checked = 1, proof = ?, checked_by = ?, checked_at = ? WHERE id = ?`,
		proof, checkedBy, now, entryID)
	return err
}

func (s *Store) UncheckChecklistEntry(ctx context.Context, entryID string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE checklist_entries SET checked = 0, proof = '', checked_by = '', checked_at = NULL WHERE id = ?`,
		entryID)
	return err
}

func (s *Store) GetChecklistEntry(ctx context.Context, entryID string) (*ChecklistEntry, error) {
	e := &ChecklistEntry{}
	var checkedAt sql.NullTime
	err := s.db.QueryRowContext(ctx,
		`SELECT id, item_id, criterion, checked, proof, checked_by, checked_at, created_at
		 FROM checklist_entries WHERE id = ?`, entryID).
		Scan(&e.ID, &e.ItemID, &e.Criterion, &e.Checked, &e.Proof, &e.CheckedBy, &checkedAt, &e.CreatedAt)
	if err != nil {
		return nil, err
	}
	if checkedAt.Valid {
		e.CheckedAt = &checkedAt.Time
	}
	return e, nil
}

func (s *Store) GetChecklistSummary(ctx context.Context, itemID string) (ChecklistSummary, error) {
	entries, err := s.GetChecklistEntries(ctx, itemID)
	if err != nil {
		return ChecklistSummary{}, err
	}

	summary := ChecklistSummary{
		Total: len(entries),
		Items: make([]string, 0, len(entries)),
	}
	for _, e := range entries {
		mark := "✗"
		if e.Checked {
			mark = "✓"
			summary.Checked++
		}
		summary.Items = append(summary.Items, e.Criterion+" "+mark)
	}
	return summary, nil
}

// --- Query ---

func (s *Store) QueryItems(ctx context.Context, f QueryFilter) ([]Item, error) {
	query := `SELECT id, node_id, kind, title, body, external_ref, status, evidence, confirmed_by, confirmed_at, version, created_at, updated_at FROM items WHERE 1=1`
	var args []interface{}

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

// --- Sweep ---

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

// --- Reconciliation ---

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

// --- Trace Up ---

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
