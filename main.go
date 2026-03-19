package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	pumped "github.com/pumped-fn/pumped-go"
	"github.com/rs/zerolog"
	"github.com/spf13/cobra"
)

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
		markBrokenCmd(engine, agentLog, sysLog),
		impactCmd(engine, agentLog, sysLog),
		auditCmd(engine, agentLog, sysLog),
		crCmd(engine, agentLog, sysLog),
		askCmd(engine, agentLog, sysLog),
		checklistCmd(engine, agentLog, sysLog),
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

func nodeCmd(e *Engine, agentLog, sysLog *zerolog.Logger) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "node",
		Short: "Manage network nodes (inventories)",
	}

	addCmd := &cobra.Command{
		Use:   "add",
		Short: "Register a new node in the network",
		RunE: func(cmd *cobra.Command, args []string) error {
			name, _ := cmd.Flags().GetString("name")
			vertical, _ := cmd.Flags().GetString("vertical")
			project, _ := cmd.Flags().GetString("project")
			owner, _ := cmd.Flags().GetString("owner")
			isAI, _ := cmd.Flags().GetBool("ai")

			node, err := e.RegisterNode(context.Background(), name, Vertical(vertical), project, owner, isAI)
			if err != nil {
				sysLog.Error().Err(err).Str("name", name).Msg("failed to register node")
				return err
			}
			data, _ := json.Marshal(node)
			agentLog.Info().RawJSON("data", data).Str("command", "node.add").Msg("node registered")
			return nil
		},
	}
	addCmd.Flags().String("name", "", "Node name")
	addCmd.Flags().String("vertical", "dev", "Vertical (pm, design, dev, qa, devops)")
	addCmd.Flags().String("project", "clinic-checkin", "Project name")
	addCmd.Flags().String("owner", "", "Owner name")
	addCmd.Flags().Bool("ai", false, "Is this an AI-managed node")
	addCmd.MarkFlagRequired("name")
	addCmd.MarkFlagRequired("owner")

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
	listCmd.Flags().String("project", "clinic-checkin", "Project name")

	cmd.AddCommand(addCmd, listCmd)
	return cmd
}

func itemCmd(e *Engine, agentLog, sysLog *zerolog.Logger) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "item",
		Short: "Manage inventory items",
	}

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
				sysLog.Error().Err(err).Str("node", nodeID).Msg("failed to add item")
				return err
			}
			data, _ := json.Marshal(item)
			agentLog.Info().RawJSON("data", data).Str("command", "item.add").Msg("item created")
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

	listCmd := &cobra.Command{
		Use:   "list",
		Short: "List items in a node",
		RunE: func(cmd *cobra.Command, args []string) error {
			nodeID, _ := cmd.Flags().GetString("node")

			items, err := e.ListItems(context.Background(), nodeID)
			if err != nil {
				sysLog.Error().Err(err).Str("node", nodeID).Msg("failed to list items")
				return err
			}
			data, _ := json.Marshal(items)
			agentLog.Info().RawJSON("data", data).Str("command", "item.list").Msg("items listed")
			return nil
		},
	}
	listCmd.Flags().String("node", "", "Node ID")
	listCmd.MarkFlagRequired("node")

	historyCmd := &cobra.Command{
		Use:   "history [item-id]",
		Short: "Show transition history for an item",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			transitions, err := e.GetItemTransitions(context.Background(), args[0])
			if err != nil {
				sysLog.Error().Err(err).Str("item", args[0]).Msg("failed to get transitions")
				return err
			}
			data, _ := json.Marshal(transitions)
			agentLog.Info().RawJSON("data", data).Str("command", "item.history").Msg("transitions listed")
			return nil
		},
	}

	cmd.AddCommand(addCmd, listCmd, historyCmd)
	return cmd
}

