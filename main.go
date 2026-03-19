package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"text/tabwriter"
	"time"

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

	store, err := pumped.Resolve(scope, DBStore)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to resolve store: %v\n", err)
		os.Exit(1)
	}

	proposalEng, err := pumped.Resolve(scope, ProposalEngineProvider)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to resolve proposal engine: %v\n", err)
		os.Exit(1)
	}

	challengeEng, err := pumped.Resolve(scope, ChallengeEngineProvider)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to resolve challenge engine: %v\n", err)
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
		initCmd(),
		serveCmd(scope),
		networkCmd(engine, store),
		proposalCmd(store, proposalEng),
		challengeCmd(store, challengeEng),
		pairCmd(engine, store, agentLog, sysLog),
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
		Short: "Create a trace between two items (supports cross-node: peer_id:item_id)",
		RunE: func(cmd *cobra.Command, args []string) error {
			from, _ := cmd.Flags().GetString("from")
			to, _ := cmd.Flags().GetString("to")
			relation, _ := cmd.Flags().GetString("relation")
			actor, _ := cmd.Flags().GetString("actor")

			// Check for cross-node trace (peer_id:item_id format)
			var toPeerID string
			if strings.Contains(to, ":") {
				parts := strings.SplitN(to, ":", 2)
				toPeerID = parts[0]
				to = parts[1]
			}

			trace, err := e.AddTrace(context.Background(), from, to, TraceRelation(relation), actor)
			if err != nil && toPeerID != "" {
				// For cross-node traces, the to_item_id might not exist locally
				sysLog.Warn().Str("from", from).Str("to_peer", toPeerID).Str("to_item", to).Msg("cross-node trace target not local")
				fmt.Fprintf(os.Stderr, "Cross-node trace: %s -> %s:%s\n", from[:8], toPeerID[:12]+"...", to[:8])
				return nil
			}
			if err != nil {
				sysLog.Error().Err(err).Str("from", from).Str("to", to).Msg("failed to add trace")
				return err
			}

			if toPeerID != "" {
				trace.ToPeerID = toPeerID
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
			store, err := pumped.Resolve(scope, DBStore)
			if err != nil {
				return fmt.Errorf("resolve store: %w", err)
			}
			challengeEng, err := pumped.Resolve(scope, ChallengeEngineProvider)
			if err != nil {
				return fmt.Errorf("resolve challenge engine: %w", err)
			}
			return serveMCP(engine, store, challengeEng)
		},
	}
}

func initCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "init",
		Short: "Initialize a new inv node (generate identity, write config, create database)",
		RunE: func(cmd *cobra.Command, args []string) error {
			name, _ := cmd.Flags().GetString("name")
			vertical, _ := cmd.Flags().GetString("vertical")
			project, _ := cmd.Flags().GetString("project")
			owner, _ := cmd.Flags().GetString("owner")
			isAI, _ := cmd.Flags().GetBool("ai")
			mode, _ := cmd.Flags().GetString("mode")
			fromPeer, _ := cmd.Flags().GetString("from-peer")

			invDir, err := EnsureInvDir()
			if err != nil {
				return err
			}

			keyPath := filepath.Join(invDir, "identity.key")
			peerIDPath := filepath.Join(invDir, "peer_id")
			cfgPath := filepath.Join(invDir, "config.yaml")

			fmt.Fprintln(os.Stderr, "\ninv — Inventory Network")
			fmt.Fprintln(os.Stderr, "═══════════════════════════════════════════════════")

			fmt.Fprintln(os.Stderr, "\nGenerating Ed25519 keypair...")
			ident, err := LoadOrCreateIdentity(keyPath, peerIDPath)
			if err != nil {
				return fmt.Errorf("identity: %w", err)
			}
			fmt.Fprintf(os.Stderr, "  Peer ID: %s\n", ident.PeerID)
			fmt.Fprintf(os.Stderr, "  Key saved: %s (chmod 600)\n", keyPath)

			cfg := DefaultNodeConfig()
			cfg.Node.Name = name
			cfg.Node.Vertical = Vertical(vertical)
			cfg.Node.Project = project
			cfg.Node.Owner = owner
			cfg.Node.IsAI = isAI
			cfg.Node.PermissionMode = PermissionMode(mode)

			// AI nodes default to autonomous mode
			if isAI && mode == string(PermissionNormal) {
				cfg.Node.PermissionMode = PermissionAutonomous
				cfg.Challenges.AutoChallenge = true
				cfg.Challenges.StaleThreshold = 24 * time.Hour
			}

			if fromPeer != "" {
				cfg.Network.BootstrapPeers = []string{fromPeer}
				fmt.Fprintf(os.Stderr, "\nJoining network via: %s\n", fromPeer)
				fmt.Fprintln(os.Stderr, "  Status: pending (awaiting approval from existing peers)")
			}

			if err := WriteNodeConfig(cfgPath, cfg); err != nil {
				return fmt.Errorf("write config: %w", err)
			}
			fmt.Fprintf(os.Stderr, "\nConfig written: %s\n", cfgPath)

			// Ensure database exists
			dbPath := cfg.Database.Path
			s, err := NewStore(dbPath)
			if err != nil {
				return fmt.Errorf("create database: %w", err)
			}
			s.Close()
			fmt.Fprintf(os.Stderr, "Database created: %s\n", dbPath)

			fmt.Fprintln(os.Stderr, "\n═══════════════════════════════════════════════════")
			fmt.Fprintf(os.Stderr, "  Node:      %s\n", name)
			fmt.Fprintf(os.Stderr, "  Vertical:  %s\n", vertical)
			fmt.Fprintf(os.Stderr, "  Project:   %s\n", project)
			fmt.Fprintf(os.Stderr, "  Owner:     %s\n", owner)
			if isAI {
				fmt.Fprintln(os.Stderr, "  AI:        yes (votes are advisory-only)")
			} else {
				fmt.Fprintln(os.Stderr, "  AI:        no")
			}
			fmt.Fprintf(os.Stderr, "  Mode:      %s\n", cfg.Node.PermissionMode)
			fmt.Fprintln(os.Stderr, "═══════════════════════════════════════════════════")

			fmt.Fprintln(os.Stderr, "\nDone! Your node is ready.")
			fmt.Fprintln(os.Stderr, "\nNext steps:")
			fmt.Fprintln(os.Stderr, "  inv serve                          # Start P2P node")
			fmt.Fprintln(os.Stderr, "  inv network peers                  # See who's online")

			return nil
		},
	}
	cmd.Flags().String("name", "", "Node name (e.g., dev-inventory)")
	cmd.Flags().String("vertical", "dev", "Team role: pm, design, dev, qa, devops")
	cmd.Flags().String("project", "", "Project name — nodes with same project form a network")
	cmd.Flags().String("owner", "", "Person or AI agent name responsible for this node")
	cmd.Flags().Bool("ai", false, "AI agent node (votes advisory-only, doesn't count toward quorum)")
	cmd.Flags().String("mode", "normal", "Permission mode: normal (AI suggests, human confirms) or autonomous (AI acts freely)")
	cmd.Flags().String("from-peer", "", "Multiaddr of existing peer to join network")
	cmd.MarkFlagRequired("name")
	cmd.MarkFlagRequired("project")
	cmd.MarkFlagRequired("owner")
	return cmd
}

func serveCmd(scope *pumped.Scope) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "serve",
		Short: "Start P2P node (long-running daemon with P2P host + MCP server)",
		RunE: func(cmd *cobra.Command, args []string) error {
			port, _ := cmd.Flags().GetInt("port")
			project, _ := cmd.Flags().GetString("project")
			mode, _ := cmd.Flags().GetString("mode")
			autoChallenge, _ := cmd.Flags().GetBool("auto-challenge")

			invDir := InvDirPath()
			cfgPath := filepath.Join(invDir, "config.yaml")
			keyPath := filepath.Join(invDir, "identity.key")
			peerIDPath := filepath.Join(invDir, "peer_id")

			// Load config
			cfg, err := LoadNodeConfig(cfgPath)
			if err != nil {
				cfg = DefaultNodeConfig()
			}
			// Apply CLI overrides
			if port != 0 {
				cfg.Network.ListenPort = port
			}
			if project != "" {
				cfg.Node.Project = project
			}
			if mode != "" {
				cfg.Node.PermissionMode = PermissionMode(mode)
			}
			if autoChallenge {
				cfg.Challenges.AutoChallenge = true
			}

			// Load identity
			ident, err := LoadOrCreateIdentity(keyPath, peerIDPath)
			if err != nil {
				return fmt.Errorf("identity: %w", err)
			}

			// Resolve store from DI
			store, err := pumped.Resolve(scope, DBStore)
			if err != nil {
				return fmt.Errorf("resolve store: %w", err)
			}

			// Prune old events on startup
			pruned, pruneErr := store.PruneOldEvents(context.Background(), 7)
			if pruneErr != nil {
				fmt.Fprintf(os.Stderr, "warning: failed to prune old events: %v\n", pruneErr)
			} else if pruned > 0 {
				fmt.Fprintf(os.Stderr, "pruned %d events older than 7 days\n", pruned)
			}

			// Start P2P host
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()

			host, err := NewP2PHost(ctx, ident, cfg, store)
			if err != nil {
				return fmt.Errorf("start P2P host: %w", err)
			}
			defer host.Close()

			// Set up sender + drain outbox
			sender := NewP2PSender(host, store)
			sent, _ := sender.DrainAllOutbox(ctx)

			// Print startup banner
			printStartupBanner(cfg, ident, host, sent)

			// Block until signal
			sigCh := make(chan os.Signal, 1)
			signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
			<-sigCh

			fmt.Fprintf(os.Stderr, "\nShutting down...\n")
			return nil
		},
	}
	cmd.Flags().Int("port", 0, "Listen port (overrides config)")
	cmd.Flags().String("project", "", "Project name (overrides config)")
	cmd.Flags().String("mode", "", "Permission mode: normal or autonomous (overrides config)")
	cmd.Flags().Bool("auto-challenge", false, "Enable automatic challenges (overrides config)")
	return cmd
}

