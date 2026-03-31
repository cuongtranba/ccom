# Multi-Node Demo Recordings & Landing Page Update

## Overview

Build scripted asciinema recordings showing how 4 inventory nodes (dev, pm, qa, designer) communicate, query, propose changes, and vote — then integrate them into the landing page's existing ClaudeCodeDemo section with consistent styling.

## Context

The `/home/cuong/repo/test-iv/` directory contains a real 4-node test session on project `pvs-core`:
- **dev** — developer node, created ADRs, epics, tech designs, runbooks
- **pm** — project manager node, created PRDs, epics, user stories
- **qa** — QA node, created test plans, test cases, bug reports
- **designer** — designer node (vertical "ds"), created ML pipeline designs, data models, API specs

These nodes exchanged queries, created proposals, and voted on changes via the inventory protocol. The demo recreates this story as polished terminal recordings.

## Architecture

### Cast Generator Script

**File:** `web/scripts/generate-casts.ts`

A Bun script that generates asciinema v2 `.cast` files with split-screen terminal layouts.

**Core abstractions:**

- **`Pane`** — virtual terminal with grid position (row, col), dimensions, title, and content buffer. Handles line wrapping and scrollback within its bounds.
- **`Scene`** — ordered list of timed actions across panes: `type(pane, text, speed)`, `output(pane, lines)`, `pause(duration)`, `clear(pane)`.
- **`CastWriter`** — renders scenes into `.cast` format. Each frame uses ANSI cursor positioning (`\e[row;colH`) to update individual pane content without redrawing the full screen. Draws pane borders with box-drawing characters (`│`, `─`, `┌`, `┐`, `└`, `┘`, `┬`, `┴`, `┼`).

**Pane header format:** Colored node name with role indicator:
```
┌─ dev@pvs-core ──────────────────────────────┐
```

**Terminal dimensions:** 120 cols × 40 rows
- 2x2 grid: each pane ~58 cols × 18 rows (2 col border, 2 row border)
- 2-pane horizontal: each pane ~58 cols × 38 rows
- Pane content area accounts for 1-line header + border

**Color scheme:** Uses the landing page's oklch-derived palette:
- Node headers: `--signal-pulse` (bright cyan)
- Prompt text: `--text-secondary`
- Command text: `--proven` (green-yellow)
- Output text: `--text-primary`
- Status badges: `--proven`, `--suspect`, `--broke` as appropriate
- Borders: `--text-muted`

Mapped to ANSI 24-bit color codes (`\e[38;2;R;G;Bm`) matching the existing `.cast` file style.

**Timing model:**
- Typing speed: 30-60ms per character (with slight jitter)
- Command execution pause: 300-500ms
- Output rendering: 20ms per line
- Scene transitions: 1.5s pause
- Total per recording: 12-18s

### Recording 1: "Network Setup" — `network-setup.cast`

**Layout:** 2×2 grid (dev top-left, pm top-right, qa bottom-left, designer bottom-right)

**Story:**
1. All 4 panes show `$ inv_online_nodes` — each node appears online one by one (staggered 0.5s)
2. dev creates: `inv_add_item kind:tech-design title:"Auth Flow with OAuth2 + JWT"`
3. pm creates: `inv_add_item kind:prd title:"PVS Core v2.0 Requirements"`
4. qa creates: `inv_add_item kind:test-plan title:"Auth Integration Test Plan"`
5. designer creates: `inv_add_item kind:tech-design title:"UI Authentication Module"`
6. Each pane shows success output with item UUID

**Purpose:** Demonstrates multi-node network formation and parallel item creation across verticals.

### Recording 2: "Cross-Node Query" — `cross-node-query.cast`

**Layout:** 2-pane horizontal initially (pm left, dev right), then transitions to 2×2 for qa involvement

**Story:**
1. pm pane: `inv_ask target:dev "Share your current inventory — list all items with kind and title"`
2. dev pane: receives query notification `📨 Query from pm@pvs-core`
3. dev pane: `inv_reply "Here are my items: [lists 3-4 key items with UUIDs]"`
4. pm pane: receives response, displays item list
5. Transition to 2×2: qa pane appears
6. qa pane: `inv_ask target:dev "What is the status of the User Onboarding epic? Any open test cases?"`
7. dev pane: `inv_reply "Epic 55a0.. is unverified, no linked test cases yet"`
8. qa pane: receives response