func traceCmd(e *Engine, agentLog, sysLog *zerolog.Logger) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "trace",
		Short: "Manage traces between items",
	}

	addCmd := &cobra.Command{
		Use:   "add",
		Short: "Create a trace between two items",
		RunE: func(cmd *cobra.Command, args []string) error {
			from, _ := cmd.Flags().GetString("from")
			to, _ := cmd.Flags().GetString("to")
			relation, _ := cmd.Flags().GetString("relation")
			actor, _ := cmd.Flags().GetString("actor")

			trace, err := e.AddTrace(context.Background(), from, to, TraceRelation(relation), actor)
			if err != nil {
				sysLog.Error().Err(err).Str("from", from).Str("to", to).Msg("failed to add trace")
				return err
			}
			data, _ := json.Marshal(trace)
			agentLog.Info().RawJSON("data", data).Str("command", "trace.add").Msg("trace created")
			return nil
		},
	}
	addCmd.Flags().String("from", "", "Source item ID")
	addCmd.Flags().String("to", "", "Target item ID")
	addCmd.Flags().String("relation", "traced_from", "Relation (traced_from, matched_by, proven_by)")
	addCmd.Flags().String("actor", "", "Who confirmed this trace")
	addCmd.MarkFlagRequired("from")
	addCmd.MarkFlagRequired("to")
	addCmd.MarkFlagRequired("actor")

	showCmd := &cobra.Command{
		Use:   "show [item-id]",
		Short: "Show all traces for an item",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			traces, err := e.GetItemTraces(context.Background(), args[0])
			if err != nil {
				sysLog.Error().Err(err).Str("item", args[0]).Msg("failed to get traces")
				return err
			}
			data, _ := json.Marshal(traces)
			agentLog.Info().RawJSON("data", data).Str("command", "trace.show").Msg("traces listed")
			return nil
		},
	}

	upCmd := &cobra.Command{
		Use:   "up [item-id]",
		Short: "Walk upstream trace chain (toward sources/requirements)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			chain, err := e.TraceUp(context.Background(), args[0])
			if err != nil {
				sysLog.Error().Err(err).Str("item", args[0]).Msg("failed to trace up")
				return err
			}
			data, _ := json.Marshal(chain)
			agentLog.Info().RawJSON("data", data).Str("command", "trace.up").Msg("upstream chain")
			return nil
		},
	}

	downCmd := &cobra.Command{
		Use:   "down [item-id]",
		Short: "Walk downstream trace chain (toward dependents/implementations)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			chain, err := e.TraceDown(context.Background(), args[0])
			if err != nil {
				sysLog.Error().Err(err).Str("item", args[0]).Msg("failed to trace down")
				return err
			}
			data, _ := json.Marshal(chain)
			agentLog.Info().RawJSON("data", data).Str("command", "trace.down").Msg("downstream chain")
			return nil
		},
	}

	cmd.AddCommand(addCmd, showCmd, upCmd, downCmd)
	return cmd
}

func verifyCmd(e *Engine, agentLog, sysLog *zerolog.Logger) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "verify [item-id]",
		Short: "Verify an item with evidence (transitions: unverified->proven, suspect->proven, broke->proven)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			evidence, _ := cmd.Flags().GetString("evidence")
			actor, _ := cmd.Flags().GetString("actor")

			if err := e.VerifyItem(context.Background(), args[0], evidence, actor); err != nil {
				sysLog.Error().Err(err).Str("item", args[0]).Msg("failed to verify")
				return err
			}

			item, err := e.GetItem(context.Background(), args[0])
			if err != nil {
				sysLog.Error().Err(err).Str("item", args[0]).Msg("failed to get item after verify")
				return err
			}

			signals, err := e.PropagateChange(context.Background(), args[0])
			if err != nil {
				sysLog.Error().Err(err).Str("item", args[0]).Msg("failed to propagate")
				return err
			}

			type VerifyOutput struct {
				Item              *Item    `json:"item"`
				SignalsPropagated int      `json:"signals_propagated"`
				AffectedItems     []string `json:"affected_items,omitempty"`
			}
			out := VerifyOutput{Item: item, SignalsPropagated: len(signals)}
			for _, sig := range signals {
				out.AffectedItems = append(out.AffectedItems, sig.TargetItem)
			}
			data, _ := json.Marshal(out)
			agentLog.Info().RawJSON("data", data).Str("command", "verify").Msg("item verified")
			return nil
		},
	}
	cmd.Flags().String("evidence", "", "Evidence for verification")
	cmd.Flags().String("actor", "", "Who is verifying")
	cmd.MarkFlagRequired("evidence")
	cmd.MarkFlagRequired("actor")
	return cmd
}

