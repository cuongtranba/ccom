package main

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/mark3labs/mcp-go/client"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/suite"
)

// MCPSuite tests the MCP server tools end-to-end via InProcessClient,
// simulating what Claude Code sees when it calls our MCP tools.
type MCPSuite struct {
	suite.Suite
	store           *Store
	engine          *Engine
	challengeEngine *ChallengeEngine
	mcpClient       *client.Client
}

func TestMCPSuite(t *testing.T) {
	suite.Run(t, new(MCPSuite))
}

func (s *MCPSuite) SetupTest() {
	store, err := NewStore(":memory:")
	s.Require().NoError(err)
	s.store = store

	sm := NewStateMachine()
	prop := NewSignalPropagator(store, sm)
	crsm := NewCRStateMachine()
	s.engine = NewEngine(store, prop, crsm)

	proposalEng := NewProposalEngine(store)
	s.challengeEngine = NewChallengeEngine(store, proposalEng)

	mcpServer := newMCPServer(s.engine, s.store, s.challengeEngine)
	c, err := client.NewInProcessClient(mcpServer)
	s.Require().NoError(err)

	ctx := context.Background()
	_, err = c.Initialize(ctx, mcp.InitializeRequest{
		Params: mcp.InitializeParams{
			ProtocolVersion: "2024-11-05",
			Capabilities:    mcp.ClientCapabilities{},
			ClientInfo:      mcp.Implementation{Name: "test-claude-code", Version: "1.0.0"},
		},
	})
	s.Require().NoError(err)
	s.mcpClient = c
}

func (s *MCPSuite) TearDownTest() {
	if s.mcpClient != nil {
		s.mcpClient.Close()
	}
	s.store.Close()
}

// callTool is a helper that calls an MCP tool and returns the text result.
func (s *MCPSuite) callTool(name string, args map[string]any) string {
	ctx := context.Background()
	result, err := s.mcpClient.CallTool(ctx, mcp.CallToolRequest{
		Params: mcp.CallToolParams{
			Name:      name,
			Arguments: args,
		},
	})
	s.Require().NoError(err, "tool %s transport error", name)
	s.Require().NotNil(result)
	s.Require().False(result.IsError, "tool %s returned error: %v", name, textFromResult(result))
	return textFromResult(result)
}

// callToolExpectError calls a tool and expects an error result.
func (s *MCPSuite) callToolExpectError(name string, args map[string]any) string {
	ctx := context.Background()
	result, err := s.mcpClient.CallTool(ctx, mcp.CallToolRequest{
		Params: mcp.CallToolParams{
			Name:      name,
			Arguments: args,
		},
	})
	s.Require().NoError(err, "tool %s transport error", name)
	s.Require().NotNil(result)
	s.Require().True(result.IsError, "expected tool %s to return error", name)
	return textFromResult(result)
}

// unmarshalResult parses JSON tool result into the given target.
func (s *MCPSuite) unmarshalResult(raw string, target any) {
	err := json.Unmarshal([]byte(raw), target)
	s.Require().NoError(err, "failed to unmarshal tool result: %s", raw)
}

func textFromResult(r *mcp.CallToolResult) string {
	if len(r.Content) == 0 {
		return ""
	}
	if tc, ok := mcp.AsTextContent(r.Content[0]); ok {
		return tc.Text
	}
	return ""
}

// ---------------------------------------------------------------------------
// Test: List available tools
// ---------------------------------------------------------------------------

func (s *MCPSuite) TestListTools() {
	ctx := context.Background()
	result, err := s.mcpClient.ListTools(ctx, mcp.ListToolsRequest{})
	s.Require().NoError(err)
	s.GreaterOrEqual(len(result.Tools), 30, "should have many registered tools")

	toolNames := make(map[string]bool)
	for _, t := range result.Tools {
		toolNames[t.Name] = true
	}
	s.True(toolNames["inv_register_node"])
	s.True(toolNames["inv_add_item"])
	s.True(toolNames["inv_verify"])
	s.True(toolNames["inv_add_trace"])
	s.True(toolNames["inv_session_status"])
	s.True(toolNames["inv_pair_invite"])
}