func printStartupBanner(cfg *NodeConfig, ident *NodeIdentity, host *P2PHost, outboxDrained int) {
	fmt.Fprintf(os.Stderr, "\ninv — Inventory Network\n")
	fmt.Fprintf(os.Stderr, "═══════════════════════════════════════════════════\n\n")

	fmt.Fprintf(os.Stderr, "  Node:      %s\n", cfg.Node.Name)
	fmt.Fprintf(os.Stderr, "  Vertical:  %s\n", cfg.Node.Vertical)
	fmt.Fprintf(os.Stderr, "  Project:   %s\n", cfg.Node.Project)
	fmt.Fprintf(os.Stderr, "  Owner:     %s\n", cfg.Node.Owner)
	if cfg.Node.IsAI {
		fmt.Fprintf(os.Stderr, "  AI:        yes (votes are advisory-only)\n")
	} else {
		fmt.Fprintf(os.Stderr, "  AI:        no\n")
	}
	fmt.Fprintf(os.Stderr, "  Mode:      %s\n", cfg.Node.PermissionMode)

	fmt.Fprintf(os.Stderr, "\n  Peer ID:   %s\n", ident.PeerID)
	fmt.Fprintf(os.Stderr, "  Listening: /ip4/0.0.0.0/tcp/%d\n", cfg.Network.ListenPort)

	addrs := host.ShareableAddrs()
	if len(addrs) > 0 {
		fmt.Fprintf(os.Stderr, "\n  Share this address with your team:\n")
		for _, addr := range addrs {
			fmt.Fprintf(os.Stderr, "    %s\n", addr)
		}
		fmt.Fprintf(os.Stderr, "\n  Join command:\n")
		fmt.Fprintf(os.Stderr, "    inv init --from-peer %s\n", addrs[0])
	}

	fmt.Fprintf(os.Stderr, "\n═══════════════════════════════════════════════════\n")

	mdnsStatus := "disabled"
	if cfg.Network.EnableMDNS {
		mdnsStatus = "enabled"
	}
	dhtStatus := "disabled"
	if cfg.Network.EnableDHT {
		dhtStatus = "enabled"
	}
	fmt.Fprintf(os.Stderr, "  MCP server: stdio (ready for Claude Code)\n")
	fmt.Fprintf(os.Stderr, "  mDNS:       %s (LAN auto-discovery)\n", mdnsStatus)
	fmt.Fprintf(os.Stderr, "  DHT:        %s (internet-wide discovery)\n", dhtStatus)

	peerCount := host.ConnectedPeerCount()
	fmt.Fprintf(os.Stderr, "\n  Peers:      %d connected\n", peerCount)
	if outboxDrained > 0 {
		fmt.Fprintf(os.Stderr, "  Outbox:     %d messages delivered on startup\n", outboxDrained)
	} else {
		fmt.Fprintf(os.Stderr, "  Outbox:     0 messages queued\n")
	}

	if cfg.Challenges.AutoChallenge {
		fmt.Fprintf(os.Stderr, "  Auto-challenge: enabled (stale threshold: %s)\n", cfg.Challenges.StaleThreshold)
	}

	fmt.Fprintf(os.Stderr, "\nWaiting for connections...\n")
}