func markBrokenCmd(e *Engine, agentLog, sysLog *zerolog.Logger) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "mark-broken [item-id]",
		Short: "Mark an item as broken with a reason",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			reason, _ := cmd.Flags().GetString("reason")
			actor, _ := cmd.Flags().GetString("actor")

			if err := e.MarkBroken(context.Background(), args[0], reason, actor); err != nil {
				sysLog.Error().Err(err).Str("item", args[0]).Msg("failed to mark broken")
				return err
			}
			agentLog.Info().Str("item_id", args[0]).Str("status", "broke").Str("command", "mark-broken").Msg("item marked broken")
			return nil
		},
	}
	cmd.Flags().String("reason", "", "Reason for marking broken")
	cmd.Flags().String("actor", "", "Who is marking it broken")
	cmd.MarkFlagRequired("reason")
	cmd.MarkFlagRequired("actor")
	return cmd
}

func impactCmd(e *Engine, agentLog, sysLog *zerolog.Logger) *cobra.Command {
	return &cobra.Command{
		Use:   "impact [item-id]",
		Short: "Show what would be affected if this item changes",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			affected, err := e.ComputeImpact(context.Background(), args[0])
			if err != nil {
				sysLog.Error().Err(err).Str("item", args[0]).Msg("failed to compute impact")
				return err
			}
			data, _ := json.Marshal(affected)
			agentLog.Info().RawJSON("data", data).Str("command", "impact").Msg("impact computed")
			return nil
		},
	}
}

func auditCmd(e *Engine, agentLog, sysLog *zerolog.Logger) *cobra.Command {
	return &cobra.Command{
		Use:   "audit [node-id]",
		Short: "Audit a node's inventory health",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			report, err := e.Audit(context.Background(), args[0])
			if err != nil {
				sysLog.Error().Err(err).Str("node", args[0]).Msg("failed to audit")
				return err
			}
			data, _ := json.Marshal(report)
			agentLog.Info().RawJSON("data", data).Str("command", "audit").Msg("audit complete")
			return nil
		},
	}
}

func crCmd(e *Engine, agentLog, sysLog *zerolog.Logger) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "cr",
		Short: "Manage change requests in the network",
	}

	createCmd := &cobra.Command{
		Use:   "create",
		Short: "Create a change request",
		RunE: func(cmd *cobra.Command, args []string) error {
			title, _ := cmd.Flags().GetString("title")
			desc, _ := cmd.Flags().GetString("description")
			proposer, _ := cmd.Flags().GetString("proposer")
			nodeID, _ := cmd.Flags().GetString("node")
			affected, _ := cmd.Flags().GetString("affected")

			var items []string
			if affected != "" {
				items = strings.Split(affected, ",")
			}

			cr, err := e.CreateCR(context.Background(), title, desc, proposer, nodeID, items)
			if err != nil {
				sysLog.Error().Err(err).Str("title", title).Msg("failed to create CR")
				return err
			}
			data, _ := json.Marshal(cr)
			agentLog.Info().RawJSON("data", data).Str("command", "cr.create").Msg("CR created")
			return nil
		},
	}
	createCmd.Flags().String("title", "", "CR title")
	createCmd.Flags().String("description", "", "CR description")
	createCmd.Flags().String("proposer", "", "Proposer ID")
	createCmd.Flags().String("node", "", "Source node ID")
	createCmd.Flags().String("affected", "", "Comma-separated affected item IDs")
	createCmd.MarkFlagRequired("title")
	createCmd.MarkFlagRequired("proposer")
	createCmd.MarkFlagRequired("node")

	submitCmd := &cobra.Command{
		Use:   "submit [cr-id]",
		Short: "Submit a CR for review",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := e.SubmitCR(context.Background(), args[0]); err != nil {
				sysLog.Error().Err(err).Str("cr", args[0]).Msg("failed to submit CR")
				return err
			}
			agentLog.Info().Str("cr_id", args[0]).Str("command", "cr.submit").Msg("CR submitted")
			return nil
		},
	}

	voteCmd := &cobra.Command{
		Use:   "vote [cr-id]",
		Short: "Vote on a change request",
		RunE: func(cmd *cobra.Command, args []string) error {
			nodeID, _ := cmd.Flags().GetString("node")
			voter, _ := cmd.Flags().GetString("voter")
			decision, _ := cmd.Flags().GetString("decision")
			reason, _ := cmd.Flags().GetString("reason")
			isAI, _ := cmd.Flags().GetBool("ai")

			if err := e.CastVote(context.Background(), args[0], nodeID, voter, VoteDecision(decision), reason, isAI); err != nil {
				sysLog.Error().Err(err).Str("cr", args[0]).Msg("failed to cast vote")
				return err
			}
			agentLog.Info().Str("cr_id", args[0]).Str("voter", voter).Str("decision", decision).Str("command", "cr.vote").Msg("vote recorded")
			return nil
		},
	}
	voteCmd.Flags().String("node", "", "Voting node ID")
	voteCmd.Flags().String("voter", "", "Voter ID")
	voteCmd.Flags().String("decision", "", "Vote (approve, reject, request_changes, abstain)")
	voteCmd.Flags().String("reason", "", "Reason for vote")
	voteCmd.Flags().Bool("ai", false, "Is this an AI vote")
	voteCmd.MarkFlagRequired("node")
	voteCmd.MarkFlagRequired("voter")
	voteCmd.MarkFlagRequired("decision")

	resolveCmd := &cobra.Command{
		Use:   "resolve [cr-id]",
		Short: "Tally votes and resolve a CR",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := e.ResolveCR(context.Background(), args[0]); err != nil {
				sysLog.Error().Err(err).Str("cr", args[0]).Msg("failed to resolve CR")
				return err
			}
			cr, err := e.store.GetChangeRequest(context.Background(), args[0])
			if err != nil {
				sysLog.Error().Err(err).Str("cr", args[0]).Msg("failed to get CR after resolve")
				return err
			}
			data, _ := json.Marshal(cr)
			agentLog.Info().RawJSON("data", data).Str("command", "cr.resolve").Msg("CR resolved")
			return nil
		},
	}

	cmd.AddCommand(createCmd, submitCmd, voteCmd, resolveCmd)
	return cmd
}