// ---------------------------------------------------------------------------
// Test: Node & Item CRUD workflow (register → add item → list → query)
// ---------------------------------------------------------------------------

func (s *MCPSuite) TestNodeItemWorkflow() {
	// Register a node
	raw := s.callTool("inv_register_node", map[string]any{
		"name": "dev-node", "vertical": "dev", "project": "alpha", "owner": "alice",
	})
	var node Node
	s.unmarshalResult(raw, &node)
	s.Equal("dev-node", node.Name)
	s.Equal(VerticalDev, node.Vertical)
	s.NotEmpty(node.ID)

	// Add items
	raw = s.callTool("inv_add_item", map[string]any{
		"node_id": node.ID, "kind": "api-spec", "title": "User API", "body": "REST endpoints",
	})
	var item1 Item
	s.unmarshalResult(raw, &item1)
	s.Equal("User API", item1.Title)
	s.Equal(ItemKind("api-spec"), item1.Kind)

	raw = s.callTool("inv_add_item", map[string]any{
		"node_id": node.ID, "kind": "test-case", "title": "API Integration Test",
		"external_ref": "TC-001",
	})
	var item2 Item
	s.unmarshalResult(raw, &item2)

	// List items
	raw = s.callTool("inv_list_items", map[string]any{"node_id": node.ID})
	var items []Item
	s.unmarshalResult(raw, &items)
	s.Len(items, 2)

	// List nodes
	raw = s.callTool("inv_list_nodes", map[string]any{"project": "alpha"})
	var nodes []Node
	s.unmarshalResult(raw, &nodes)
	s.Len(nodes, 1)
	s.Equal("dev-node", nodes[0].Name)

	// Query by text
	raw = s.callTool("inv_query", map[string]any{"text": "API"})
	var queryResults []Item
	s.unmarshalResult(raw, &queryResults)
	s.GreaterOrEqual(len(queryResults), 1)

	// Query by external ref
	raw = s.callTool("inv_query", map[string]any{"external_ref": "TC-001"})
	s.unmarshalResult(raw, &queryResults)
	s.Len(queryResults, 1)
	s.Equal("API Integration Test", queryResults[0].Title)
}

// ---------------------------------------------------------------------------
// Test: Verify & Mark Broken lifecycle via MCP
// ---------------------------------------------------------------------------

func (s *MCPSuite) TestVerificationLifecycle() {
	// Setup: register node and add item
	raw := s.callTool("inv_register_node", map[string]any{
		"name": "qa-node", "vertical": "qa", "project": "beta", "owner": "bob",
	})
	var node Node
	s.unmarshalResult(raw, &node)

	raw = s.callTool("inv_add_item", map[string]any{
		"node_id": node.ID, "kind": "test-case", "title": "Login Test",
	})
	var item Item
	s.unmarshalResult(raw, &item)
	s.Equal(StatusUnverified, item.Status)

	// Verify: unverified → proven
	raw = s.callTool("inv_verify", map[string]any{
		"item_id": item.ID, "evidence": "passed CI", "actor": "bob",
	})
	s.Contains(raw, "verified")

	// Cannot mark proven → broke directly (need suspect first)
	errMsg := s.callToolExpectError("inv_mark_broken", map[string]any{
		"item_id": item.ID, "reason": "broke it", "actor": "bob",
	})
	s.Contains(errMsg, "not allowed")
}

// ---------------------------------------------------------------------------
// Test: Trace creation and traversal via MCP
// ---------------------------------------------------------------------------