func networkCmd(e *Engine, store *Store) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "network",
		Short: "Network status, peers, health, and reputation",
	}

	statusCmd := &cobra.Command{
		Use:   "status",
		Short: "Show node status, connected peers, outbox, governance, reputation",
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := context.Background()
			project, _ := cmd.Flags().GetString("project")

			peers, err := store.ListPeers(ctx, project)
			if err != nil {
				return err
			}

			outboxDepth, err := store.OutboxDepth(ctx)
			if err != nil {
				return err
			}

			activeProposals, _ := store.ListAllActiveProposals(ctx)
			activeChallenges, _ := store.ListChallenges(ctx, ChallengeOpen)

			fmt.Fprintf(os.Stderr, "Project:     %s\n", project)
			fmt.Fprintf(os.Stderr, "Peers:       %d\n", len(peers))
			for _, p := range peers {
				status := string(p.Status)
				rep, _ := store.GetPeerReputation(ctx, p.PeerID)
				peerIDShort := p.PeerID
				if len(peerIDShort) > 12 {
					peerIDShort = peerIDShort[:12] + "..."
				}
				fmt.Fprintf(os.Stderr, "  %s (%s) %s rep:%+d\n", p.Name, peerIDShort, status, rep)
			}
			fmt.Fprintf(os.Stderr, "Outbox:      %d messages queued\n", outboxDepth)
			fmt.Fprintf(os.Stderr, "Proposals:   %d active\n", len(activeProposals))
			fmt.Fprintf(os.Stderr, "Challenges:  %d open\n", len(activeChallenges))

			return nil
		},
	}
	statusCmd.Flags().String("project", "", "Project name")
	statusCmd.MarkFlagRequired("project")

	peersCmd := &cobra.Command{
		Use:   "peers",
		Short: "List discovered peers with reputation scores",
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := context.Background()
			project, _ := cmd.Flags().GetString("project")

			peers, err := store.ListPeers(ctx, project)
			if err != nil {
				return err
			}

			if len(peers) == 0 {
				fmt.Fprintln(os.Stderr, "No peers discovered.")
				return nil
			}

			w := tabwriter.NewWriter(os.Stderr, 0, 0, 2, ' ', 0)
			fmt.Fprintln(w, "PEER ID\tNAME\tVERTICAL\tSTATUS\tREPUTATION\tOWNER")
			for _, p := range peers {
				rep, _ := store.GetPeerReputation(ctx, p.PeerID)
				peerIDShort := p.PeerID
				if len(peerIDShort) > 16 {
					peerIDShort = peerIDShort[:16] + "..."
				}
				fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%+d\t%s\n", peerIDShort, p.Name, p.Vertical, p.Status, rep, p.Owner)
			}
			w.Flush()
			return nil
		},
	}
	peersCmd.Flags().String("project", "", "Project name")
	peersCmd.MarkFlagRequired("project")

	connectCmd := &cobra.Command{
		Use:   "connect [multiaddr]",
		Short: "Manually connect to a peer",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Fprintf(os.Stderr, "Connection to %s must be done while `inv serve` is running.\n", args[0])
			fmt.Fprintln(os.Stderr, "Add the address to bootstrap_peers in config.yaml or use inv init --from-peer.")
			return nil
		},
	}

	healthCmd := &cobra.Command{
		Use:   "health",
		Short: "Machine-readable health status (JSON)",
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := context.Background()
			project, _ := cmd.Flags().GetString("project")

			peers, _ := store.ListPeers(ctx, project)
			outboxDepth, _ := store.OutboxDepth(ctx)
			activeProposals, _ := store.ListAllActiveProposals(ctx)
			activeChallenges, _ := store.ListChallenges(ctx, ChallengeOpen)

			approvedCount := 0
			pendingCount := 0
			for _, p := range peers {
				if p.Status == PeerStatusApproved {
					approvedCount++
				} else if p.Status == PeerStatusPending {
					pendingCount++
				}
			}

			type HealthStatus struct {
				ConnectedPeers   int `json:"connected_peers"`
				PendingPeers     int `json:"pending_peers"`
				OutboxDepth      int `json:"outbox_depth"`
				ActiveProposals  int `json:"active_proposals"`
				ActiveChallenges int `json:"active_challenges"`
			}
			health := HealthStatus{
				ConnectedPeers:   approvedCount,
				PendingPeers:     pendingCount,
				OutboxDepth:      outboxDepth,
				ActiveProposals:  len(activeProposals),
				ActiveChallenges: len(activeChallenges),
			}
			data, _ := json.Marshal(health)
			fmt.Println(string(data))
			return nil
		},
	}
	healthCmd.Flags().String("project", "", "Project name")
	healthCmd.MarkFlagRequired("project")

	reputationCmd := &cobra.Command{
		Use:   "reputation",
		Short: "Show peer reputation scores",
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := context.Background()
			peerID, _ := cmd.Flags().GetString("peer")

			if peerID != "" {
				score, err := store.GetPeerReputation(ctx, peerID)
				if err != nil {
					return err
				}
				fmt.Fprintf(os.Stderr, "Peer %s: reputation %+d\n", peerID, score)
				return nil
			}

			project, _ := cmd.Flags().GetString("project")
			peers, err := store.ListPeers(ctx, project)
			if err != nil {
				return err
			}

			for _, p := range peers {
				score, _ := store.GetPeerReputation(ctx, p.PeerID)
				peerIDShort := p.PeerID
				if len(peerIDShort) > 12 {
					peerIDShort = peerIDShort[:12] + "..."
				}
				fmt.Fprintf(os.Stderr, "  %s (%s): %+d\n", p.Name, peerIDShort, score)
			}
			return nil
		},
	}
	reputationCmd.Flags().String("peer", "", "Specific peer ID")
	reputationCmd.Flags().String("project", "", "Project name")

	cmd.AddCommand(statusCmd, peersCmd, connectCmd, healthCmd, reputationCmd)
	return cmd
}

