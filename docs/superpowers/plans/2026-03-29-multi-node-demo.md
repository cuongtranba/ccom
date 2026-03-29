# Multi-Node Demo Recordings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate 3 scripted asciinema `.cast` files showing 4-node collaboration (dev, pm, qa, designer) with split-screen terminal layouts, and update the landing page's ClaudeCodeDemo section to use them.

**Architecture:** A Bun script (`web/scripts/generate-casts.ts`) builds `.cast` files programmatically using helper modules for ANSI rendering, split-screen pane layout, and scene sequencing. The generated files replace the existing 3 cast files in `web/public/casts/`. The `ClaudeCodeDemo.astro` component is updated with new tab labels, cast paths, and dimensions.

**Tech Stack:** Bun (script runtime), asciinema v2 cast format (JSON lines), ANSI escape codes (24-bit color, cursor positioning, box-drawing), Astro (landing page component).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `web/scripts/cast-writer.ts` | Create | Core cast-file writer: Pane, Scene, CastWriter types and rendering logic |
| `web/scripts/cast-colors.ts` | Create | ANSI 24-bit color constants matching the landing page oklch palette |
| `web/scripts/cast-scenes.ts` | Create | Three scene definitions: network-setup, cross-node-query, proposal-vote |
| `web/scripts/generate-casts.ts` | Create | Entry point: builds scenes, writes `.cast` files to `web/public/casts/` |
| `web/public/casts/network-setup.cast` | Create (generated) | Output: 4 nodes come online, create items |
| `web/public/casts/cross-node-query.cast` | Create (generated) | Output: pm queries dev, qa queries dev |
| `web/public/casts/proposal-vote.cast` | Create (generated) | Output: pm proposes, dev/qa/designer vote |
| `web/public/casts/mcp-session.cast` | Delete | Replaced by network-setup.cast |
| `web/public/casts/governance-vote.cast` | Delete | Replaced by proposal-vote.cast |
| `web/public/casts/challenge.cast` | Delete | Replaced by cross-node-query.cast |
| `web/src/components/ClaudeCodeDemo.astro` | Modify | Update tab labels, cast paths, player dimensions |
| `web/package.json` | Modify | Add `generate:casts` script |

---

### Task 1: Cast Colors Module

**Files:**
- Create: `web/scripts/cast-colors.ts`

This module defines ANSI 24-bit color escape sequences matching the landing page's oklch CSS variables. The existing `.cast` files use RGB values like `\u001b[38;2;200;170;110m` — we follow the same convention.

- [ ] **Step 1: Create the color constants file**

```typescript
// web/scripts/cast-colors.ts
// ANSI 24-bit color codes matching the landing page oklch palette.
// Format: \x1b[38;2;R;G;Bm (foreground) or \x1b[48;2;R;G;Bm (background)

// oklch → approximate sRGB conversions (derived from existing cast files + CSS vars)
export const RESET = '\x1b[0m';
export const BOLD = '\x1b[1m';
export const DIM = '\x1b[2m';

// Foreground colors
export const FG = {
  /** --signal-pulse: oklch(0.78 0.16 65) ≈ rgb(200,170,110) — prompts, commands, accents */
  pulse: '\x1b[38;2;200;170;110m',
  /** --proven: oklch(0.75 0.14 80) ≈ rgb(100,160,90) — success, proven status */
  proven: '\x1b[38;2;100;160;90m',
  /** --suspect: oklch(0.62 0.16 45) ≈ rgb(190;120;60) — suspect status */
  suspect: '\x1b[38;2;190;120;60m',
  /** --broke: oklch(0.55 0.20 25) ≈ rgb(180;70;60) — broken status */
  broke: '\x1b[38;2;180;70;60m',
  /** --text-primary: oklch(0.90 0.02 75) ≈ rgb(225,218,205) — main text */
  text: '\x1b[38;2;225;218;205m',
  /** --text-secondary: oklch(0.60 0.03 70) ≈ rgb(150,140,125) — secondary text */
  secondary: '\x1b[38;2;150;140;125m',
  /** --text-muted: oklch(0.42 0.02 65) ≈ rgb(100,95;85) — muted, borders */
  muted: '\x1b[38;2;100;95;85m',
  /** --border-subtle ≈ rgb(120,100,70) — box borders (from existing casts) */
  border: '\x1b[38;2;120;100;70m',
  /** Blue accent for designer node header */
  blue: '\x1b[38;2;100;140;200m',
  /** Orange accent for pm node header */
  orange: '\x1b[38;2;210;150;80m',
  /** Red accent for qa node header */
  red: '\x1b[38;2;200;100;90m',
  /** Green accent for dev node header */
  green: '\x1b[38;2;100;170;100m',
} as const;

/** Per-node header color */
export const NODE_COLOR: Record<string, string> = {
  dev: FG.green,
  pm: FG.orange,
  qa: FG.red,
  designer: FG.blue,
};
```