func (s *MCPSuite) TestTraceWorkflow() {
	// Register two nodes
	raw := s.callTool("inv_register_node", map[string]any{
		"name": "pm-node", "vertical": "pm", "project": "gamma", "owner": "carol",
	})
	var pmNode Node
	s.unmarshalResult(raw, &pmNode)

	raw = s.callTool("inv_register_node", map[string]any{
		"name": "dev-node", "vertical": "dev", "project": "gamma", "owner": "dave",
	})
	var devNode Node
	s.unmarshalResult(raw, &devNode)

	// Add items
	raw = s.callTool("inv_add_item", map[string]any{
		"node_id": pmNode.ID, "kind": "user-story", "title": "User Login Story", "external_ref": "US-100",
	})
	var story Item
	s.unmarshalResult(raw, &story)

	raw = s.callTool("inv_add_item", map[string]any{
		"node_id": devNode.ID, "kind": "api-spec", "title": "Login API Implementation",
	})
	var api Item
	s.unmarshalResult(raw, &api)

	// Create trace: api traced_from story
	raw = s.callTool("inv_add_trace", map[string]any{
		"from_item": api.ID, "to_item": story.ID, "relation": "traced_from", "confirmed_by": "dave",
	})
	var trace Trace
	s.unmarshalResult(raw, &trace)
	s.Equal(api.ID, trace.FromItemID)
	s.Equal(story.ID, trace.ToItemID)

	// Trace up from API → should reach story
	raw = s.callTool("inv_trace_up", map[string]any{"item_id": api.ID})
	s.Contains(raw, story.ID)

	// Trace down from story → should reach API
	raw = s.callTool("inv_trace_down", map[string]any{"item_id": story.ID})
	s.Contains(raw, api.ID)

	// Impact analysis: changing the story affects the API
	raw = s.callTool("inv_impact", map[string]any{"item_id": story.ID})
	s.Contains(raw, api.ID)
}

// ---------------------------------------------------------------------------
// Test: Signal propagation via MCP (verify → propagate → suspect dependents)
// ---------------------------------------------------------------------------

func (s *MCPSuite) TestSignalPropagation() {
	raw := s.callTool("inv_register_node", map[string]any{
		"name": "pm-node", "vertical": "pm", "project": "delta", "owner": "eve",
	})
	var pmNode Node
	s.unmarshalResult(raw, &pmNode)

	raw = s.callTool("inv_register_node", map[string]any{
		"name": "dev-node", "vertical": "dev", "project": "delta", "owner": "frank",
	})
	var devNode Node
	s.unmarshalResult(raw, &devNode)

	// Create epic and implementation
	raw = s.callTool("inv_add_item", map[string]any{
		"node_id": pmNode.ID, "kind": "epic", "title": "Auth Epic", "external_ref": "EPIC-10",
	})
	var epic Item
	s.unmarshalResult(raw, &epic)

	raw = s.callTool("inv_add_item", map[string]any{
		"node_id": devNode.ID, "kind": "api-spec", "title": "Auth API",
	})
	var api Item
	s.unmarshalResult(raw, &api)

	// Trace API ← Epic
	s.callTool("inv_add_trace", map[string]any{
		"from_item": api.ID, "to_item": epic.ID, "relation": "traced_from", "confirmed_by": "frank",
	})

	// Verify both items
	s.callTool("inv_verify", map[string]any{"item_id": epic.ID, "evidence": "approved", "actor": "eve"})
	s.callTool("inv_verify", map[string]any{"item_id": api.ID, "evidence": "implemented", "actor": "frank"})

	// Sweep the external ref → propagates impact to dependents
	raw = s.callTool("inv_sweep", map[string]any{"external_ref": "EPIC-10"})
	s.Contains(raw, "suspect")

	// API should now be suspect (it depends on the epic)
	raw = s.callTool("inv_query", map[string]any{"status": "suspect"})
	s.Contains(raw, api.ID)
}

// ---------------------------------------------------------------------------
// Test: Checklist workflow via MCP
// ---------------------------------------------------------------------------