func askCmd(e *Engine, agentLog, sysLog *zerolog.Logger) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "ask",
		Short: "Ask a question to the network",
		RunE: func(cmd *cobra.Command, args []string) error {
			asker, _ := cmd.Flags().GetString("asker")
			node, _ := cmd.Flags().GetString("node")
			question, _ := cmd.Flags().GetString("question")
			ctx_, _ := cmd.Flags().GetString("context")
			target, _ := cmd.Flags().GetString("target")

			q, err := e.AskNetwork(context.Background(), asker, node, question, ctx_, target)
			if err != nil {
				sysLog.Error().Err(err).Str("asker", asker).Msg("failed to ask network")
				return err
			}
			data, _ := json.Marshal(q)
			agentLog.Info().RawJSON("data", data).Str("command", "ask").Msg("query posted")
			return nil
		},
	}
	cmd.Flags().String("asker", "", "Asker ID")
	cmd.Flags().String("node", "", "Asker's node ID")
	cmd.Flags().String("question", "", "The question")
	cmd.Flags().String("context", "", "Additional context")
	cmd.Flags().String("target", "", "Target node ID (optional, broadcast if empty)")
	cmd.MarkFlagRequired("asker")
	cmd.MarkFlagRequired("node")
	cmd.MarkFlagRequired("question")
	return cmd
}