- [ ] **Step 2: Verify the file runs without errors**

Run: `cd /home/cuong/repo/my-inventory && bun run web/scripts/cast-colors.ts`
Expected: no output, no errors (module only exports constants)

- [ ] **Step 3: Commit**

```bash
git add web/scripts/cast-colors.ts
git commit -m "feat(web): add ANSI color constants for cast generation"
```

---

### Task 2: Cast Writer Module — Types and Pane Rendering

**Files:**
- Create: `web/scripts/cast-writer.ts`

Core module that defines the Pane layout system, scene action types, and the CastWriter that serializes everything to asciinema v2 format. The split-screen is rendered using ANSI cursor positioning (`\x1b[row;colH`) and box-drawing characters.

- [ ] **Step 1: Create the cast-writer module with types and Pane class**

```typescript
// web/scripts/cast-writer.ts
import { RESET, BOLD, FG, NODE_COLOR } from './cast-colors';

// ── Terminal dimensions ──
export const TERM_COLS = 120;
export const TERM_ROWS = 40;

// ── Pane position in a grid ──
export interface PaneConfig {
  /** Node name shown in header (e.g. "dev") */
  node: string;
  /** Project name (e.g. "pvs-core") */
  project: string;
  /** Grid position: 0-based row */
  gridRow: number;
  /** Grid position: 0-based col */
  gridCol: number;
  /** Total grid rows (1 or 2) */
  gridRows: number;
  /** Total grid cols (1 or 2) */
  gridCols: number;
}

export class Pane {
  readonly node: string;
  readonly project: string;
  /** 1-based top row of the pane (including border) */
  readonly top: number;
  /** 1-based left col of the pane (including border) */
  readonly left: number;
  /** Width including borders */
  readonly width: number;
  /** Height including borders */
  readonly height: number;
  /** 1-based row of first content line (after header + border) */
  readonly contentTop: number;
  /** 1-based col of first content character */
  readonly contentLeft: number;
  /** Usable content width */
  readonly contentWidth: number;
  /** Usable content height */
  readonly contentHeight: number;
  /** Current content cursor row (0-based offset from contentTop) */
  cursorRow = 0;

  constructor(cfg: PaneConfig) {
    this.node = cfg.node;
    this.project = cfg.project;

    this.width = Math.floor(TERM_COLS / cfg.gridCols);
    this.height = Math.floor(TERM_ROWS / cfg.gridRows);
    this.left = cfg.gridCol * this.width + 1;
    this.top = cfg.gridRow * this.height + 1;

    // Content area: 1 row for top border, 1 row for header, 1 row for header-border
    // 1 col left border, 1 col right border
    this.contentTop = this.top + 3;
    this.contentLeft = this.left + 2;
    this.contentWidth = this.width - 4;
    this.contentHeight = this.height - 4; // top border + header + header-border + bottom border
  }
}

// ── Scene actions ──
export interface TypeAction {
  kind: 'type';
  pane: Pane;
  text: string;
  /** ms per character, default 50 */
  charDelay?: number;
}

export interface OutputAction {
  kind: 'output';
  pane: Pane;
  /** Pre-formatted lines (may contain ANSI codes). Each string is one line. */
  lines: string[];
  /** ms between lines, default 80 */
  lineDelay?: number;
}

export interface PauseAction {
  kind: 'pause';
  /** Duration in seconds */
  duration: number;
}

export interface ClearPaneAction {
  kind: 'clear';
  pane: Pane;
}

export type SceneAction = TypeAction | OutputAction | PauseAction | ClearPaneAction;

// ── Cast output ──
type CastEvent = [number, 'o', string];

/** Move cursor to 1-based row, col */
function moveTo(row: number, col: number): string {
  return `\x1b[${row};${col}H`;
}

/** Render the static border + header frame for a pane */
function renderPaneFrame(pane: Pane): string {
  const color = NODE_COLOR[pane.node] ?? FG.pulse;
  const borderColor = FG.border;
  const w = pane.width;

  let out = '';

  // Top border: ┌──── node@project ────┐
  const label = ` ${pane.node}@${pane.project} `;
  const dashesLeft = 2;
  const dashesRight = Math.max(1, w - dashesLeft - label.length - 2);
  out += moveTo(pane.top, pane.left);
  out += `${borderColor}┌${'─'.repeat(dashesLeft)}${color}${BOLD}${label}${RESET}${borderColor}${'─'.repeat(dashesRight)}┐${RESET}`;

  // Header separator: ├────────────────────┤
  out += moveTo(pane.top + 1, pane.left);
  out += `${borderColor}├${'─'.repeat(w - 2)}┤${RESET}`;

  // Content rows: │ (spaces) │
  const innerWidth = w - 2;
  for (let r = 0; r < pane.contentHeight; r++) {
    out += moveTo(pane.contentTop + r, pane.left);
    out += `${borderColor}│${RESET}${' '.repeat(innerWidth)}${borderColor}│${RESET}`;
  }

  // Bottom border: └────────────────────┘
  out += moveTo(pane.top + pane.height - 1, pane.left);
  out += `${borderColor}└${'─'.repeat(w - 2)}┘${RESET}`;

  return out;
}

/** Truncate a visible string to max chars (ignoring ANSI codes in length calc) */
function visibleLength(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function truncateVisible(s: string, max: number): string {
  let vis = 0;
  let result = '';
  const re = /(\x1b\[[0-9;]*m)|(.)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m[1]) {
      result += m[1]; // ANSI escape — doesn't count
    } else {
      if (vis >= max) break;
      result += m[2];
      vis++;
    }
  }
  return result + RESET;
}

/** Write a single line of text into a pane at its current cursor row */
function writeLine(pane: Pane, text: string): string {
  if (pane.cursorRow >= pane.contentHeight) {
    // Scroll: we just wrap around for simplicity in a scripted demo
    pane.cursorRow = pane.contentHeight - 1;
  }
  const truncated = truncateVisible(text, pane.contentWidth);
  const padLen = Math.max(0, pane.contentWidth - visibleLength(truncated));
  const row = pane.contentTop + pane.cursorRow;
  return moveTo(row, pane.contentLeft) + truncated + ' '.repeat(padLen);
}

export class CastWriter {
  private events: CastEvent[] = [];
  private time = 0;

  /** Add initial frame: clear screen + draw all pane borders */
  drawFrames(panes: Pane[]): void {
    let frame = '\x1b[2J\x1b[H'; // clear screen, home cursor
    for (const pane of panes) {
      frame += renderPaneFrame(pane);
    }
    this.events.push([this.time, 'o', frame]);
    this.time += 0.3;
  }

  /** Process a sequence of scene actions */
  run(actions: SceneAction[]): void {
    for (const action of actions) {
      switch (action.kind) {
        case 'type':
          this.handleType(action);
          break;
        case 'output':
          this.handleOutput(action);
          break;
        case 'pause':
          this.time += action.duration;
          break;
        case 'clear':
          this.handleClear(action);
          break;
      }
    }
  }

  private handleType(action: TypeAction): void {
    const { pane, text, charDelay = 50 } = action;
    // Show prompt first
    const prompt = `${FG.pulse}$${RESET} `;
    const promptFrame = writeLine(pane, prompt);
    this.events.push([this.time, 'o', promptFrame]);
    this.time += 0.2;

    // Type each character
    let typed = '';
    for (const ch of text) {
      typed += ch;
      const line = `${FG.pulse}$${RESET} ${FG.text}${typed}${RESET}`;
      const frame = writeLine(pane, line);
      this.events.push([this.time, 'o', frame]);
      this.time += charDelay / 1000 + (Math.random() * 0.02);
    }

    // "Enter" — advance cursor
    pane.cursorRow++;
    this.time += 0.3;
  }

  private handleOutput(action: OutputAction): void {
    const { pane, lines, lineDelay = 80 } = action;
    for (const line of lines) {
      const frame = writeLine(pane, line);
      this.events.push([this.time, 'o', frame]);
      pane.cursorRow++;
      this.time += lineDelay / 1000;
    }
  }

  private handleClear(action: ClearPaneAction): void {
    const { pane } = action;
    let frame = '';
    for (let r = 0; r < pane.contentHeight; r++) {
      frame += moveTo(pane.contentTop + r, pane.contentLeft) + ' '.repeat(pane.contentWidth);
    }
    pane.cursorRow = 0;
    this.events.push([this.time, 'o', frame]);
    this.time += 0.1;
  }

  /** Serialize to asciinema v2 format (JSON lines) */
  serialize(title: string): string {
    const header = JSON.stringify({
      version: 2,
      width: TERM_COLS,
      height: TERM_ROWS,
      timestamp: Math.floor(Date.now() / 1000),
      env: { SHELL: '/bin/zsh', TERM: 'xterm-256color' },
      title,
    });

    const lines = [header];
    for (const [t, type, data] of this.events) {
      lines.push(JSON.stringify([Math.round(t * 1000) / 1000, type, data]));
    }
    return lines.join('\n') + '\n';
  }
}

// ── Layout helpers ──

/** Create a 2x2 grid of panes */
export function grid2x2(
  nodes: [string, string, string, string],
  project: string,
): [Pane, Pane, Pane, Pane] {
  return [
    new Pane({ node: nodes[0], project, gridRow: 0, gridCol: 0, gridRows: 2, gridCols: 2 }),
    new Pane({ node: nodes[1], project, gridRow: 0, gridCol: 1, gridRows: 2, gridCols: 2 }),
    new Pane({ node: nodes[2], project, gridRow: 1, gridCol: 0, gridRows: 2, gridCols: 2 }),
    new Pane({ node: nodes[3], project, gridRow: 1, gridCol: 1, gridRows: 2, gridCols: 2 }),
  ];
}

/** Create a 2-pane horizontal split */
export function splitHorizontal(
  left: string,
  right: string,
  project: string,
): [Pane, Pane] {
  return [
    new Pane({ node: left, project, gridRow: 0, gridCol: 0, gridRows: 1, gridCols: 2 }),
    new Pane({ node: right, project, gridRow: 0, gridCol: 1, gridRows: 1, gridCols: 2 }),
  ];
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/cuong/repo/my-inventory && bun run web/scripts/cast-writer.ts`
Expected: no output, no errors

- [ ] **Step 3: Commit**

```bash
git add web/scripts/cast-writer.ts
git commit -m "feat(web): add cast-writer module with pane layout and scene rendering"
```

---

### Task 3: Scene Definitions

**Files:**
- Create: `web/scripts/cast-scenes.ts`

Defines the 3 demo scenes using the CastWriter API. Each scene function returns a `SceneAction[]` array. The content mirrors the actual test-iv conversation data.

- [ ] **Step 1: Create the scenes module**

```typescript
// web/scripts/cast-scenes.ts
import type { SceneAction } from './cast-writer';
import { Pane, grid2x2, splitHorizontal } from './cast-writer';
import { RESET, BOLD, FG } from './cast-colors';

const PROJECT = 'pvs-core';

// ── Helper to build common output patterns ──
function toolCall(tool: string): string {
  return `${FG.secondary}⏵ Calling${RESET} ${FG.pulse}${tool}${RESET}`;
}

function success(msg: string): string {
  return `${FG.proven}✓${RESET} ${msg}`;
}

function notification(icon: string, msg: string): string {
  return `${FG.pulse}${icon}${RESET} ${FG.text}${msg}${RESET}`;
}

function tableHeader(text: string): string {
  return `${FG.secondary}${text}${RESET}`;
}

// ═══════════════════════════════════════════
// Scene 1: Network Setup
// ═══════════════════════════════════════════
export function networkSetupScene(): { panes: Pane[]; actions: SceneAction[] } {
  const [dev, pm, qa, designer] = grid2x2(['dev', 'pm', 'qa', 'designer'], PROJECT);
  const panes = [dev, pm, qa, designer];

  const actions: SceneAction[] = [
    // All nodes check online status — staggered
    { kind: 'type', pane: dev, text: 'inv_online_nodes', charDelay: 40 },
    { kind: 'pause', duration: 0.3 },
    { kind: 'type', pane: pm, text: 'inv_online_nodes', charDelay: 40 },
    { kind: 'pause', duration: 0.3 },
    { kind: 'type', pane: qa, text: 'inv_online_nodes', charDelay: 40 },
    { kind: 'pause', duration: 0.3 },
    { kind: 'type', pane: designer, text: 'inv_online_nodes', charDelay: 40 },
    { kind: 'pause', duration: 0.5 },

    // Output: each sees the growing network
    { kind: 'output', pane: dev, lines: [
      toolCall('inv_online_nodes'),
      success(`${BOLD}4 nodes${RESET} online:`),
      `  ${FG.green}dev${RESET}  ${FG.orange}pm${RESET}  ${FG.red}qa${RESET}  ${FG.blue}designer${RESET}`,
    ]},
    { kind: 'pause', duration: 0.4 },
    { kind: 'output', pane: pm, lines: [
      toolCall('inv_online_nodes'),
      success(`${BOLD}4 nodes${RESET} online:`),
      `  ${FG.green}dev${RESET}  ${FG.orange}pm${RESET}  ${FG.red}qa${RESET}  ${FG.blue}designer${RESET}`,
    ]},
    { kind: 'output', pane: qa, lines: [
      toolCall('inv_online_nodes'),
      success(`${BOLD}4 nodes${RESET} online:`),
      `  ${FG.green}dev${RESET}  ${FG.orange}pm${RESET}  ${FG.red}qa${RESET}  ${FG.blue}designer${RESET}`,
    ]},
    { kind: 'output', pane: designer, lines: [
      toolCall('inv_online_nodes'),
      success(`${BOLD}4 nodes${RESET} online:`),
      `  ${FG.green}dev${RESET}  ${FG.orange}pm${RESET}  ${FG.red}qa${RESET}  ${FG.blue}designer${RESET}`,
    ]},
    { kind: 'pause', duration: 1.0 },

    // Each node creates their signature item
    { kind: 'type', pane: dev, text: 'inv_add_item kind:tech-design title:"Auth Flow with OAuth2 + JWT"', charDelay: 35 },
    { kind: 'pause', duration: 0.5 },
    { kind: 'output', pane: dev, lines: [
      toolCall('inv_add_item'),
      success(`Created ${BOLD}tech-design${RESET}: Auth Flow with OAuth2 + JWT`),
      `  ${FG.secondary}id: ${FG.muted}5ed3360c${RESET}  ${FG.secondary}state: ${FG.muted}unverified${RESET}`,
    ]},

    { kind: 'pause', duration: 0.3 },
    { kind: 'type', pane: pm, text: 'inv_add_item kind:prd title:"PVS Core v2.0 Requirements"', charDelay: 35 },
    { kind: 'pause', duration: 0.5 },
    { kind: 'output', pane: pm, lines: [
      toolCall('inv_add_item'),
      success(`Created ${BOLD}prd${RESET}: PVS Core v2.0 Requirements`),
      `  ${FG.secondary}id: ${FG.muted}2099d58c${RESET}  ${FG.secondary}state: ${FG.muted}unverified${RESET}`,
    ]},

    { kind: 'pause', duration: 0.3 },
    { kind: 'type', pane: qa, text: 'inv_add_item kind:test-plan title:"Auth Integration Test Plan"', charDelay: 35 },
    { kind: 'pause', duration: 0.5 },
    { kind: 'output', pane: qa, lines: [
      toolCall('inv_add_item'),
      success(`Created ${BOLD}test-plan${RESET}: Auth Integration Test Plan`),
      `  ${FG.secondary}id: ${FG.muted}63ec2aa2${RESET}  ${FG.secondary}state: ${FG.muted}unverified${RESET}`,
    ]},

    { kind: 'pause', duration: 0.3 },
    { kind: 'type', pane: designer, text: 'inv_add_item kind:tech-design title:"UI Authentication Module"', charDelay: 35 },
    { kind: 'pause', duration: 0.5 },
    { kind: 'output', pane: designer, lines: [
      toolCall('inv_add_item'),
      success(`Created ${BOLD}tech-design${RESET}: UI Authentication Module`),
      `  ${FG.secondary}id: ${FG.muted}034e51df${RESET}  ${FG.secondary}state: ${FG.muted}unverified${RESET}`,
    ]},

    { kind: 'pause', duration: 1.5 },
  ];

  return { panes, actions };
}

// ═══════════════════════════════════════════
// Scene 2: Cross-Node Query
// ═══════════════════════════════════════════
export function crossNodeQueryScene(): { panes: Pane[]; actions: SceneAction[] } {
  const [pm, dev, qa, designer] = grid2x2(['pm', 'dev', 'qa', 'designer'], PROJECT);
  const panes = [pm, dev, qa, designer];

  const actions: SceneAction[] = [
    // PM asks dev for inventory
    { kind: 'type', pane: pm, text: 'inv_ask target:dev "List your inventory items"', charDelay: 40 },
    { kind: 'pause', duration: 0.5 },
    { kind: 'output', pane: pm, lines: [
      toolCall('inv_ask'),
      success('Query sent to dev'),
    ]},

    // Dev receives notification
    { kind: 'pause', duration: 0.6 },
    { kind: 'output', pane: dev, lines: [
      notification('📨', 'Query from pm@pvs-core:'),
      `  ${FG.secondary}"List your inventory items"${RESET}`,
    ]},

    // Dev replies
    { kind: 'pause', duration: 0.8 },
    { kind: 'type', pane: dev, text: 'inv_reply "Here are my items:"', charDelay: 40 },
    { kind: 'pause', duration: 0.5 },
    { kind: 'output', pane: dev, lines: [
      toolCall('inv_reply'),
      success('Reply sent to pm'),
    ]},

    // PM receives reply
    { kind: 'pause', duration: 0.5 },
    { kind: 'output', pane: pm, lines: [
      notification('📩', 'Reply from dev@pvs-core:'),
      '',
      tableHeader('  KIND          TITLE'),
      `  tech-design   Auth Flow OAuth2 + JWT`,
      `  epic          User Onboarding Flow`,
      `  api-spec      REST API v1 - Users`,
      `  adr           Use PostgreSQL as primary DB`,
    ]},

    { kind: 'pause', duration: 1.0 },

    // QA asks about the epic
    { kind: 'type', pane: qa, text: 'inv_ask target:dev "Status of User Onboarding epic?"', charDelay: 40 },
    { kind: 'pause', duration: 0.5 },
    { kind: 'output', pane: qa, lines: [
      toolCall('inv_ask'),
      success('Query sent to dev'),
    ]},

    // Dev receives
    { kind: 'pause', duration: 0.6 },
    { kind: 'output', pane: dev, lines: [
      '',
      notification('📨', 'Query from qa@pvs-core:'),
      `  ${FG.secondary}"Status of User Onboarding epic?"${RESET}`,
    ]},

    // Dev replies
    { kind: 'pause', duration: 0.6 },
    { kind: 'type', pane: dev, text: 'inv_reply "Unverified — no linked test cases yet"', charDelay: 40 },
    { kind: 'pause', duration: 0.5 },
    { kind: 'output', pane: dev, lines: [
      toolCall('inv_reply'),
      success('Reply sent to qa'),
    ]},

    // QA receives
    { kind: 'pause', duration: 0.5 },
    { kind: 'output', pane: qa, lines: [
      notification('📩', 'Reply from dev@pvs-core:'),
      `  ${FG.muted}state:${RESET} unverified`,
      `  ${FG.muted}tests:${RESET} none linked`,
    ]},

    // Designer observes silently — show idle prompt
    { kind: 'output', pane: designer, lines: [
      `${FG.muted}listening to network events...${RESET}`,
      '',
      notification('📡', 'pm queried dev'),
      notification('📡', 'qa queried dev'),
    ]},

    { kind: 'pause', duration: 1.5 },
  ];

  return { panes, actions };
}

// ═══════════════════════════════════════════
// Scene 3: Proposal & Vote
// ═══════════════════════════════════════════
export function proposalVoteScene(): { panes: Pane[]; actions: SceneAction[] } {
  const [pm, dev, qa, designer] = grid2x2(['pm', 'dev', 'qa', 'designer'], PROJECT);
  const panes = [pm, dev, qa, designer];

  const crId = 'aef6ada7';

  const actions: SceneAction[] = [
    // PM creates proposal
    { kind: 'type', pane: pm, text: 'inv_proposal_create item:034e51df description:"Redesign UI Auth: JWT + OAuth2 + MFA + RBAC"', charDelay: 30 },
    { kind: 'pause', duration: 0.6 },
    { kind: 'output', pane: pm, lines: [
      toolCall('inv_proposal_create'),
      success(`Proposal ${BOLD}${crId}${RESET} created`),
      `  ${FG.secondary}target:${RESET} UI Authentication Module`,
      `  ${FG.secondary}status:${RESET} ${FG.pulse}voting${RESET}`,
    ]},

    // All other nodes receive notification
    { kind: 'pause', duration: 0.8 },
    { kind: 'output', pane: dev, lines: [
      notification('📋', 'New proposal from pm@pvs-core'),
      `  ${FG.secondary}"Redesign UI Auth: JWT +${RESET}`,
      `  ${FG.secondary} OAuth2 + MFA + RBAC"${RESET}`,
      `  ${FG.muted}CR: ${crId}${RESET}`,
    ]},
    { kind: 'pause', duration: 0.3 },
    { kind: 'output', pane: qa, lines: [
      notification('📋', 'New proposal from pm@pvs-core'),
      `  ${FG.secondary}"Redesign UI Auth: JWT +${RESET}`,
      `  ${FG.secondary} OAuth2 + MFA + RBAC"${RESET}`,
      `  ${FG.muted}CR: ${crId}${RESET}`,
    ]},
    { kind: 'pause', duration: 0.3 },
    { kind: 'output', pane: designer, lines: [
      notification('📋', 'New proposal from pm@pvs-core'),
      `  ${FG.secondary}"Redesign UI Auth: JWT +${RESET}`,
      `  ${FG.secondary} OAuth2 + MFA + RBAC"${RESET}`,
      `  ${FG.muted}CR: ${crId}${RESET}`,
    ]},

    // Dev votes
    { kind: 'pause', duration: 1.0 },
    { kind: 'type', pane: dev, text: `inv_proposal_vote proposal:${crId} vote:approve reason:"Aligns with our OAuth2 design"`, charDelay: 30 },
    { kind: 'pause', duration: 0.5 },
    { kind: 'output', pane: dev, lines: [
      toolCall('inv_proposal_vote'),
      success(`Vote: ${FG.proven}approve${RESET}`),
    ]},

    // QA votes
    { kind: 'pause', duration: 0.8 },
    { kind: 'type', pane: qa, text: `inv_proposal_vote proposal:${crId} vote:approve reason:"Improves auth testability"`, charDelay: 30 },
    { kind: 'pause', duration: 0.5 },
    { kind: 'output', pane: qa, lines: [
      toolCall('inv_proposal_vote'),
      success(`Vote: ${FG.proven}approve${RESET}`),
    ]},

    // Designer votes
    { kind: 'pause', duration: 0.8 },
    { kind: 'type', pane: designer, text: `inv_proposal_vote proposal:${crId} vote:approve reason:"Unified auth simplifies UI"`, charDelay: 30 },
    { kind: 'pause', duration: 0.5 },
    { kind: 'output', pane: designer, lines: [
      toolCall('inv_proposal_vote'),
      success(`Vote: ${FG.proven}approve${RESET}`),
    ]},

    // PM sees tally
    { kind: 'pause', duration: 1.0 },
    { kind: 'output', pane: pm, lines: [
      '',
      notification('🗳️', `Vote tally for ${crId}:`),
      `  ${FG.green}dev${RESET}      ${FG.proven}approve${RESET}`,
      `  ${FG.red}qa${RESET}       ${FG.proven}approve${RESET}`,
      `  ${FG.blue}designer${RESET} ${FG.proven}approve${RESET}`,
      '',
      `  ${FG.proven}✓ 3/3 approved${RESET} — status: ${BOLD}${FG.proven}approved${RESET}`,
    ]},

    { kind: 'pause', duration: 2.0 },
  ];

  return { panes, actions };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/cuong/repo/my-inventory && bun run web/scripts/cast-scenes.ts`
Expected: no output, no errors

- [ ] **Step 3: Commit**

```bash
git add web/scripts/cast-scenes.ts
git commit -m "feat(web): add 3 demo scene definitions for cast generation"
```

---

### Task 4: Generator Entry Point

**Files:**
- Create: `web/scripts/generate-casts.ts`
- Modify: `web/package.json:5-8` (add script)

- [ ] **Step 1: Create the generator entry point**

```typescript
// web/scripts/generate-casts.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CastWriter } from './cast-writer';
import {
  networkSetupScene,
  crossNodeQueryScene,
  proposalVoteScene,
} from './cast-scenes';

