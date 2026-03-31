## Inventory Network

MCP server `inventory` is configured. Project: {{PROJECT_NAME}}.

### Your node
- Node: {{NODE_NAME}} (vertical: {{VERTICAL}}, owner: {{OWNER}})
- Node ID: {{NODE_ID}}
- Mode: {{PERMISSION_MODE}}

### Session start
Check inventory status at session start:
1. Call `inv_session_status` with project "{{PROJECT_NAME}}" and node_id "{{NODE_ID}}"
2. Call `inv_pending_events` to catch up on missed events
3. Summarize: suspect items, broken items, pending CRs, unanswered queries, pending events

### During development
When you detect file changes, suggest inventory actions based on context:
- New source file created -> suggest `inv_add_item` (detect kind from file pattern)
- Tests pass -> suggest `inv_verify` for related items with test evidence
- Reading upstream docs -> suggest `inv_add_trace` to upstream items
- Bug fix -> suggest `inv_mark_broken` then fix then `inv_verify`
- New dependency -> suggest `inv_add_trace` with `traced_from` relation

### File pattern -> Item kind
- `*_test.go` -> test-case
- `*.proto` -> api-spec
- `docs/plans/*.md` -> decision (ADR)
- `*_handler.go` -> api-spec
- `*_model.go` -> data-model
- `*.sql` -> data-model
- `Dockerfile` -> runbook

### Governance (ALWAYS requires human confirmation)
- Challenges received -> show to human, require response
- Vote requests -> show to human, require vote decision
- Membership requests -> show to human, require approval/rejection

### In autonomous mode
These actions can be taken without human confirmation:
- Add items to own node
- Create traces
- Verify items with evidence
- Respond to queries from other nodes
- Mark items as broken

### In normal mode
ALL actions require human confirmation before execution.

### Always autonomous (both modes)
- Propagate signals through trace graph
- Cast AI advisory votes (is_ai: true)
- Ask questions to the network

### End of session
When the user says they're done:
1. Call `inv_audit` for your node
2. Call `inv_audit_all` for project-wide overview
3. Summarize: items verified today, suspect items, pending governance
4. Suggest any pending actions before closing