func checklistCmd(e *Engine, agentLog, sysLog *zerolog.Logger) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "checklist",
		Short: "Manage item checklists (criteria with proof)",
	}

	addCmd := &cobra.Command{
		Use:   "add",
		Short: "Add a checklist criterion to an item",
		RunE: func(cmd *cobra.Command, args []string) error {
			itemID, _ := cmd.Flags().GetString("item")
			criterion, _ := cmd.Flags().GetString("criterion")

			entry, err := e.AddChecklistEntry(context.Background(), itemID, criterion)
			if err != nil {
				sysLog.Error().Err(err).Str("item", itemID).Msg("failed to add checklist entry")
				return err
			}
			data, _ := json.Marshal(entry)
			agentLog.Info().RawJSON("data", data).Str("command", "checklist.add").Msg("checklist entry added")
			return nil
		},
	}
	addCmd.Flags().String("item", "", "Item ID")
	addCmd.Flags().String("criterion", "", "Criterion name (e.g., 'HIPAA compliant')")
	addCmd.MarkFlagRequired("item")
	addCmd.MarkFlagRequired("criterion")

	checkCmd := &cobra.Command{
		Use:   "check [entry-id]",
		Short: "Mark a checklist entry as checked with proof",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			proof, _ := cmd.Flags().GetString("proof")
			actor, _ := cmd.Flags().GetString("actor")

			if err := e.CheckEntry(context.Background(), args[0], proof, actor); err != nil {
				sysLog.Error().Err(err).Str("entry", args[0]).Msg("failed to check entry")
				return err
			}
			agentLog.Info().Str("entry_id", args[0]).Str("command", "checklist.check").Msg("checklist entry checked")
			return nil
		},
	}
	checkCmd.Flags().String("proof", "", "Evidence/proof for this criterion")
	checkCmd.Flags().String("actor", "", "Who checked this")
	checkCmd.MarkFlagRequired("proof")
	checkCmd.MarkFlagRequired("actor")

	uncheckCmd := &cobra.Command{
		Use:   "uncheck [entry-id]",
		Short: "Uncheck a checklist entry",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := e.UncheckEntry(context.Background(), args[0]); err != nil {
				sysLog.Error().Err(err).Str("entry", args[0]).Msg("failed to uncheck entry")
				return err
			}
			agentLog.Info().Str("entry_id", args[0]).Str("command", "checklist.uncheck").Msg("checklist entry unchecked")
			return nil
		},
	}

	listCmd := &cobra.Command{
		Use:   "list",
		Short: "List checklist entries for an item",
		RunE: func(cmd *cobra.Command, args []string) error {
			itemID, _ := cmd.Flags().GetString("item")

			entries, err := e.GetItemChecklist(context.Background(), itemID)
			if err != nil {
				sysLog.Error().Err(err).Str("item", itemID).Msg("failed to list checklist")
				return err
			}
			data, _ := json.Marshal(entries)
			agentLog.Info().RawJSON("data", data).Str("command", "checklist.list").Msg("checklist listed")
			return nil
		},
	}
	listCmd.Flags().String("item", "", "Item ID")
	listCmd.MarkFlagRequired("item")

	cmd.AddCommand(addCmd, checkCmd, uncheckCmd, listCmd)
	return cmd
}

func queryCmd(e *Engine, agentLog, sysLog *zerolog.Logger) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "query",
		Short: "Search items with text and structured filters",
		RunE: func(cmd *cobra.Command, args []string) error {
			text, _ := cmd.Flags().GetString("text")
			kind, _ := cmd.Flags().GetString("kind")
			status, _ := cmd.Flags().GetString("status")
			nodeID, _ := cmd.Flags().GetString("node")
			ref, _ := cmd.Flags().GetString("ref")

			filter := QueryFilter{
				Text:        text,
				Kind:        ItemKind(kind),
				Status:      ItemStatus(status),
				NodeID:      nodeID,
				ExternalRef: ref,
			}

			items, err := e.QueryItems(context.Background(), filter)
			if err != nil {
				sysLog.Error().Err(err).Msg("failed to query items")
				return err
			}
			data, _ := json.Marshal(items)
			agentLog.Info().RawJSON("data", data).Int("count", len(items)).Str("command", "query").Msg("query results")
			return nil
		},
	}
	cmd.Flags().String("text", "", "Text search (matches title and body)")
	cmd.Flags().String("kind", "", "Filter by item kind")
	cmd.Flags().String("status", "", "Filter by status (unverified, proven, suspect, broke)")
	cmd.Flags().String("node", "", "Filter by node ID")
	cmd.Flags().String("ref", "", "Filter by external reference")
	return cmd
}

func sweepCmd(e *Engine, agentLog, sysLog *zerolog.Logger) *cobra.Command {
	return &cobra.Command{
		Use:   "sweep [external-ref]",
		Short: "Find all items matching an external ref and propagate impact",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			result, err := e.Sweep(context.Background(), args[0])
			if err != nil {
				sysLog.Error().Err(err).Str("ref", args[0]).Msg("failed to sweep")
				return err
			}
			data, _ := json.Marshal(result)
			agentLog.Info().RawJSON("data", data).Str("command", "sweep").Msg("sweep complete")
			return nil
		},
	}
}