const OUT_DIR = join(import.meta.dir, '..', 'public', 'casts');

function generate(
  filename: string,
  title: string,
  sceneFn: () => { panes: import('./cast-writer').Pane[]; actions: import('./cast-writer').SceneAction[] },
): void {
  const writer = new CastWriter();
  const { panes, actions } = sceneFn();
  writer.drawFrames(panes);
  writer.run(actions);
  const content = writer.serialize(title);
  const path = join(OUT_DIR, filename);
  writeFileSync(path, content);
  console.log(`  ✓ ${filename} (${content.split('\n').length} events)`);
}

console.log('Generating cast files...\n');

generate('network-setup.cast', 'Network Setup — 4 Nodes Come Online', networkSetupScene);
generate('cross-node-query.cast', 'Cross-Node Query — Discovery & Accountability', crossNodeQueryScene);
generate('proposal-vote.cast', 'Proposal & Vote — Multi-Node Governance', proposalVoteScene);

console.log('\nDone. Files written to web/public/casts/');
```

- [ ] **Step 2: Add the generate:casts script to package.json**

In `web/package.json`, add to the `"scripts"` block:

```json
"generate:casts": "bun run scripts/generate-casts.ts"
```

The full scripts block becomes:
```json
"scripts": {
  "dev": "astro dev",
  "build": "astro build",
  "preview": "astro preview",
  "generate:casts": "bun run scripts/generate-casts.ts"
}
```

- [ ] **Step 3: Run the generator and verify output**

Run: `cd /home/cuong/repo/my-inventory/web && bun run generate:casts`
Expected:
```
Generating cast files...

  ✓ network-setup.cast (N events)
  ✓ cross-node-query.cast (N events)
  ✓ proposal-vote.cast (N events)