func proposalCmd(store *Store, proposalEngine *ProposalEngine) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "proposal",
		Short: "Manage governance proposals (create, vote, status)",
	}

	createCmd := &cobra.Command{
		Use:   "create",
		Short: "Create a new proposal for cross-node governance",
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := context.Background()
			kind, _ := cmd.Flags().GetString("kind")
			title, _ := cmd.Flags().GetString("title")
			desc, _ := cmd.Flags().GetString("description")
			proposer, _ := cmd.Flags().GetString("proposer")
			owner, _ := cmd.Flags().GetString("owner")
			affected, _ := cmd.Flags().GetString("affected")
			hours, _ := cmd.Flags().GetInt("deadline-hours")

			var items []string
			if affected != "" {
				items = strings.Split(affected, ",")
			}

			prop := &Proposal{
				Kind:          ProposalKind(kind),
				Title:         title,
				Description:   desc,
				ProposerPeer:  proposer,
				ProposerName:  proposer,
				OwnerPeer:     owner,
				AffectedItems: items,
				Deadline:      time.Now().Add(time.Duration(hours) * time.Hour),
			}

			if err := store.CreateProposal(ctx, prop); err != nil {
				return err
			}
			fmt.Fprintf(os.Stderr, "Proposal created: %s [%s] %s\n", prop.ID[:8], prop.Kind, prop.Title)
			return nil
		},
	}
	createCmd.Flags().String("kind", "change_request", "Proposal kind (change_request, trace_dispute, sweep_acceptance, network_membership, challenge)")
	createCmd.Flags().String("title", "", "Proposal title")
	createCmd.Flags().String("description", "", "Description")
	createCmd.Flags().String("proposer", "", "Proposer peer ID")
	createCmd.Flags().String("owner", "", "Owner peer ID (for veto)")
	createCmd.Flags().String("affected", "", "Comma-separated affected item IDs")
	createCmd.Flags().Int("deadline-hours", 24, "Deadline in hours")
	createCmd.MarkFlagRequired("title")
	createCmd.MarkFlagRequired("proposer")

	voteCmd := &cobra.Command{
		Use:   "vote [proposal-id]",
		Short: "Vote on an active proposal",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := context.Background()
			voter, _ := cmd.Flags().GetString("voter")
			voterID, _ := cmd.Flags().GetString("voter-id")
			decision, _ := cmd.Flags().GetString("decision")
			reason, _ := cmd.Flags().GetString("reason")
			isAI, _ := cmd.Flags().GetBool("ai")

			vote := &ProposalVoteRecord{
				ProposalID: args[0],
				VoterPeer:  voter,
				VoterID:    voterID,
				Decision:   decision,
				Reason:     reason,
				IsAI:       isAI,
			}
			if err := store.CreateProposalVote(ctx, vote); err != nil {
				return err
			}
			fmt.Fprintf(os.Stderr, "Vote recorded: %s from %s\n", decision, voter)
			return nil
		},
	}
	voteCmd.Flags().String("voter", "", "Voter peer ID")
	voteCmd.Flags().String("voter-id", "", "Voter ID")
	voteCmd.Flags().String("decision", "", "Vote: approve or reject")
	voteCmd.Flags().String("reason", "", "Reason")
	voteCmd.Flags().Bool("ai", false, "Is this an AI vote")
	voteCmd.MarkFlagRequired("voter")
	voteCmd.MarkFlagRequired("decision")

	statusCmd := &cobra.Command{
		Use:   "status [proposal-id]",
		Short: "Show proposal status and tally",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := context.Background()
			project, _ := cmd.Flags().GetString("project")

			prop, err := store.GetProposal(ctx, args[0])
			if err != nil {
				return err
			}

			result, err := proposalEngine.TallyProposal(ctx, args[0], project)
			if err != nil {
				return err
			}

			fmt.Fprintf(os.Stderr, "Proposal: %s\n", prop.Title)
			fmt.Fprintf(os.Stderr, "Kind:     %s\n", prop.Kind)
			fmt.Fprintf(os.Stderr, "Status:   %s\n", prop.Status)
			fmt.Fprintf(os.Stderr, "Deadline: %s\n", prop.Deadline.Format(time.RFC3339))
			fmt.Fprintf(os.Stderr, "\nTally:\n")
			fmt.Fprintf(os.Stderr, "  Eligible voters: %d\n", result.TotalEligible)
			fmt.Fprintf(os.Stderr, "  Human votes:     %d (approve: %d, reject: %d)\n", result.HumanVotes, result.Approve, result.Reject)
			fmt.Fprintf(os.Stderr, "  AI votes:        %d (advisory only)\n", result.AIVotes)
			fmt.Fprintf(os.Stderr, "  Quorum reached:  %v\n", result.QuorumReached)
			fmt.Fprintf(os.Stderr, "  Decision:        %s\n", result.Decision)
			if result.OwnerVetoed {
				fmt.Fprintln(os.Stderr, "  Owner vetoed:    yes")
			}
			return nil
		},
	}
	statusCmd.Flags().String("project", "", "Project name")
	statusCmd.MarkFlagRequired("project")

	listCmd := &cobra.Command{
		Use:   "list",
		Short: "List active proposals",
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := context.Background()
			proposals, err := store.ListAllActiveProposals(ctx)
			if err != nil {
				return err
			}

			if len(proposals) == 0 {
				fmt.Fprintln(os.Stderr, "No active proposals.")
				return nil
			}

			for _, p := range proposals {
				remaining := time.Until(p.Deadline).Truncate(time.Minute)
				fmt.Fprintf(os.Stderr, "  [%s] %s — %s (%s remaining)\n", p.ID[:8], p.Kind, p.Title, remaining)
			}
			return nil
		},
	}

	cmd.AddCommand(createCmd, voteCmd, statusCmd, listCmd)
	return cmd
}