func (s *MCPSuite) TestChecklistWorkflow() {
	raw := s.callTool("inv_register_node", map[string]any{
		"name": "qa-node", "vertical": "qa", "project": "epsilon", "owner": "grace",
	})
	var node Node
	s.unmarshalResult(raw, &node)

	raw = s.callTool("inv_add_item", map[string]any{
		"node_id": node.ID, "kind": "test-case", "title": "Smoke Test",
	})
	var item Item
	s.unmarshalResult(raw, &item)

	// Add checklist criteria
	raw = s.callTool("inv_checklist_add", map[string]any{"item_id": item.ID, "criterion": "Login works"})
	var entry1 ChecklistEntry
	s.unmarshalResult(raw, &entry1)
	s.Equal("Login works", entry1.Criterion)
	s.False(entry1.Checked)

	raw = s.callTool("inv_checklist_add", map[string]any{"item_id": item.ID, "criterion": "Logout works"})
	var entry2 ChecklistEntry
	s.unmarshalResult(raw, &entry2)

	// List checklist
	raw = s.callTool("inv_checklist_list", map[string]any{"item_id": item.ID})
	var entries []ChecklistEntry
	s.unmarshalResult(raw, &entries)
	s.Len(entries, 2)

	// Check first entry
	raw = s.callTool("inv_checklist_check", map[string]any{
		"entry_id": entry1.ID, "proof": "tested manually", "actor": "grace",
	})
	s.Contains(raw, "checked")

	// Uncheck it
	raw = s.callTool("inv_checklist_uncheck", map[string]any{"entry_id": entry1.ID})
	s.Contains(raw, "unchecked")

	// Item summary should show checklist status
	raw = s.callTool("inv_item_summary", map[string]any{"item_id": item.ID})
	s.Contains(raw, "Smoke Test")
}

// ---------------------------------------------------------------------------
// Test: Change Request (CR) lifecycle via MCP
// ---------------------------------------------------------------------------

func (s *MCPSuite) TestChangeRequestWorkflow() {
	raw := s.callTool("inv_register_node", map[string]any{
		"name": "pm-node", "vertical": "pm", "project": "zeta", "owner": "hank",
	})
	var node Node
	s.unmarshalResult(raw, &node)

	raw = s.callTool("inv_add_item", map[string]any{
		"node_id": node.ID, "kind": "adr", "title": "Use PostgreSQL",
	})
	var item Item
	s.unmarshalResult(raw, &item)

	// Create CR
	raw = s.callTool("inv_create_cr", map[string]any{
		"title": "Switch to PostgreSQL", "proposer_id": "hank", "node_id": node.ID,
		"description": "Migration from SQLite", "affected_items": item.ID,
	})
	var cr ChangeRequest
	s.unmarshalResult(raw, &cr)
	s.Equal("Switch to PostgreSQL", cr.Title)
	s.Equal(CRDraft, cr.Status)
	s.NotEmpty(cr.ID)

	// Vote on CR
	raw = s.callTool("inv_vote", map[string]any{
		"cr_id": cr.ID, "node_id": node.ID, "voter_id": "hank", "decision": "approve",
		"reason": "good idea",
	})
	s.Contains(raw, "approve")
}

// ---------------------------------------------------------------------------
// Test: Audit tools via MCP
// ---------------------------------------------------------------------------

func (s *MCPSuite) TestAuditWorkflow() {
	raw := s.callTool("inv_register_node", map[string]any{
		"name": "dev-node", "vertical": "dev", "project": "eta", "owner": "ivan",
	})
	var node Node
	s.unmarshalResult(raw, &node)

	// Add orphan item (no traces)
	s.callTool("inv_add_item", map[string]any{
		"node_id": node.ID, "kind": "api-spec", "title": "Orphan API",
	})

	// Audit should flag orphan items
	raw = s.callTool("inv_audit", map[string]any{"node_id": node.ID})
	s.Contains(raw, "orphans")

	// Audit all nodes
	raw = s.callTool("inv_audit_all", map[string]any{"project": "eta"})
	s.Contains(raw, node.ID)
}

// ---------------------------------------------------------------------------
// Test: Session status via MCP
// ---------------------------------------------------------------------------

func (s *MCPSuite) TestSessionStatus() {
	raw := s.callTool("inv_register_node", map[string]any{
		"name": "dev-node", "vertical": "dev", "project": "theta", "owner": "judy",
	})
	var node Node
	s.unmarshalResult(raw, &node)

	raw = s.callTool("inv_session_status", map[string]any{
		"project": "theta", "node_id": node.ID,
	})

	var status SessionStatus
	s.unmarshalResult(raw, &status)
	s.Equal(node.ID, status.MyNode.ID)
	s.Equal(0, status.PendingEvents)
}

// ---------------------------------------------------------------------------
// Test: Permission mode config via MCP
// ---------------------------------------------------------------------------

