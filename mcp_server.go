package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

func serveMCP(engine *Engine, store *Store, challengeEngine *ChallengeEngine) error {
	s := server.NewMCPServer(
		"Inventory Network",
		"1.0.0",
		server.WithToolCapabilities(true),
	)

	s.AddTool(mcp.NewTool("inv_register_node",
		mcp.WithDescription("Register a new node (inventory) in the network"),
		mcp.WithString("name", mcp.Required(), mcp.Description("Node name")),
		mcp.WithString("vertical", mcp.Required(), mcp.Description("Vertical: pm, design, dev, qa, devops")),
		mcp.WithString("project", mcp.Required(), mcp.Description("Project name")),
		mcp.WithString("owner", mcp.Required(), mcp.Description("Owner name")),
		mcp.WithBoolean("is_ai", mcp.Description("Whether this is an AI-managed node")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		name, err := req.RequireString("name")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing name: %v", err)), nil
		}
		vertical, err := req.RequireString("vertical")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing vertical: %v", err)), nil
		}
		project, err := req.RequireString("project")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing project: %v", err)), nil
		}
		owner, err := req.RequireString("owner")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing owner: %v", err)), nil
		}
		isAI, ok := req.GetArguments()["is_ai"].(bool)
		if !ok {
			isAI = false
		}

		node, err := engine.RegisterNode(ctx, name, Vertical(vertical), project, owner, isAI)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(node)
	})

	s.AddTool(mcp.NewTool("inv_add_item",
		mcp.WithDescription("Add an item to a node's inventory"),
		mcp.WithString("node_id", mcp.Required(), mcp.Description("Node ID")),
		mcp.WithString("kind", mcp.Required(), mcp.Description("Item kind (adr, api-spec, data-model, epic, user-story, etc.)")),
		mcp.WithString("title", mcp.Required(), mcp.Description("Item title")),
		mcp.WithString("body", mcp.Description("Item body (markdown)")),
		mcp.WithString("external_ref", mcp.Description("External reference (e.g., US-003, BUG-001)")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		nodeID, err := req.RequireString("node_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing node_id: %v", err)), nil
		}
		kind, err := req.RequireString("kind")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing kind: %v", err)), nil
		}
		title, err := req.RequireString("title")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing title: %v", err)), nil
		}
		body, ok := req.GetArguments()["body"].(string)
		if !ok {
			body = ""
		}
		ref, ok := req.GetArguments()["external_ref"].(string)
		if !ok {
			ref = ""
		}

		item, err := engine.AddItem(ctx, nodeID, ItemKind(kind), title, body, ref)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(item)
	})

	s.AddTool(mcp.NewTool("inv_add_trace",
		mcp.WithDescription("Create a trace connection between two items across the network"),
		mcp.WithString("from_item", mcp.Required(), mcp.Description("Source item ID")),
		mcp.WithString("to_item", mcp.Required(), mcp.Description("Target item ID")),
		mcp.WithString("relation", mcp.Required(), mcp.Description("Relation: traced_from, matched_by, proven_by")),
		mcp.WithString("confirmed_by", mcp.Required(), mcp.Description("Who confirmed this trace")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		from, err := req.RequireString("from_item")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing from_item: %v", err)), nil
		}
		to, err := req.RequireString("to_item")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing to_item: %v", err)), nil
		}
		relation, err := req.RequireString("relation")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing relation: %v", err)), nil
		}
		actor, err := req.RequireString("confirmed_by")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing confirmed_by: %v", err)), nil
		}

		trace, err := engine.AddTrace(ctx, from, to, TraceRelation(relation), actor)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(trace)
	})

	s.AddTool(mcp.NewTool("inv_verify",
		mcp.WithDescription("Verify an item with evidence. Transitions: unverified->proven, suspect->proven, broke->proven"),
		mcp.WithString("item_id", mcp.Required(), mcp.Description("Item ID to verify")),
		mcp.WithString("evidence", mcp.Required(), mcp.Description("Evidence for verification")),
		mcp.WithString("actor", mcp.Required(), mcp.Description("Who is verifying")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		itemID, err := req.RequireString("item_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing item_id: %v", err)), nil
		}
		evidence, err := req.RequireString("evidence")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing evidence: %v", err)), nil
		}
		actor, err := req.RequireString("actor")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing actor: %v", err)), nil
		}

		if err := engine.VerifyItem(ctx, itemID, evidence, actor); err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		signals, err := engine.PropagateChange(ctx, itemID)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("propagate: %v", err)), nil
		}
		type VerifyResult struct {
			Status           string `json:"status"`
			SignalsPropagated int    `json:"signals_propagated"`
		}
		return resultJSON(VerifyResult{
			Status:           "verified",
			SignalsPropagated: len(signals),
		})
	})

	s.AddTool(mcp.NewTool("inv_impact",
		mcp.WithDescription("Show what items would be affected if this item changes — follows the trace graph"),
		mcp.WithString("item_id", mcp.Required(), mcp.Description("Item ID to analyze")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		itemID, err := req.RequireString("item_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing item_id: %v", err)), nil
		}

		affected, err := engine.ComputeImpact(ctx, itemID)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(affected)
	})

	s.AddTool(mcp.NewTool("inv_audit",
		mcp.WithDescription("Audit a node's inventory health: missing traces, unverified items, orphans"),
		mcp.WithString("node_id", mcp.Required(), mcp.Description("Node ID to audit")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		nodeID, err := req.RequireString("node_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing node_id: %v", err)), nil
		}

		report, err := engine.Audit(ctx, nodeID)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(report)
	})

	s.AddTool(mcp.NewTool("inv_create_cr",
		mcp.WithDescription("Create a change request for cross-inventory changes. Other nodes will vote."),
		mcp.WithString("title", mcp.Required(), mcp.Description("CR title")),
		mcp.WithString("description", mcp.Description("CR description")),
		mcp.WithString("proposer_id", mcp.Required(), mcp.Description("Proposer ID")),
		mcp.WithString("node_id", mcp.Required(), mcp.Description("Source node ID")),
		mcp.WithString("affected_items", mcp.Description("Comma-separated affected item IDs")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		title, err := req.RequireString("title")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing title: %v", err)), nil
		}
		desc, ok := req.GetArguments()["description"].(string)
		if !ok {
			desc = ""
		}
		proposer, err := req.RequireString("proposer_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing proposer_id: %v", err)), nil
		}
		nodeID, err := req.RequireString("node_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing node_id: %v", err)), nil
		}
		affectedStr, ok := req.GetArguments()["affected_items"].(string)
		if !ok {
			affectedStr = ""
		}

		var items []string
		if affectedStr != "" {
			items = strings.Split(affectedStr, ",")
		}

		cr, err := engine.CreateCR(ctx, title, desc, proposer, nodeID, items)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(cr)
	})

	s.AddTool(mcp.NewTool("inv_vote",
		mcp.WithDescription("Vote on a change request"),
		mcp.WithString("cr_id", mcp.Required(), mcp.Description("Change request ID")),
		mcp.WithString("node_id", mcp.Required(), mcp.Description("Voting node ID")),
		mcp.WithString("voter_id", mcp.Required(), mcp.Description("Voter ID")),
		mcp.WithString("decision", mcp.Required(), mcp.Description("Vote: approve, reject, request_changes, abstain")),
		mcp.WithString("reason", mcp.Description("Reason for vote")),
		mcp.WithBoolean("is_ai", mcp.Description("Whether this is an AI vote")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		crID, err := req.RequireString("cr_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing cr_id: %v", err)), nil
		}
		nodeID, err := req.RequireString("node_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing node_id: %v", err)), nil
		}
		voter, err := req.RequireString("voter_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing voter_id: %v", err)), nil
		}
		decision, err := req.RequireString("decision")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing decision: %v", err)), nil
		}
		reason, ok := req.GetArguments()["reason"].(string)
		if !ok {
			reason = ""
		}
		isAI, ok := req.GetArguments()["is_ai"].(bool)
		if !ok {
			isAI = false
		}

		if err := engine.CastVote(ctx, crID, nodeID, voter, VoteDecision(decision), reason, isAI); err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return mcp.NewToolResultText(fmt.Sprintf("Vote recorded: %s from %s", decision, voter)), nil
	})

	s.AddTool(mcp.NewTool("inv_ask",
		mcp.WithDescription("Ask a question to the network. When AI doesn't understand something, it queries other nodes for context."),
		mcp.WithString("asker_id", mcp.Required(), mcp.Description("Who is asking")),
		mcp.WithString("asker_node", mcp.Required(), mcp.Description("Asker's node ID")),
		mcp.WithString("question", mcp.Required(), mcp.Description("The question")),
		mcp.WithString("context", mcp.Description("Additional context")),
		mcp.WithString("target_node", mcp.Description("Target node ID (broadcast if empty)")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		askerID, err := req.RequireString("asker_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing asker_id: %v", err)), nil
		}
		askerNode, err := req.RequireString("asker_node")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing asker_node: %v", err)), nil
		}
		question, err := req.RequireString("question")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing question: %v", err)), nil
		}
		qCtx, ok := req.GetArguments()["context"].(string)
		if !ok {
			qCtx = ""
		}
		target, ok := req.GetArguments()["target_node"].(string)
		if !ok {
			target = ""
		}

		q, err := engine.AskNetwork(ctx, askerID, askerNode, question, qCtx, target)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(q)
	})

	s.AddTool(mcp.NewTool("inv_list_nodes",
		mcp.WithDescription("List all nodes in the network for a project"),
		mcp.WithString("project", mcp.Required(), mcp.Description("Project name")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		project, err := req.RequireString("project")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing project: %v", err)), nil
		}
		nodes, err := engine.ListNodes(ctx, project)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(nodes)
	})

	s.AddTool(mcp.NewTool("inv_list_items",
		mcp.WithDescription("List all items in a node's inventory"),
		mcp.WithString("node_id", mcp.Required(), mcp.Description("Node ID")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		nodeID, err := req.RequireString("node_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing node_id: %v", err)), nil
		}
		items, err := engine.ListItems(ctx, nodeID)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(items)
	})

	s.AddTool(mcp.NewTool("inv_checklist_add",
		mcp.WithDescription("Add a checklist criterion to an inventory item"),
		mcp.WithString("item_id", mcp.Required(), mcp.Description("Item ID")),
		mcp.WithString("criterion", mcp.Required(), mcp.Description("Criterion name (e.g., 'HIPAA compliant')")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		itemID, err := req.RequireString("item_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing item_id: %v", err)), nil
		}
		criterion, err := req.RequireString("criterion")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing criterion: %v", err)), nil
		}

		entry, err := engine.AddChecklistEntry(ctx, itemID, criterion)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(entry)
	})

	s.AddTool(mcp.NewTool("inv_checklist_check",
		mcp.WithDescription("Mark a checklist entry as checked with proof"),
		mcp.WithString("entry_id", mcp.Required(), mcp.Description("Checklist entry ID")),
		mcp.WithString("proof", mcp.Required(), mcp.Description("Evidence/proof for this criterion")),
		mcp.WithString("actor", mcp.Required(), mcp.Description("Who checked this")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		entryID, err := req.RequireString("entry_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing entry_id: %v", err)), nil
		}
		proof, err := req.RequireString("proof")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing proof: %v", err)), nil
		}
		actor, err := req.RequireString("actor")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing actor: %v", err)), nil
		}

		if err := engine.CheckEntry(ctx, entryID, proof, actor); err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return mcp.NewToolResultText("Checklist entry checked"), nil
	})

	s.AddTool(mcp.NewTool("inv_checklist_uncheck",
		mcp.WithDescription("Uncheck a checklist entry (removes proof)"),
		mcp.WithString("entry_id", mcp.Required(), mcp.Description("Checklist entry ID")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		entryID, err := req.RequireString("entry_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing entry_id: %v", err)), nil
		}

		if err := engine.UncheckEntry(ctx, entryID); err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return mcp.NewToolResultText("Checklist entry unchecked"), nil
	})

	s.AddTool(mcp.NewTool("inv_checklist_list",
		mcp.WithDescription("List all checklist entries for an item"),
		mcp.WithString("item_id", mcp.Required(), mcp.Description("Item ID")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		itemID, err := req.RequireString("item_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing item_id: %v", err)), nil
		}

		entries, err := engine.GetItemChecklist(ctx, itemID)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(entries)
	})

	s.AddTool(mcp.NewTool("inv_item_summary",
		mcp.WithDescription("Get item summary with checklist status (P2P-safe, no full body or proof details)"),
		mcp.WithString("item_id", mcp.Required(), mcp.Description("Item ID")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		itemID, err := req.RequireString("item_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing item_id: %v", err)), nil
		}

		summary, err := engine.GetItemSummary(ctx, itemID)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(summary)
	})

	s.AddTool(mcp.NewTool("inv_node_summaries",
		mcp.WithDescription("Get all item summaries for a node with checklist statuses"),
		mcp.WithString("node_id", mcp.Required(), mcp.Description("Node ID")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		nodeID, err := req.RequireString("node_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing node_id: %v", err)), nil
		}

		summaries, err := engine.GetNodeItemSummaries(ctx, nodeID)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(summaries)
	})

	s.AddTool(mcp.NewTool("inv_mark_broken",
		mcp.WithDescription("Mark an item as broken (transitions: proven->broke, suspect->broke)"),
		mcp.WithString("item_id", mcp.Required(), mcp.Description("Item ID to mark broken")),
		mcp.WithString("reason", mcp.Required(), mcp.Description("Reason for marking broken")),
		mcp.WithString("actor", mcp.Required(), mcp.Description("Who is marking it broken")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		itemID, err := req.RequireString("item_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing item_id: %v", err)), nil
		}
		reason, err := req.RequireString("reason")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing reason: %v", err)), nil
		}
		actor, err := req.RequireString("actor")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing actor: %v", err)), nil
		}

		if err := engine.MarkBroken(ctx, itemID, reason, actor); err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return mcp.NewToolResultText(fmt.Sprintf("Item %s marked as broke", itemID)), nil
	})

	s.AddTool(mcp.NewTool("inv_query",
		mcp.WithDescription("Search items with text search and structured filters"),
		mcp.WithString("text", mcp.Description("Text search (matches title and body)")),
		mcp.WithString("kind", mcp.Description("Filter by item kind")),
		mcp.WithString("status", mcp.Description("Filter by status: unverified, proven, suspect, broke")),
		mcp.WithString("node_id", mcp.Description("Filter by node ID")),
		mcp.WithString("external_ref", mcp.Description("Filter by external reference")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		filter := QueryFilter{}
		if v, ok := args["text"].(string); ok {
			filter.Text = v
		}
		if v, ok := args["kind"].(string); ok {
			filter.Kind = ItemKind(v)
		}
		if v, ok := args["status"].(string); ok {
			filter.Status = ItemStatus(v)
		}
		if v, ok := args["node_id"].(string); ok {
			filter.NodeID = v
		}
		if v, ok := args["external_ref"].(string); ok {
			filter.ExternalRef = v
		}

		items, err := engine.QueryItems(ctx, filter)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(items)
	})

	s.AddTool(mcp.NewTool("inv_sweep",
		mcp.WithDescription("Find all items matching an external ref and propagate impact to dependents"),
		mcp.WithString("external_ref", mcp.Required(), mcp.Description("External reference to sweep (e.g., US-003)")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		ref, err := req.RequireString("external_ref")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing external_ref: %v", err)), nil
		}

		result, err := engine.Sweep(ctx, ref)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(result)
	})

	s.AddTool(mcp.NewTool("inv_reconcile_start",
		mcp.WithDescription("Start a reconciliation session for a node's suspect items"),
		mcp.WithString("trigger_ref", mcp.Required(), mcp.Description("Trigger reference (e.g., sweep ref or CR ID)")),
		mcp.WithString("node_id", mcp.Required(), mcp.Description("Node ID to reconcile")),
		mcp.WithString("actor", mcp.Required(), mcp.Description("Who is starting the session")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		triggerRef, err := req.RequireString("trigger_ref")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing trigger_ref: %v", err)), nil
		}
		nodeID, err := req.RequireString("node_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing node_id: %v", err)), nil
		}
		actor, err := req.RequireString("actor")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing actor: %v", err)), nil
		}

		sess, err := engine.StartReconciliation(ctx, triggerRef, nodeID, actor)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(sess)
	})

	s.AddTool(mcp.NewTool("inv_reconcile_resolve",
		mcp.WithDescription("Resolve a single item in a reconciliation session"),
		mcp.WithString("session_id", mcp.Required(), mcp.Description("Reconciliation session ID")),
		mcp.WithString("item_id", mcp.Required(), mcp.Description("Item ID to resolve")),
		mcp.WithString("decision", mcp.Required(), mcp.Description("Decision: re_verified, marked_broke, deferred")),
		mcp.WithString("evidence", mcp.Required(), mcp.Description("Evidence for the decision")),
		mcp.WithString("actor", mcp.Required(), mcp.Description("Who is resolving")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		sessionID, err := req.RequireString("session_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing session_id: %v", err)), nil
		}
		itemID, err := req.RequireString("item_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing item_id: %v", err)), nil
		}
		decision, err := req.RequireString("decision")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing decision: %v", err)), nil
		}
		evidence, err := req.RequireString("evidence")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing evidence: %v", err)), nil
		}
		actor, err := req.RequireString("actor")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing actor: %v", err)), nil
		}

		entry, err := engine.ResolveItem(ctx, sessionID, itemID, decision, evidence, actor)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(entry)
	})

	s.AddTool(mcp.NewTool("inv_reconcile_complete",
		mcp.WithDescription("Complete a reconciliation session"),
		mcp.WithString("session_id", mcp.Required(), mcp.Description("Reconciliation session ID")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		sessionID, err := req.RequireString("session_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing session_id: %v", err)), nil
		}

		sess, err := engine.CompleteReconciliation(ctx, sessionID)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(sess)
	})

	s.AddTool(mcp.NewTool("inv_trace_up",
		mcp.WithDescription("Walk upstream trace chain from an item toward its sources/requirements"),
		mcp.WithString("item_id", mcp.Required(), mcp.Description("Starting item ID")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		itemID, err := req.RequireString("item_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing item_id: %v", err)), nil
		}

		chain, err := engine.TraceUp(ctx, itemID)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(chain)
	})

	s.AddTool(mcp.NewTool("inv_trace_down",
		mcp.WithDescription("Walk downstream trace chain from an item toward its dependents/implementations"),
		mcp.WithString("item_id", mcp.Required(), mcp.Description("Starting item ID")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		itemID, err := req.RequireString("item_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing item_id: %v", err)), nil
		}

		chain, err := engine.TraceDown(ctx, itemID)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(chain)
	})

	// --- P2P Network MCP Tools ---

	s.AddTool(mcp.NewTool("inv_network_status",
		mcp.WithDescription("Show P2P network status: peers, outbox, governance, reputation"),
		mcp.WithString("project", mcp.Required(), mcp.Description("Project name")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		project, err := req.RequireString("project")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing project: %v", err)), nil
		}
		peers, err := store.ListPeers(ctx, project)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		outboxDepth, _ := store.OutboxDepth(ctx)
		activeProposals, _ := store.ListAllActiveProposals(ctx)
		activeChallenges, _ := store.ListChallenges(ctx, ChallengeOpen)

		type NetworkStatus struct {
			Peers            int `json:"peers"`
			OutboxDepth      int `json:"outbox_depth"`
			ActiveProposals  int `json:"active_proposals"`
			ActiveChallenges int `json:"active_challenges"`
		}
		return resultJSON(NetworkStatus{
			Peers:            len(peers),
			OutboxDepth:      outboxDepth,
			ActiveProposals:  len(activeProposals),
			ActiveChallenges: len(activeChallenges),
		})
	})

	s.AddTool(mcp.NewTool("inv_network_peers",
		mcp.WithDescription("List discovered peers with reputation scores"),
		mcp.WithString("project", mcp.Required(), mcp.Description("Project name")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		project, err := req.RequireString("project")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing project: %v", err)), nil
		}
		peers, err := store.ListPeers(ctx, project)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		type PeerWithRep struct {
			Peer
			Reputation int `json:"reputation"`
		}
		var result []PeerWithRep
		for _, p := range peers {
			rep, _ := store.GetPeerReputation(ctx, p.PeerID)
			result = append(result, PeerWithRep{Peer: p, Reputation: rep})
		}
		return resultJSON(result)
	})

	s.AddTool(mcp.NewTool("inv_network_health",
		mcp.WithDescription("Machine-readable health status (JSON)"),
		mcp.WithString("project", mcp.Required(), mcp.Description("Project name")),
		mcp.WithString("peer_id", mcp.Required(), mcp.Description("Local peer ID")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		project, err := req.RequireString("project")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing project: %v", err)), nil
		}
		peerID, err := req.RequireString("peer_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing peer_id: %v", err)), nil
		}
		health, err := BuildHealthStatus(ctx, store, peerID, project, time.Now())
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(health)
	})

	s.AddTool(mcp.NewTool("inv_proposal_create",
		mcp.WithDescription("Create a governance proposal (change request, trace dispute, membership, challenge)"),
		mcp.WithString("kind", mcp.Required(), mcp.Description("Proposal kind: change_request, trace_dispute, sweep_acceptance, network_membership, challenge")),
		mcp.WithString("title", mcp.Required(), mcp.Description("Proposal title")),
		mcp.WithString("description", mcp.Description("Description")),
		mcp.WithString("proposer_peer", mcp.Required(), mcp.Description("Proposer peer ID")),
		mcp.WithString("owner_peer", mcp.Description("Owner peer ID (for veto)")),
		mcp.WithString("affected_items", mcp.Description("Comma-separated affected item IDs")),
		mcp.WithNumber("deadline_hours", mcp.Description("Deadline in hours (default 24)")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		kind, err := req.RequireString("kind")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing kind: %v", err)), nil
		}
		title, err := req.RequireString("title")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing title: %v", err)), nil
		}
		proposer, err := req.RequireString("proposer_peer")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing proposer_peer: %v", err)), nil
		}

		args := req.GetArguments()
		desc, _ := args["description"].(string)
		owner, _ := args["owner_peer"].(string)
		affectedStr, _ := args["affected_items"].(string)
		hours, _ := args["deadline_hours"].(float64)
		if hours == 0 {
			hours = 24
		}

		var items []string
		if affectedStr != "" {
			items = strings.Split(affectedStr, ",")
		}

		prop := &Proposal{
			Kind: ProposalKind(kind), Title: title, Description: desc,
			ProposerPeer: proposer, ProposerName: proposer, OwnerPeer: owner,
			AffectedItems: items, Deadline: time.Now().Add(time.Duration(hours) * time.Hour),
		}
		if err := store.CreateProposal(ctx, prop); err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(prop)
	})

	s.AddTool(mcp.NewTool("inv_proposal_vote",
		mcp.WithDescription("Vote on an active proposal"),
		mcp.WithString("proposal_id", mcp.Required(), mcp.Description("Proposal ID")),
		mcp.WithString("voter_peer", mcp.Required(), mcp.Description("Voter peer ID")),
		mcp.WithString("voter_id", mcp.Required(), mcp.Description("Voter ID")),
		mcp.WithString("decision", mcp.Required(), mcp.Description("Vote: approve or reject")),
		mcp.WithString("reason", mcp.Description("Reason")),
		mcp.WithBoolean("is_ai", mcp.Description("Is this an AI vote")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		proposalID, err := req.RequireString("proposal_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing proposal_id: %v", err)), nil
		}
		voterPeer, err := req.RequireString("voter_peer")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing voter_peer: %v", err)), nil
		}
		voterID, err := req.RequireString("voter_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing voter_id: %v", err)), nil
		}
		decision, err := req.RequireString("decision")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing decision: %v", err)), nil
		}

		args := req.GetArguments()
		reason, _ := args["reason"].(string)
		isAI, _ := args["is_ai"].(bool)

		vote := &ProposalVoteRecord{
			ProposalID: proposalID, VoterPeer: voterPeer, VoterID: voterID,
			Decision: decision, Reason: reason, IsAI: isAI,
		}
		if err := store.CreateProposalVote(ctx, vote); err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return mcp.NewToolResultText(fmt.Sprintf("Vote recorded: %s from %s", decision, voterPeer)), nil
	})

	s.AddTool(mcp.NewTool("inv_challenge_create",
		mcp.WithDescription("File a challenge against a peer's item or trace"),
		mcp.WithString("kind", mcp.Required(), mcp.Description("Challenge kind: stale_data, weak_evidence, trace_integrity")),
		mcp.WithString("challenger_peer", mcp.Required(), mcp.Description("Your peer ID")),
		mcp.WithString("challenged_peer", mcp.Required(), mcp.Description("Target peer ID")),
		mcp.WithString("target_item_id", mcp.Description("Target item ID (for stale_data/weak_evidence)")),
		mcp.WithString("target_trace_id", mcp.Description("Target trace ID (for trace_integrity)")),
		mcp.WithString("reason", mcp.Required(), mcp.Description("Reason for challenge")),
		mcp.WithString("evidence", mcp.Description("Supporting evidence")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		kind, err := req.RequireString("kind")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing kind: %v", err)), nil
		}
		challenger, err := req.RequireString("challenger_peer")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing challenger_peer: %v", err)), nil
		}
		challenged, err := req.RequireString("challenged_peer")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing challenged_peer: %v", err)), nil
		}
		reason, err := req.RequireString("reason")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing reason: %v", err)), nil
		}

		args := req.GetArguments()
		targetItem, _ := args["target_item_id"].(string)
		targetTrace, _ := args["target_trace_id"].(string)
		evidence, _ := args["evidence"].(string)

		ch, err := challengeEngine.CreateChallenge(ctx, ChallengeKind(kind), challenger, challenged, targetItem, targetTrace, reason, evidence, 24*time.Hour)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(ch)
	})

	s.AddTool(mcp.NewTool("inv_challenge_respond",
		mcp.WithDescription("Respond to a challenge against your node"),
		mcp.WithString("challenge_id", mcp.Required(), mcp.Description("Challenge ID")),
		mcp.WithString("evidence", mcp.Required(), mcp.Description("Evidence for your response")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		challengeID, err := req.RequireString("challenge_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing challenge_id: %v", err)), nil
		}
		evidence, err := req.RequireString("evidence")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing evidence: %v", err)), nil
		}

		if err := challengeEngine.RespondToChallenge(ctx, challengeID, evidence); err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return mcp.NewToolResultText(fmt.Sprintf("Response submitted for challenge %s", challengeID)), nil
	})

	s.AddTool(mcp.NewTool("inv_challenge_list",
		mcp.WithDescription("List challenges (all open, incoming, or outgoing)"),
		mcp.WithString("peer_id", mcp.Description("Your peer ID (for incoming/outgoing filter)")),
		mcp.WithBoolean("incoming", mcp.Description("Show challenges against your node")),
		mcp.WithBoolean("outgoing", mcp.Description("Show challenges you filed")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args := req.GetArguments()
		peerID, _ := args["peer_id"].(string)
		incoming, _ := args["incoming"].(bool)
		outgoing, _ := args["outgoing"].(bool)

		if peerID != "" && (incoming || outgoing) {
			challenges, err := store.ListChallengesByPeer(ctx, peerID, incoming)
			if err != nil {
				return mcp.NewToolResultError(err.Error()), nil
			}
			return resultJSON(challenges)
		}

		challenges, err := store.ListChallenges(ctx, ChallengeOpen)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(challenges)
	})

	// --- Workflow MCP Tools ---

	s.AddTool(mcp.NewTool("inv_pending_events",
		mcp.WithDescription("Get pending (unread) events — challenges, proposals, peer joins, signals, queries"),
		mcp.WithBoolean("acknowledge", mcp.Description("Mark returned events as read after fetching")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		events, err := engine.GetPendingEvents(ctx)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}

		ack, _ := req.GetArguments()["acknowledge"].(bool)
		if ack && len(events) > 0 {
			ids := make([]string, len(events))
			for i, e := range events {
				ids[i] = e.ID
			}
			if err := engine.AcknowledgeEvents(ctx, ids); err != nil {
				return mcp.NewToolResultError(fmt.Sprintf("acknowledge: %v", err)), nil
			}
		}

		return resultJSON(events)
	})

	s.AddTool(mcp.NewTool("inv_session_status",
		mcp.WithDescription("Get comprehensive session status: nodes, suspect/broken items, pending CRs, challenges, queries, audit, events"),
		mcp.WithString("project", mcp.Required(), mcp.Description("Project name")),
		mcp.WithString("node_id", mcp.Required(), mcp.Description("Your node ID")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		project, err := req.RequireString("project")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing project: %v", err)), nil
		}
		nodeID, err := req.RequireString("node_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing node_id: %v", err)), nil
		}

		status, err := engine.GetSessionStatus(ctx, project, nodeID)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(status)
	})

	s.AddTool(mcp.NewTool("inv_config_mode",
		mcp.WithDescription("Get or set permission mode. Returns current mode and action-level permission matrix."),
		mcp.WithString("new_mode", mcp.Description("Set mode: 'normal' or 'autonomous' (omit to just read current)")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		cfgPath := InvDirPath() + "/config.yaml"
		cfg, err := LoadNodeConfig(cfgPath)
		if err != nil {
			cfg = DefaultNodeConfig()
		}

		if newMode, ok := req.GetArguments()["new_mode"].(string); ok && newMode != "" {
			mode := PermissionMode(newMode)
			if !IsValidPermissionMode(mode) {
				return mcp.NewToolResultError(fmt.Sprintf("invalid mode: %s (must be 'normal' or 'autonomous')", newMode)), nil
			}
			cfg.Node.PermissionMode = mode
			if err := WriteNodeConfig(cfgPath, cfg); err != nil {
				return mcp.NewToolResultError(fmt.Sprintf("save config: %v", err)), nil
			}
		}

		mode := cfg.Node.PermissionMode
		if mode == "" {
			mode = PermissionNormal
		}
		return resultJSON(BuildConfigModeResponse(mode))
	})

	s.AddTool(mcp.NewTool("inv_audit_all",
		mcp.WithDescription("Audit all nodes in a project — cross-inventory oversight for project leads"),
		mcp.WithString("project", mcp.Required(), mcp.Description("Project name")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		project, err := req.RequireString("project")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing project: %v", err)), nil
		}

		reports, err := engine.AuditAllNodes(ctx, project)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(reports)
	})

	// --- Pairing Session MCP Tools ---

	s.AddTool(mcp.NewTool("inv_pair_invite",
		mcp.WithDescription("Invite a guest to a pairing session between two nodes"),
		mcp.WithString("host_peer", mcp.Required(), mcp.Description("Host peer ID")),
		mcp.WithString("host_node", mcp.Required(), mcp.Description("Host node ID")),
		mcp.WithString("guest_peer", mcp.Required(), mcp.Description("Guest peer ID")),
		mcp.WithString("guest_node", mcp.Required(), mcp.Description("Guest node ID")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		hostPeer, err := req.RequireString("host_peer")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing host_peer: %v", err)), nil
		}
		hostNode, err := req.RequireString("host_node")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing host_node: %v", err)), nil
		}
		guestPeer, err := req.RequireString("guest_peer")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing guest_peer: %v", err)), nil
		}
		guestNode, err := req.RequireString("guest_node")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing guest_node: %v", err)), nil
		}

		sess, err := engine.InvitePair(ctx, hostPeer, hostNode, guestPeer, guestNode)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(sess)
	})

	s.AddTool(mcp.NewTool("inv_pair_join",
		mcp.WithDescription("Accept a pairing session invitation"),
		mcp.WithString("session_id", mcp.Required(), mcp.Description("Pairing session ID")),
		mcp.WithString("guest_peer", mcp.Required(), mcp.Description("Guest peer ID")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		sessionID, err := req.RequireString("session_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing session_id: %v", err)), nil
		}
		guestPeer, err := req.RequireString("guest_peer")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing guest_peer: %v", err)), nil
		}

		sess, err := engine.AcceptPair(ctx, sessionID, guestPeer)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(sess)
	})

	s.AddTool(mcp.NewTool("inv_pair_end",
		mcp.WithDescription("End an active pairing session"),
		mcp.WithString("session_id", mcp.Required(), mcp.Description("Pairing session ID")),
		mcp.WithString("peer", mcp.Required(), mcp.Description("Your peer ID (must be host or guest)")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		sessionID, err := req.RequireString("session_id")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing session_id: %v", err)), nil
		}
		peerID, err := req.RequireString("peer")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing peer: %v", err)), nil
		}

		sess, err := engine.EndPair(ctx, sessionID, peerID)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(sess)
	})

	s.AddTool(mcp.NewTool("inv_pair_list",
		mcp.WithDescription("List active pairing sessions for a peer"),
		mcp.WithString("peer", mcp.Required(), mcp.Description("Peer ID to list sessions for")),
	), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		peerID, err := req.RequireString("peer")
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("missing peer: %v", err)), nil
		}

		sessions, err := engine.ListPairingSessions(ctx, peerID)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(sessions)
	})

	return server.ServeStdio(s)
}


func resultJSON(v any) (*mcp.CallToolResult, error) {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return mcp.NewToolResultText(string(data)), nil
}
