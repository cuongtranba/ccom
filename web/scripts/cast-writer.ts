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

    // Content area: 1 row for top border (with label), 1 row for separator
    // 1 col left border, 1 col right border
    this.contentTop = this.top + 2;
    this.contentLeft = this.left + 2;
    this.contentWidth = this.width - 4;
    this.contentHeight = this.height - 3; // top border + separator + bottom border
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