func (s *MCPSuite) TestConfigMode() {
	// Read current mode
	raw := s.callTool("inv_config_mode", map[string]any{})
	s.Contains(raw, "normal")

	// Set to autonomous
	raw = s.callTool("inv_config_mode", map[string]any{"new_mode": "autonomous"})
	s.Contains(raw, "autonomous")

	// Read again
	raw = s.callTool("inv_config_mode", map[string]any{})
	s.Contains(raw, "autonomous")
}

// ---------------------------------------------------------------------------
// Test: Challenge lifecycle via MCP
// ---------------------------------------------------------------------------

func (s *MCPSuite) TestChallengeWorkflow() {
	// Register peers (via store directly, since MCP challenge tools need peer records)
	ctx := context.Background()
	s.store.CreatePeer(ctx, &Peer{
		PeerID: "peer-a", NodeID: "node-a", Name: "Alice",
		Vertical: VerticalDev, Project: "iota", Owner: "alice", Status: PeerStatusApproved,
	})
	s.store.CreatePeer(ctx, &Peer{
		PeerID: "peer-b", NodeID: "node-b", Name: "Bob",
		Vertical: VerticalQA, Project: "iota", Owner: "bob", Status: PeerStatusApproved,
	})

	// Create challenge
	raw := s.callTool("inv_challenge_create", map[string]any{
		"kind": "stale_data", "challenger_peer": "peer-a", "challenged_peer": "peer-b",
		"reason": "Data is 3 months old", "evidence": "last updated Jan 2026",
	})
	var challenge Challenge
	s.unmarshalResult(raw, &challenge)
	s.Equal(ChallengeStaleData, challenge.Kind)
	s.Equal("peer-a", challenge.ChallengerPeer)
	s.Equal(ChallengeOpen, challenge.Status)

	// List challenges
	raw = s.callTool("inv_challenge_list", map[string]any{})
	var challenges []Challenge
	s.unmarshalResult(raw, &challenges)
	s.GreaterOrEqual(len(challenges), 1)

	// Respond to challenge
	raw = s.callTool("inv_challenge_respond", map[string]any{
		"challenge_id": challenge.ID, "evidence": "Updated all data today",
	})
	s.Contains(raw, "submitted")
}

// ---------------------------------------------------------------------------
// Test: Governance proposal via MCP
// ---------------------------------------------------------------------------

func (s *MCPSuite) TestProposalWorkflow() {
	ctx := context.Background()
	s.store.CreatePeer(ctx, &Peer{
		PeerID: "peer-x", NodeID: "node-x", Name: "Xena",
		Vertical: VerticalPM, Project: "kappa", Owner: "xena", Status: PeerStatusApproved,
	})

	raw := s.callTool("inv_proposal_create", map[string]any{
		"kind": "network_membership", "title": "Add new team member",
		"proposer_peer": "peer-x", "description": "Adding Dave to the network",
	})
	s.Contains(raw, "Add new team member")

	// Extract proposal ID for voting
	var proposal struct {
		ID string `json:"id"`
	}
	s.unmarshalResult(raw, &proposal)

	raw = s.callTool("inv_proposal_vote", map[string]any{
		"proposal_id": proposal.ID, "voter_peer": "peer-x",
		"voter_id": "xena", "decision": "approve", "reason": "welcome aboard",
	})
	s.Contains(raw, "approve")
}

// ---------------------------------------------------------------------------
// Test: Network question via MCP (inv_ask)
// ---------------------------------------------------------------------------

func (s *MCPSuite) TestNetworkAsk() {
	// Setup: need event dispatcher for ask
	logger := zerolog.Nop()
	_ = NewEventDispatcher(s.store, logger)

	raw := s.callTool("inv_register_node", map[string]any{
		"name": "curious-node", "vertical": "dev", "project": "lambda", "owner": "karl",
	})
	var node Node
	s.unmarshalResult(raw, &node)

	raw = s.callTool("inv_ask", map[string]any{
		"asker_id": "karl", "asker_node": node.ID,
		"question": "What is the API contract for user auth?",
		"context":  "Building the login page",
	})
	s.Contains(raw, "question")
}

