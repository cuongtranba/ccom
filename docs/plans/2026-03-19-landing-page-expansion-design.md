# Landing Page Expansion — Design Document

**Date:** 2026-03-19
**Status:** Approved

## Overview

Expand the landing page from 6 sections to 8, adding 3 new animated demo sections and replacing the architecture card grid (anti-pattern). New sections cover P2P networking, governance lifecycle, Claude Code integration, and cross-inventory pipeline.

## Page Structure

| # | Label | Section | Status | Component |
|---|-------|---------|--------|-----------|
| 01 | Hero | Hero | Keep | (existing) |
| 02 | The Lifecycle | State Machine | Keep | StateMachine.astro |
| 03 | Neural Propagation | Single-node propagation | Keep | PropagationDemo.astro |
| 04 | P2P Network | Cross-Team Cascade | **NEW** | CrossTeamCascade.astro |
| 05 | Governance | CR Lifecycle | **REPLACE** voting card | GovernanceLifecycle.astro |
| 06 | AI as First-Class Citizen | Claude Code Integration | **NEW** | ClaudeCodeDemo.astro |
| 07 | The Pipeline | Cross-Inventory Pipeline | **NEW** (replaces ArchGrid) | PipelineDemo.astro |
| 08 | Start | CTA | Keep | (existing) |

## Section 04: Cross-Team Cascade

**Files:** `web/src/components/CrossTeamCascade.astro`, `web/src/scripts/cross-team-cascade.ts`

### Visual

Canvas-based (900×500). Five team islands arranged in an arc:
- PM at top-center
- Design mid-left, Dev mid-right
- QA bottom-left, DevOps bottom-right

Each island is a cluster of 2-3 nodes grouped under a vertical label. Islands connected by P2P trace lines (sand-colored, faint).

### Demo Flow (buttons + auto-play on scroll)

1. **"connect"** — Islands appear one by one with mDNS discovery pulse (expanding ring animation). Connection lines draw in with sand particle streams. Terminal: `inv network join --discovery mdns`
2. **"change"** — PM updates. Sand streams cascade: PM→Design + PM→Dev simultaneously, then Design→Dev, Dev→QA, Dev→DevOps. Each island flashes burnt sienna (suspect). Terminal shows sweep across 5 teams.
3. **"resolve"** — Teams re-verify in sequence. Islands flash spice gold (proven). Terminal shows reconciliation.
4. **"reset"** — Return to initial state.

### Layout

Grid: canvas left, terminal panel right (same as PropagationDemo). Stacks on mobile.

### Section Header

- Label: `04 — P2P Network`
- Title: `One team changes. Five teams know.`
- Description: `Each vertical runs its own inventory node. The P2P network connects them — discovery is automatic, propagation is instant, and no central server decides what's true.`

---

## Section 05: Governance Lifecycle

**Files:** `web/src/components/GovernanceLifecycle.astro`, `web/src/scripts/governance-lifecycle.ts`

### Visual

DOM-based card that transforms through 5 stages with CSS transitions. Sand particle animations overlay for vote arrivals.

### The CR

Same as current: "CR-042: Change check-in API from sync to async"

### Stage Flow

1. **Draft** — Card with "DRAFT" badge (desert stone muted). Proposer (Dev Node) + description. Terminal: `inv cr create --title "Change check-in API..." --scope dev,pm,design,qa`
2. **Voting Opens** — Badge animates to "VOTING" (spice gold). Affected nodes listed with empty vote slots. Quorum bar: "0/3 human votes (need >50%)". Terminal: `inv cr open CR-042`
3. **Votes Arrive** — Votes slide in one at a time (600ms delay). Each vote has a sand particle trail from left edge. AI votes get "AI" tag + "(advisory — does not count toward quorum)". Quorum bar fills with human votes. Terminal: `inv cr vote CR-042 --node pm --decision approve`
4. **Approved** — Badge animates to "APPROVED" (bright spice gold, glow). Quorum bar pulse. Card border glows gold 1s. Terminal: `CR-042 approved: 3/3 human votes, 2 AI advisory votes`
5. **Archived** — Badge fades to "ARCHIVED" (muted). Card dims. Terminal: `inv cr archive CR-042`

### Buttons

`draft` / `open voting` / `cast votes` / `approve` / `archive` / `reset`

### Section Header

- Label: `05 — Governance`
- Title: `No change lands without consensus.`
- Description: `Cross-inventory changes go through a formal lifecycle. Affected nodes vote. AI participates with reasons — but only humans decide quorum.`

---

## Section 06: Claude Code Integration