func challengeCmd(store *Store, challengeEng *ChallengeEngine) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "challenge",
		Short: "Manage node-to-node challenges (item, trace, respond, vote, list)",
	}

	itemChallengeCmd := &cobra.Command{
		Use:   "item [item-id]",
		Short: "Challenge a node's item (stale data or weak evidence)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := context.Background()
			peerID, _ := cmd.Flags().GetString("peer")
			kind, _ := cmd.Flags().GetString("kind")
			reason, _ := cmd.Flags().GetString("reason")
			evidence, _ := cmd.Flags().GetString("evidence")
			selfPeer, _ := cmd.Flags().GetString("self")

			ch, err := challengeEng.CreateChallenge(ctx, ChallengeKind(kind), selfPeer, peerID, args[0], "", reason, evidence, 24*time.Hour)
			if err != nil {
				return err
			}
			fmt.Fprintf(os.Stderr, "Challenge created: %s [%s] against %s\n", ch.ID[:8], ch.Kind, peerID)
			return nil
		},
	}
	itemChallengeCmd.Flags().String("peer", "", "Target peer ID")
	itemChallengeCmd.Flags().String("kind", "stale_data", "Challenge kind (stale_data, weak_evidence)")
	itemChallengeCmd.Flags().String("reason", "", "Reason for challenge")
	itemChallengeCmd.Flags().String("evidence", "", "Supporting evidence")
	itemChallengeCmd.Flags().String("self", "", "Your peer ID")
	itemChallengeCmd.MarkFlagRequired("peer")
	itemChallengeCmd.MarkFlagRequired("reason")
	itemChallengeCmd.MarkFlagRequired("self")

	traceChallengeCmd := &cobra.Command{
		Use:   "trace [trace-id]",
		Short: "Challenge a trace relationship",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := context.Background()
			peerID, _ := cmd.Flags().GetString("peer")
			reason, _ := cmd.Flags().GetString("reason")
			selfPeer, _ := cmd.Flags().GetString("self")

			ch, err := challengeEng.CreateChallenge(ctx, ChallengeTraceIntegrity, selfPeer, peerID, "", args[0], reason, "", 24*time.Hour)
			if err != nil {
				return err
			}
			fmt.Fprintf(os.Stderr, "Challenge created: %s [trace_integrity] against %s\n", ch.ID[:8], peerID)
			return nil
		},
	}
	traceChallengeCmd.Flags().String("peer", "", "Target peer ID")
	traceChallengeCmd.Flags().String("reason", "", "Reason")
	traceChallengeCmd.Flags().String("self", "", "Your peer ID")
	traceChallengeCmd.MarkFlagRequired("peer")
	traceChallengeCmd.MarkFlagRequired("reason")
	traceChallengeCmd.MarkFlagRequired("self")

	respondCmd := &cobra.Command{
		Use:   "respond [challenge-id]",
		Short: "Respond to a challenge against your node",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := context.Background()
			evidence, _ := cmd.Flags().GetString("evidence")

			if err := challengeEng.RespondToChallenge(ctx, args[0], evidence); err != nil {
				return err
			}
			fmt.Fprintf(os.Stderr, "Response submitted for challenge %s\n", args[0][:8])
			return nil
		},
	}
	respondCmd.Flags().String("evidence", "", "Evidence for your response")
	respondCmd.MarkFlagRequired("evidence")

	voteInfoCmd := &cobra.Command{
		Use:   "vote [challenge-id]",
		Short: "Vote on an active challenge",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Fprintf(os.Stderr, "Challenge voting for %s uses the proposal system.\n", args[0][:8])
			fmt.Fprintln(os.Stderr, "Use: inv proposal vote <proposal-id> --decision <sustain|dismiss>")
			return nil
		},
	}

	listCmd := &cobra.Command{
		Use:   "list",
		Short: "List challenges",
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := context.Background()
			incoming, _ := cmd.Flags().GetBool("incoming")
			outgoing, _ := cmd.Flags().GetBool("outgoing")
			selfPeer, _ := cmd.Flags().GetString("self")

			if incoming && selfPeer != "" {
				challenges, err := store.ListChallengesByPeer(ctx, selfPeer, true)
				if err != nil {
					return err
				}
				fmt.Fprintf(os.Stderr, "Incoming challenges (%d):\n", len(challenges))
				for _, ch := range challenges {
					fmt.Fprintf(os.Stderr, "  [%s] %s from %s — %s (%s)\n", ch.ID[:8], ch.Kind, ch.ChallengerPeer, ch.Reason, ch.Status)
				}
				return nil
			}

			if outgoing && selfPeer != "" {
				challenges, err := store.ListChallengesByPeer(ctx, selfPeer, false)
				if err != nil {
					return err
				}
				fmt.Fprintf(os.Stderr, "Outgoing challenges (%d):\n", len(challenges))
				for _, ch := range challenges {
					fmt.Fprintf(os.Stderr, "  [%s] %s against %s — %s (%s)\n", ch.ID[:8], ch.Kind, ch.ChallengedPeer, ch.Reason, ch.Status)
				}
				return nil
			}

			// Default: show all open
			challenges, err := store.ListChallenges(ctx, ChallengeOpen)
			if err != nil {
				return err
			}
			fmt.Fprintf(os.Stderr, "Open challenges (%d):\n", len(challenges))
			for _, ch := range challenges {
				remaining := time.Until(ch.Deadline).Truncate(time.Minute)
				fmt.Fprintf(os.Stderr, "  [%s] %s: %s vs %s — %s (%s remaining)\n",
					ch.ID[:8], ch.Kind, ch.ChallengerPeer, ch.ChallengedPeer, ch.Reason, remaining)
			}
			return nil
		},
	}
	listCmd.Flags().Bool("incoming", false, "Show challenges against your node")
	listCmd.Flags().Bool("outgoing", false, "Show challenges you filed")
	listCmd.Flags().String("self", "", "Your peer ID")

	cmd.AddCommand(itemChallengeCmd, traceChallengeCmd, respondCmd, voteInfoCmd, listCmd)
	return cmd
}