// ---------------------------------------------------------------------------
// Test: Pairing session lifecycle via MCP
// ---------------------------------------------------------------------------

func (s *MCPSuite) TestPairingSessionWorkflow() {
	ctx := context.Background()

	// Register peer nodes
	s.store.CreatePeer(ctx, &Peer{
		PeerID: "pair-host", NodeID: "host-node", Name: "Host",
		Vertical: VerticalDev, Project: "mu", Owner: "host-owner", Status: PeerStatusApproved,
	})
	s.store.CreatePeer(ctx, &Peer{
		PeerID: "pair-guest", NodeID: "guest-node", Name: "Guest",
		Vertical: VerticalQA, Project: "mu", Owner: "guest-owner", Status: PeerStatusApproved,
	})

	// Register inventory nodes
	raw := s.callTool("inv_register_node", map[string]any{
		"name": "host-inv", "vertical": "dev", "project": "mu", "owner": "host-owner",
	})
	var hostNode Node
	s.unmarshalResult(raw, &hostNode)

	raw = s.callTool("inv_register_node", map[string]any{
		"name": "guest-inv", "vertical": "qa", "project": "mu", "owner": "guest-owner",
	})
	var guestNode Node
	s.unmarshalResult(raw, &guestNode)

	// Invite
	raw = s.callTool("inv_pair_invite", map[string]any{
		"host_peer": "pair-host", "host_node": hostNode.ID,
		"guest_peer": "pair-guest", "guest_node": guestNode.ID,
	})
	var session PairingSession
	s.unmarshalResult(raw, &session)
	s.Equal(PairingPending, session.Status)

	// Join
	raw = s.callTool("inv_pair_join", map[string]any{
		"session_id": session.ID, "guest_peer": "pair-guest",
	})
	var joined PairingSession
	s.unmarshalResult(raw, &joined)
	s.Equal(PairingActive, joined.Status)

	// List active sessions
	raw = s.callTool("inv_pair_list", map[string]any{"peer": "pair-host"})
	var sessions []PairingSession
	s.unmarshalResult(raw, &sessions)
	s.GreaterOrEqual(len(sessions), 1)

	// End
	raw = s.callTool("inv_pair_end", map[string]any{
		"session_id": session.ID, "peer": "pair-host",
	})
	var ended PairingSession
	s.unmarshalResult(raw, &ended)
	s.Equal(PairingEnded, ended.Status)
}

// ---------------------------------------------------------------------------
// Test: Reconciliation workflow via MCP
// ---------------------------------------------------------------------------

func (s *MCPSuite) TestReconciliationWorkflow() {
	// Setup: two nodes with a trace so sweep creates suspect items
	raw := s.callTool("inv_register_node", map[string]any{
		"name": "pm-recon", "vertical": "pm", "project": "nu", "owner": "leo",
	})
	var pmNode Node
	s.unmarshalResult(raw, &pmNode)

	raw = s.callTool("inv_register_node", map[string]any{
		"name": "dev-recon", "vertical": "dev", "project": "nu", "owner": "leo",
	})
	var devNode Node
	s.unmarshalResult(raw, &devNode)

	// Add upstream item (PM) with external ref
	raw = s.callTool("inv_add_item", map[string]any{
		"node_id": pmNode.ID, "kind": "epic", "title": "Payments Epic", "external_ref": "PAY-01",
	})
	var epic Item
	s.unmarshalResult(raw, &epic)

	// Add downstream item (Dev) that depends on epic
	raw = s.callTool("inv_add_item", map[string]any{
		"node_id": devNode.ID, "kind": "api-spec", "title": "Payments API",
	})
	var api Item
	s.unmarshalResult(raw, &api)

	// Trace: api traced_from epic
	s.callTool("inv_add_trace", map[string]any{
		"from_item": api.ID, "to_item": epic.ID, "relation": "traced_from", "confirmed_by": "leo",
	})

	// Verify both
	s.callTool("inv_verify", map[string]any{"item_id": epic.ID, "evidence": "approved", "actor": "leo"})
	s.callTool("inv_verify", map[string]any{"item_id": api.ID, "evidence": "implemented", "actor": "leo"})

	// Sweep the epic's ref → makes dependent (api) suspect
	raw = s.callTool("inv_sweep", map[string]any{"external_ref": "PAY-01"})
	s.Contains(raw, "suspect")

	// Start reconciliation on dev node (which has the suspect api)
	raw = s.callTool("inv_reconcile_start", map[string]any{
		"trigger_ref": "PAY-01", "node_id": devNode.ID, "actor": "leo",
	})

	var reconSession struct {
		ID string `json:"id"`
	}
	s.unmarshalResult(raw, &reconSession)
	s.NotEmpty(reconSession.ID)

	// Resolve the suspect API item
	raw = s.callTool("inv_reconcile_resolve", map[string]any{
		"session_id": reconSession.ID, "item_id": api.ID,
		"decision": "re_verified", "evidence": "re-tested", "actor": "leo",
	})
	s.Contains(raw, api.ID)

	// Complete
	raw = s.callTool("inv_reconcile_complete", map[string]any{"session_id": reconSession.ID})
	s.Contains(raw, "completed")
}