**Purpose:** Shows cross-node discovery and accountability — teams can query each other's inventory.

### Recording 3: "Proposal & Vote" — `proposal-vote.cast`

**Layout:** 2×2 grid (pm top-left, dev top-right, qa bottom-left, designer bottom-right)

**Story:**
1. pm pane: `inv_proposal_create item:<uuid> description:"Redesign UI Auth: migrate to JWT, add OAuth2/SSO, add MFA support, implement RBAC"`
2. All other panes: receive notification `📋 New proposal from pm@pvs-core`
3. dev pane: `inv_proposal_vote proposal:<cr-id> vote:approve reason:"Aligns with our OAuth2 tech design"`
4. qa pane: `inv_proposal_vote proposal:<cr-id> vote:approve reason:"Will improve testability of auth flows"`
5. designer pane: `inv_proposal_vote proposal:<cr-id> vote:approve reason:"Unified auth component simplifies UI patterns"`
6. pm pane: vote tally appears — ✅ 3/3 approved, proposal status → `approved`

**Purpose:** Shows the governance mechanism — cross-team proposals require multi-node consensus.

## Landing Page Changes

### ClaudeCodeDemo.astro

**Tab updates:**
| Current Tab | New Tab | New Cast File |
|---|---|---|
| MCP Session | Network Setup | `/casts/network-setup.cast` |
| Proposal & Vote | Cross-Node Query | `/casts/cross-node-query.cast` |
| Challenge | Proposal & Vote | `/casts/proposal-vote.cast` |

**Player config changes:**
- `cols`: 92 → 120 (accommodate split-screen)
- `rows`: 20-22 → 40 (accommodate 2×2 grid)
- `speed`: keep at 1x
- `idleTimeLimit`: keep at 3

**Responsive considerations:**
- At viewports < 768px, the wider player needs horizontal scroll or scale-down via `fit: 'width'`
- The existing `fit: 'width'` default in AsciinemaPlayer.astro should handle this — verify after implementation

### Styling Consistency (Impeccable)

After updating the component, run `impeccable:polish` to:
- Verify tab button spacing/sizing matches the wider player
- Ensure section heading alignment with other sections
- Check mobile breakpoint behavior with the wider/taller player
- Confirm color consistency between cast ANSI colors and CSS variables

## Build Integration

**New script in `web/package.json`:**
```json
"generate:casts": "bun run scripts/generate-casts.ts"
```

**Output:** Writes 3 files to `web/public/casts/`:
- `network-setup.cast`
- `cross-node-query.cast`
- `proposal-vote.cast`

**Old files to remove:**
- `mcp-session.cast`
- `governance-vote.cast`
- `challenge.cast`

`cross-node-signal.cast` — keep if used elsewhere, remove if only referenced by ClaudeCodeDemo.

## File Changes Summary

| File | Action |
|---|---|
| `web/scripts/generate-casts.ts` | Create — cast generator script |
| `web/public/casts/network-setup.cast` | Create — generated output |
| `web/public/casts/cross-node-query.cast` | Create — generated output |
| `web/public/casts/proposal-vote.cast` | Create — generated output |
| `web/public/casts/mcp-session.cast` | Delete |
| `web/public/casts/governance-vote.cast` | Delete |
| `web/public/casts/challenge.cast` | Delete |
| `web/src/components/ClaudeCodeDemo.astro` | Edit — update tabs, cast refs, dimensions |
| `web/package.json` | Edit — add `generate:casts` script |

## Testing

1. Run `bun run generate:casts` — verify 3 `.cast` files are produced
2. Open each `.cast` in `asciinema play <file>` or the web player — verify:
   - Split-screen borders render correctly
   - Text doesn't overflow pane boundaries
   - Timing feels natural (no rushed typing, no dead air)
   - Colors match landing page palette
3. Run `pnpm dev` in web/ — verify:
   - Tabs switch correctly
   - Player loads and auto-plays
   - Responsive at mobile widths
   - No layout shift from taller player
