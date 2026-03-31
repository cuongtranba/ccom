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
  /** --suspect: oklch(0.62 0.16 45) ≈ rgb(190,120,60) — suspect status */
  suspect: '\x1b[38;2;190;120;60m',
  /** --broke: oklch(0.55 0.20 25) ≈ rgb(180,70,60) — broken status */
  broke: '\x1b[38;2;180;70;60m',
  /** --text-primary: oklch(0.90 0.02 75) ≈ rgb(225,218,205) — main text */
  text: '\x1b[38;2;225;218;205m',
  /** --text-secondary: oklch(0.60 0.03 70) ≈ rgb(150,140,125) — secondary text */
  secondary: '\x1b[38;2;150;140;125m',
  /** --text-muted: oklch(0.42 0.02 65) ≈ rgb(100,95,85) — muted, borders */
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