// ---------------------------------------------------------------------------
// Test: Error handling (missing required params, invalid operations)
// ---------------------------------------------------------------------------

func (s *MCPSuite) TestErrorHandling() {
	// Missing required parameter
	errMsg := s.callToolExpectError("inv_register_node", map[string]any{
		"name": "test",
		// missing vertical, project, owner
	})
	s.Contains(errMsg, "missing")

	// Invalid node_id
	errMsg = s.callToolExpectError("inv_add_item", map[string]any{
		"node_id": "nonexistent", "kind": "epic", "title": "test",
	})
	s.NotEmpty(errMsg)

	// Invalid item_id for verify
	errMsg = s.callToolExpectError("inv_verify", map[string]any{
		"item_id": "nonexistent", "evidence": "test", "actor": "test",
	})
	s.NotEmpty(errMsg)
}

// ---------------------------------------------------------------------------
// Test: Item summary and node summaries via MCP
// ---------------------------------------------------------------------------

func (s *MCPSuite) TestSummaryTools() {
	raw := s.callTool("inv_register_node", map[string]any{
		"name": "sum-node", "vertical": "dev", "project": "omicron", "owner": "mia",
	})
	var node Node
	s.unmarshalResult(raw, &node)

	raw = s.callTool("inv_add_item", map[string]any{
		"node_id": node.ID, "kind": "api-spec", "title": "Summary API",
	})
	var item Item
	s.unmarshalResult(raw, &item)

	// Add checklist to make summary interesting
	s.callTool("inv_checklist_add", map[string]any{"item_id": item.ID, "criterion": "Tests pass"})

	// Item summary
	raw = s.callTool("inv_item_summary", map[string]any{"item_id": item.ID})
	s.Contains(raw, "Summary API")
	s.Contains(raw, "checklist")

	// Node summaries
	raw = s.callTool("inv_node_summaries", map[string]any{"node_id": node.ID})
	s.Contains(raw, "Summary API")
}

// ---------------------------------------------------------------------------
// Test: Pending events & acknowledgement via MCP
// ---------------------------------------------------------------------------

func (s *MCPSuite) TestPendingEvents() {
	// No events initially
	raw := s.callTool("inv_pending_events", map[string]any{})
	var events []any
	s.unmarshalResult(raw, &events)
	s.Empty(events)

	// With acknowledge flag (should still work even if empty)
	raw = s.callTool("inv_pending_events", map[string]any{"acknowledge": true})
	s.unmarshalResult(raw, &events)
	s.Empty(events)
}

// ---------------------------------------------------------------------------
// Test: Full Claude Code simulation (multi-tool workflow)
// ---------------------------------------------------------------------------