**Files:** `web/src/components/ClaudeCodeDemo.astro`, `web/src/scripts/claude-code-demo.ts`

### Visual

Two terminal panels side by side. Left: "HUMAN — CLI" with user icon. Right: "AI AGENT — MCP" with AI tag. Pure DOM terminals with animated text line by line.

### Layout

Grid 1fr 1fr, stacks on mobile. No canvas.

### Demo Flow

1. **"session start"** — Both terminals initialize. Human: `inv item list`. AI: `inv_session_status`. Same inventory state, different interface.
2. **"human edits"** — Human: `modified: api/checkin.go`. AI (200ms later): `[event] file changed: api/checkin.go → kind: api-spec`, then `suggest: verify API-001 with evidence "checkin.go updated"`.
3. **"AI acts"** — AI: `[mode: autonomous] auto-verifying own node items...` → `inv verify API-001 --evidence "checkin.go: async handler added"`. Human: `[network] Dev node verified API-001`.
4. **"cross-node"** — AI: `[event] challenge from QA: "API-001 tests not updated"` → `[mode: normal] ⚠ requires human confirmation`. Human: `Respond to challenge? (y/n)`.

### Buttons

`session start` / `human edits` / `AI acts` / `cross-node event` / `reset`

### Section Header

- Label: `06 — AI as First-Class Citizen`
- Title: `Same engine. Same network. Different interface.`
- Description: `Claude Code connects via MCP — the same protocol, the same state. AI detects file changes, suggests verifications, and acts autonomously on its own node. Governance still requires human confirmation.`

---

## Section 07: Cross-Inventory Pipeline

**Files:** `web/src/components/PipelineDemo.astro`, `web/src/scripts/pipeline-demo.ts`

### Visual

Three columns (PM, Designer, Dev) connected by horizontal arrows styled as sand-stream channels. Each column has a checklist card that fills in as pipeline progresses.

### Layout

CSS grid, three columns. Vertical label at top, checklist card below, horizontal trace arrows between columns. Stacks on mobile.

### Demo Flow

1. **"PM defines"** — PM column activates. Checklist: `[x] User story written`, `[x] Acceptance criteria defined`, `[x] Compliance reviewed`. Each checkbox animates with spice-gold flash. Terminal: `inv checklist complete US-001 --proof "stakeholder sign-off"`
2. **"Designer references"** — Sand stream from PM→Designer. Designer checklist with upstream reference: `trace: US-001 (PM)`. Items: `[x] Screen spec created`, `[x] Mobile variant added`, `[ ] Accessibility reviewed`. Terminal: `inv trace add S-001 --depends-on US-001`
3. **"Dev implements"** — Sand streams from PM+Designer→Dev. Dev checklist with two upstream refs: `trace: US-001 (PM), S-001 (Design)`. Items: `[x] API endpoint built`, `[x] Tests passing`, `[ ] ADR documented`. Terminal: `inv audit --check mandatory-traces`
4. **"audit"** — Horizontal audit bar sweeps across all columns. Missing items pulse red. Summary: `3 verticals, 8 items, 2 pending`. Terminal: `inv audit --node all --format summary`

### Buttons

`PM defines` / `Designer references` / `Dev implements` / `audit` / `reset`

### Section Header

- Label: `07 — The Pipeline`
- Title: `Every vertical references upstream. Every handoff leaves a trace.`
- Description: `PM defines the requirements. Designer references them. Dev references both. The protocol enforces these connections — no orphan work, no lost context.`

---

## Files to Create

1. `web/src/components/CrossTeamCascade.astro` — P2P cascade component
2. `web/src/scripts/cross-team-cascade.ts` — Canvas animation for 5-island network
3. `web/src/components/GovernanceLifecycle.astro` — CR lifecycle component
4. `web/src/scripts/governance-lifecycle.ts` — Stage transition animations
5. `web/src/components/ClaudeCodeDemo.astro` — Split terminal component
6. `web/src/scripts/claude-code-demo.ts` — Synchronized terminal animation
7. `web/src/components/PipelineDemo.astro` — Pipeline checklist component
8. `web/src/scripts/pipeline-demo.ts` — Pipeline flow animation

## Files to Modify

1. `web/src/pages/index.astro` — New section structure, imports, remove ArchGrid/VotingCard
2. `web/src/components/VotingCard.astro` — Delete (replaced by GovernanceLifecycle)
3. `web/src/components/ArchGrid.astro` — Delete (replaced by PipelineDemo)

## Files to Keep

1. All existing components except VotingCard and ArchGrid
2. All styles and scripts (sand-flow.ts, propagation-demo.ts, global.css)