Done. Files written to web/public/casts/
```

Verify files exist:
Run: `ls -la /home/cuong/repo/my-inventory/web/public/casts/`
Expected: `network-setup.cast`, `cross-node-query.cast`, `proposal-vote.cast` alongside existing files

- [ ] **Step 4: Validate each cast file is valid asciinema v2**

Run: `cd /home/cuong/repo/my-inventory && head -1 web/public/casts/network-setup.cast | bun -e "const h = JSON.parse(await Bun.stdin.text()); console.log(h.version === 2 ? 'valid v2' : 'INVALID', h.width + 'x' + h.height)"`
Expected: `valid v2 120x40`

- [ ] **Step 5: Commit**

```bash
git add web/scripts/generate-casts.ts web/package.json web/public/casts/network-setup.cast web/public/casts/cross-node-query.cast web/public/casts/proposal-vote.cast
git commit -m "feat(web): add cast generator entry point and generate 3 demo recordings"
```

---

### Task 5: Update ClaudeCodeDemo Component

**Files:**
- Modify: `web/src/components/ClaudeCodeDemo.astro:1-149`
- Delete: `web/public/casts/mcp-session.cast`
- Delete: `web/public/casts/governance-vote.cast`
- Delete: `web/public/casts/challenge.cast`

- [ ] **Step 1: Update the tab labels and cast references**

In `web/src/components/ClaudeCodeDemo.astro`, replace lines 5-43:

Old:
```html
<div class="claude-demo">
  <div class="cast-tabs">
    <button class="cast-tab active" data-cast="session">MCP session</button>
    <button class="cast-tab" data-cast="vote">proposal & vote</button>
    <button class="cast-tab" data-cast="challenge">challenge</button>
  </div>

  <div class="cast-panels">
    <div class="cast-panel active" data-panel="session">
      <AsciinemaPlayer
        src="/casts/mcp-session.cast"
        title="dev node — register, list items, add trace, audit"
        rows={20}
        cols={92}
        speed={1}
        idleTimeLimit={3}
      />
    </div>
    <div class="cast-panel" data-panel="vote">
      <AsciinemaPlayer
        src="/casts/governance-vote.cast"
        title="dev proposes change — PM approves, QA rejects, tally shown"
        rows={22}
        cols={92}
        speed={1}
        idleTimeLimit={3}
      />
    </div>
    <div class="cast-panel" data-panel="challenge">
      <AsciinemaPlayer
        src="/casts/challenge.cast"
        title="QA challenges Dev's API spec — Dev resolves with evidence"
        rows={20}
        cols={92}
        speed={1}
        idleTimeLimit={3}
      />
    </div>
  </div>