func (s *MCPSuite) TestClaudeCodeSimulation() {
	// Simulate what Claude Code does in a typical session:
	// 1. Check session status
	// 2. Register node
	// 3. Add items
	// 4. Create traces between them
	// 5. Verify items
	// 6. Add checklists
	// 7. Run audit
	// 8. Check session status again

	// Step 1: Register node (Claude's first action)
	raw := s.callTool("inv_register_node", map[string]any{
		"name": "claude-dev", "vertical": "dev", "project": "sigma", "owner": "claude-ai", "is_ai": true,
	})
	var devNode Node
	s.unmarshalResult(raw, &devNode)
	s.True(devNode.IsAI)

	raw = s.callTool("inv_register_node", map[string]any{
		"name": "claude-qa", "vertical": "qa", "project": "sigma", "owner": "claude-ai", "is_ai": true,
	})
	var qaNode Node
	s.unmarshalResult(raw, &qaNode)

	// Step 2: Check session status
	raw = s.callTool("inv_session_status", map[string]any{
		"project": "sigma", "node_id": devNode.ID,
	})
	var status SessionStatus
	s.unmarshalResult(raw, &status)
	s.Equal(devNode.ID, status.MyNode.ID)

	// Step 3: Add items to dev inventory
	raw = s.callTool("inv_add_item", map[string]any{
		"node_id": devNode.ID, "kind": "api-spec", "title": "Auth Service API",
		"body": "OAuth2 endpoints for user authentication", "external_ref": "AUTH-001",
	})
	var authAPI Item
	s.unmarshalResult(raw, &authAPI)

	raw = s.callTool("inv_add_item", map[string]any{
		"node_id": devNode.ID, "kind": "data-model", "title": "User Schema",
	})
	var userSchema Item
	s.unmarshalResult(raw, &userSchema)

	// Step 4: Add items to QA inventory
	raw = s.callTool("inv_add_item", map[string]any{
		"node_id": qaNode.ID, "kind": "test-case", "title": "Auth Integration Tests",
	})
	var authTest Item
	s.unmarshalResult(raw, &authTest)

	// Step 5: Create traces
	s.callTool("inv_add_trace", map[string]any{
		"from_item": authAPI.ID, "to_item": userSchema.ID,
		"relation": "traced_from", "confirmed_by": "claude-ai",
	})
	s.callTool("inv_add_trace", map[string]any{
		"from_item": authTest.ID, "to_item": authAPI.ID,
		"relation": "proven_by", "confirmed_by": "claude-ai",
	})

	// Step 6: Verify items
	s.callTool("inv_verify", map[string]any{
		"item_id": userSchema.ID, "evidence": "schema validated", "actor": "claude-ai",
	})
	s.callTool("inv_verify", map[string]any{
		"item_id": authAPI.ID, "evidence": "API implemented and tested", "actor": "claude-ai",
	})
	s.callTool("inv_verify", map[string]any{
		"item_id": authTest.ID, "evidence": "all tests passing", "actor": "claude-ai",
	})

	// Step 7: Add checklist
	raw = s.callTool("inv_checklist_add", map[string]any{
		"item_id": authAPI.ID, "criterion": "Rate limiting configured",
	})
	var entry ChecklistEntry
	s.unmarshalResult(raw, &entry)
	s.callTool("inv_checklist_check", map[string]any{
		"entry_id": entry.ID, "proof": "100 req/s limit set", "actor": "claude-ai",
	})

	// Step 8: Run audit on both nodes
	raw = s.callTool("inv_audit", map[string]any{"node_id": devNode.ID})
	s.Contains(raw, devNode.ID)

	raw = s.callTool("inv_audit", map[string]any{"node_id": qaNode.ID})
	s.Contains(raw, qaNode.ID)

	// Step 9: Impact analysis — what happens if auth API changes?
	raw = s.callTool("inv_impact", map[string]any{"item_id": authAPI.ID})
	s.Contains(raw, authTest.ID, "test should be impacted by API change")

	// Step 10: Final session status
	raw = s.callTool("inv_session_status", map[string]any{
		"project": "sigma", "node_id": devNode.ID,
	})
	s.unmarshalResult(raw, &status)
	s.Equal(0, len(status.SuspectItems), "no suspect items after verification")

	// Step 11: Audit all nodes in project
	raw = s.callTool("inv_audit_all", map[string]any{"project": "sigma"})
	s.Contains(raw, devNode.ID)
	s.Contains(raw, qaNode.ID)
}