func pairCmd(engine *Engine, store *Store, agentLog, sysLog *zerolog.Logger) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "pair",
		Short: "Manage pairing sessions between nodes",
	}

	inviteCmd := &cobra.Command{
		Use:   "invite",
		Short: "Invite a guest to a pairing session",
		RunE: func(cmd *cobra.Command, args []string) error {
			hostPeer, _ := cmd.Flags().GetString("host-peer")
			hostNode, _ := cmd.Flags().GetString("host-node")
			guestPeer, _ := cmd.Flags().GetString("guest-peer")
			guestNode, _ := cmd.Flags().GetString("guest-node")

			sess, err := engine.InvitePair(context.Background(), hostPeer, hostNode, guestPeer, guestNode)
			if err != nil {
				sysLog.Error().Err(err).Str("host_peer", hostPeer).Str("guest_peer", guestPeer).Msg("failed to invite pair")
				return err
			}
			data, _ := json.Marshal(sess)
			agentLog.Info().RawJSON("data", data).Str("command", "pair.invite").Msg("pairing session created")
			fmt.Fprintf(os.Stderr, "Pairing session created: %s\n", sess.ID)
			return nil
		},
	}
	inviteCmd.Flags().String("host-peer", "", "Host peer ID")
	inviteCmd.Flags().String("host-node", "", "Host node ID")
	inviteCmd.Flags().String("guest-peer", "", "Guest peer ID")
	inviteCmd.Flags().String("guest-node", "", "Guest node ID")
	inviteCmd.MarkFlagRequired("host-peer")
	inviteCmd.MarkFlagRequired("host-node")
	inviteCmd.MarkFlagRequired("guest-peer")
	inviteCmd.MarkFlagRequired("guest-node")

	joinCmd := &cobra.Command{
		Use:   "join [session-id]",
		Short: "Accept a pairing session invitation",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			guestPeer, _ := cmd.Flags().GetString("guest-peer")

			sess, err := engine.AcceptPair(context.Background(), args[0], guestPeer)
			if err != nil {
				sysLog.Error().Err(err).Str("session", args[0]).Str("guest_peer", guestPeer).Msg("failed to join pair")
				return err
			}
			data, _ := json.Marshal(sess)
			agentLog.Info().RawJSON("data", data).Str("command", "pair.join").Msg("pairing session joined")
			fmt.Fprintf(os.Stderr, "Joined pairing session: %s\n", sess.ID)
			return nil
		},
	}
	joinCmd.Flags().String("guest-peer", "", "Guest peer ID")
	joinCmd.MarkFlagRequired("guest-peer")

	endCmd := &cobra.Command{
		Use:   "end [session-id]",
		Short: "End an active pairing session",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			peerID, _ := cmd.Flags().GetString("peer")

			sess, err := engine.EndPair(context.Background(), args[0], peerID)
			if err != nil {
				sysLog.Error().Err(err).Str("session", args[0]).Str("peer", peerID).Msg("failed to end pair")
				return err
			}
			data, _ := json.Marshal(sess)
			agentLog.Info().RawJSON("data", data).Str("command", "pair.end").Msg("pairing session ended")
			fmt.Fprintf(os.Stderr, "Ended pairing session: %s\n", sess.ID)
			return nil
		},
	}
	endCmd.Flags().String("peer", "", "Your peer ID")
	endCmd.MarkFlagRequired("peer")

	listCmd := &cobra.Command{
		Use:   "list",
		Short: "List active pairing sessions",
		RunE: func(cmd *cobra.Command, args []string) error {
			peerID, _ := cmd.Flags().GetString("peer")

			sessions, err := engine.ListPairingSessions(context.Background(), peerID)
			if err != nil {
				sysLog.Error().Err(err).Str("peer", peerID).Msg("failed to list pairing sessions")
				return err
			}
			data, _ := json.Marshal(sessions)
			agentLog.Info().RawJSON("data", data).Str("command", "pair.list").Msg("pairing sessions listed")

			if len(sessions) == 0 {
				fmt.Fprintln(os.Stderr, "No active pairing sessions.")
				return nil
			}

			w := tabwriter.NewWriter(os.Stderr, 0, 0, 2, ' ', 0)
			fmt.Fprintln(w, "SESSION\tHOST\tGUEST\tSTARTED")
			for _, s := range sessions {
				sessionShort := s.ID
				if len(sessionShort) > 16 {
					sessionShort = sessionShort[:16] + "..."
				}
				fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", sessionShort, s.HostPeerID, s.GuestPeerID, s.StartedAt.Format(time.RFC3339))
			}
			w.Flush()
			return nil
		},
	}
	listCmd.Flags().String("peer", "", "Your peer ID")
	listCmd.MarkFlagRequired("peer")

	cmd.AddCommand(inviteCmd, joinCmd, endCmd, listCmd)
	return cmd
}