func reconcileCmd(e *Engine, agentLog, sysLog *zerolog.Logger) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "reconcile",
		Short: "Manage reconciliation sessions for suspect items",
	}

	startCmd := &cobra.Command{
		Use:   "start",
		Short: "Start a reconciliation session for a node's suspect items",
		RunE: func(cmd *cobra.Command, args []string) error {
			triggerRef, _ := cmd.Flags().GetString("trigger")
			nodeID, _ := cmd.Flags().GetString("node")
			actor, _ := cmd.Flags().GetString("actor")

			sess, err := e.StartReconciliation(context.Background(), triggerRef, nodeID, actor)
			if err != nil {
				sysLog.Error().Err(err).Str("node", nodeID).Msg("failed to start reconciliation")
				return err
			}
			data, _ := json.Marshal(sess)
			agentLog.Info().RawJSON("data", data).Str("command", "reconcile.start").Msg("reconciliation started")
			return nil
		},
	}
	startCmd.Flags().String("trigger", "", "Trigger reference (e.g., sweep ref or CR ID)")
	startCmd.Flags().String("node", "", "Node ID to reconcile")
	startCmd.Flags().String("actor", "", "Who is starting the session")
	startCmd.MarkFlagRequired("trigger")
	startCmd.MarkFlagRequired("node")
	startCmd.MarkFlagRequired("actor")

	resolveItemCmd := &cobra.Command{
		Use:   "resolve",
		Short: "Resolve a single item in a reconciliation session",
		RunE: func(cmd *cobra.Command, args []string) error {
			sessionID, _ := cmd.Flags().GetString("session")
			itemID, _ := cmd.Flags().GetString("item")
			decision, _ := cmd.Flags().GetString("decision")
			evidence, _ := cmd.Flags().GetString("evidence")
			actor, _ := cmd.Flags().GetString("actor")

			entry, err := e.ResolveItem(context.Background(), sessionID, itemID, decision, evidence, actor)
			if err != nil {
				sysLog.Error().Err(err).Str("session", sessionID).Str("item", itemID).Msg("failed to resolve item")
				return err
			}
			data, _ := json.Marshal(entry)
			agentLog.Info().RawJSON("data", data).Str("command", "reconcile.resolve").Msg("item resolved")
			return nil
		},
	}
	resolveItemCmd.Flags().String("session", "", "Session ID")
	resolveItemCmd.Flags().String("item", "", "Item ID to resolve")
	resolveItemCmd.Flags().String("decision", "", "Decision: re_verified, marked_broke, deferred")
	resolveItemCmd.Flags().String("evidence", "", "Evidence for the decision")
	resolveItemCmd.Flags().String("actor", "", "Who is resolving")
	resolveItemCmd.MarkFlagRequired("session")
	resolveItemCmd.MarkFlagRequired("item")
	resolveItemCmd.MarkFlagRequired("decision")
	resolveItemCmd.MarkFlagRequired("actor")

	completeCmd := &cobra.Command{
		Use:   "complete [session-id]",
		Short: "Complete a reconciliation session",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			sess, err := e.CompleteReconciliation(context.Background(), args[0])
			if err != nil {
				sysLog.Error().Err(err).Str("session", args[0]).Msg("failed to complete reconciliation")
				return err
			}
			data, _ := json.Marshal(sess)
			agentLog.Info().RawJSON("data", data).Str("command", "reconcile.complete").Msg("reconciliation completed")
			return nil
		},
	}

	cmd.AddCommand(startCmd, resolveItemCmd, completeCmd)
	return cmd
}

func mcpCmd(scope *pumped.Scope) *cobra.Command {
	return &cobra.Command{
		Use:   "mcp",
		Short: "Start MCP server for AI agent integration",
		RunE: func(cmd *cobra.Command, args []string) error {
			engine, err := pumped.Resolve(scope, NetworkEngine)
			if err != nil {
				return fmt.Errorf("resolve engine: %w", err)
			}
			return serveMCP(engine)
		},
	}
}