</div>
```

New:
```html
<div class="claude-demo">
  <div class="cast-tabs">
    <button class="cast-tab active" data-cast="setup">network setup</button>
    <button class="cast-tab" data-cast="query">cross-node query</button>
    <button class="cast-tab" data-cast="vote">proposal & vote</button>
  </div>

  <div class="cast-panels">
    <div class="cast-panel active" data-panel="setup">
      <AsciinemaPlayer
        src="/casts/network-setup.cast"
        title="dev, pm, qa, designer — 4 nodes come online, create items"
        rows={40}
        cols={120}
        speed={1}
        idleTimeLimit={3}
      />
    </div>
    <div class="cast-panel" data-panel="query">
      <AsciinemaPlayer
        src="/casts/cross-node-query.cast"
        title="pm queries dev's inventory — qa asks about epic status"
        rows={40}
        cols={120}
        speed={1}
        idleTimeLimit={3}
      />
    </div>
    <div class="cast-panel" data-panel="vote">
      <AsciinemaPlayer
        src="/casts/proposal-vote.cast"
        title="pm proposes UI auth redesign — dev, qa, designer vote to approve"
        rows={40}
        cols={120}
        speed={1}
        idleTimeLimit={3}
      />
    </div>
  </div>
</div>
```

- [ ] **Step 2: Delete old cast files**

```bash
rm web/public/casts/mcp-session.cast web/public/casts/governance-vote.cast web/public/casts/challenge.cast
```

- [ ] **Step 3: Verify the landing page renders**

Run: `cd /home/cuong/repo/my-inventory/web && pnpm dev`
Open browser, navigate to the AI Accountability section, verify:
- 3 tabs show with correct labels
- Players load and auto-play
- Split-screen panes render correctly with box borders
- Tab switching works

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ClaudeCodeDemo.astro
git rm web/public/casts/mcp-session.cast web/public/casts/governance-vote.cast web/public/casts/challenge.cast
git commit -m "feat(web): update ClaudeCodeDemo with multi-node split-screen recordings"
```

---

### Task 6: Polish with Impeccable

**Files:**
- Modify: `web/src/components/ClaudeCodeDemo.astro` (styling adjustments)

- [ ] **Step 1: Run the impeccable:polish skill**

Invoke `impeccable:polish` on the ClaudeCodeDemo component to check:
- Tab button sizing works with the wider player
- Mobile breakpoint behavior (the `min-width: 580px` on `.cast-panel.active` may need updating for 120-col player)
- Spacing consistency with surrounding sections
- Color and font consistency

- [ ] **Step 2: Apply any fixes identified by the polish pass**

Fix issues in `ClaudeCodeDemo.astro` as needed.

- [ ] **Step 3: Final visual verification**

Run: `cd /home/cuong/repo/my-inventory/web && pnpm dev`
Check at desktop (1440px), tablet (768px), and mobile (375px) widths.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ClaudeCodeDemo.astro
git commit -m "style(web): polish ClaudeCodeDemo for consistency with landing page"
```
