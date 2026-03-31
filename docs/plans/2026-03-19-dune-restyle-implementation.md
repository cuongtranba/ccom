# Dune Restyle Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the landing page from neural/bioluminescent to Dune (Villeneuve) desert aesthetic with flowing sand background animation.

**Architecture:** Replace OKLCH color palette (hue 260→65-80), replace particle network with 3-layer parallax sand flow, re-skin propagation demo to use sand particle streams instead of single dots, tune typography for monumental feel.

**Tech Stack:** Astro, TypeScript, Canvas API, CSS custom properties (OKLCH)

**Design doc:** `docs/plans/2026-03-19-dune-restyle-design.md`

---

### Task 1: Swap Color Palette in global.css

**Files:**
- Modify: `web/src/styles/global.css:5-30`

**Step 1: Replace the `:root` custom properties**

Change the entire `:root` block from blue hue (260) to warm desert hue (65-80):

```css
:root {
  --bg-deep: oklch(0.12 0.02 65);
  --bg-surface: oklch(0.17 0.02 65);
  --bg-elevated: oklch(0.22 0.025 65);
  --border-subtle: oklch(0.28 0.02 65);
  --border-hover: oklch(0.40 0.03 70);

  --text-primary: oklch(0.90 0.02 75);
  --text-secondary: oklch(0.60 0.03 70);
  --text-muted: oklch(0.42 0.02 65);

  --proven: oklch(0.75 0.14 80);
  --proven-glow: oklch(0.65 0.17 80);
  --suspect: oklch(0.62 0.16 45);
  --suspect-glow: oklch(0.52 0.20 45);
  --broke: oklch(0.55 0.20 25);
  --unverified: oklch(0.55 0.04 70);
  --unverified-glow: oklch(0.45 0.06 70);

  --signal-pulse: oklch(0.78 0.16 65);
  --trace-line: oklch(0.30 0.03 65);
  --trace-active: oklch(0.55 0.10 70);

  --font-display: 'Space Grotesk', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}
```

**Step 2: Verify the dev server renders with new palette**

Run: `cd web && npm run dev`

Open browser at `http://localhost:4321`. All text, borders, backgrounds, and status colors should now use warm desert tones instead of blue/cool tones. The canvas scripts will still show old colors (fixed in later tasks).

**Step 3: Commit**

```bash
git add web/src/styles/global.css
git commit -m "style: swap OKLCH palette from neural blue to Dune desert warm"
```

---

### Task 2: Fix Hard-coded Color in VotingCard

**Files:**
- Modify: `web/src/components/VotingCard.astro:69`

**Step 1: Replace hard-coded OKLCH with CSS variable**

Change line 69 from:
```css
border-top: 1px solid oklch(0.22 0.01 260);
```
to:
```css
border-top: 1px solid var(--border-subtle);
```

**Step 2: Verify voting card renders correctly**

Check that the vote row dividers in the voting card section match the new warm palette.

**Step 3: Commit**

```bash
git add web/src/components/VotingCard.astro
git commit -m "fix: replace hard-coded OKLCH in VotingCard with CSS variable"
```

---

### Task 3: Typography Tuning

**Files:**
- Modify: `web/src/pages/index.astro:106-114`
- Modify: `web/src/components/SectionHeader.astro:23`

**Step 1: Tune hero title**

In `web/src/pages/index.astro`, change the `.hero-title` style:
```css
.hero-title {
  font-size: clamp(3rem, 8vw, 7rem);
  font-weight: 600;          /* was 700 */
  line-height: 0.95;
  letter-spacing: -0.01em;   /* was -0.03em */
  max-width: 14ch;
  margin-bottom: 2rem;
  opacity: 0;
  animation: fadeSlideUp 0.8s ease-out 0.5s forwards;
}
```

**Step 2: Widen section label letter-spacing**

In `web/src/components/SectionHeader.astro`, change `.section-label` letter-spacing:
```css
letter-spacing: 0.3em;  /* was 0.2em */
```

**Step 3: Verify typography changes**

Check hero title feels more open and monumental. Section labels should feel more architectural with wider spacing.

**Step 4: Commit**

```bash
git add web/src/pages/index.astro web/src/components/SectionHeader.astro
git commit -m "style: tune typography for Dune monumental feel"
```

---

### Task 4: Create Sand Flow Background

**Files:**
- Create: `web/src/scripts/sand-flow.ts`
- Modify: `web/src/layouts/Base.astro:23`

**Step 1: Write the sand flow script**

Create `web/src/scripts/sand-flow.ts`:

```typescript
interface SandGrain {
  x: number;
  y: number;
  vx: number;
  vy: number;
  vyPhase: number;
  vyAmp: number;
  r: number;
  opacity: number;
  trailLength: number;
}

interface SandLayer {
  grains: SandGrain[];
  speed: number;
  baseOpacity: number;
  trailLen: number;
  sizeRange: [number, number];
}

const canvas = document.getElementById('network-canvas') as HTMLCanvasElement;
if (canvas) {
  const ctx = canvas.getContext('2d')!;
  let layers: SandLayer[] = [];
  let width = 0;
  let height = 0;

  const SAND_COLOR_R = 194;
  const SAND_COLOR_G = 168;
  const SAND_COLOR_B = 120;

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
  }

  function createLayer(
    count: number,
    speed: number,
    baseOpacity: number,
    trailLen: number,
    sizeRange: [number, number],
  ): SandLayer {
    const grains: SandGrain[] = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: speed + (Math.random() - 0.5) * speed * 0.3,
      vy: 0,
      vyPhase: Math.random() * Math.PI * 2,
      vyAmp: 0.5 + Math.random() * 1.5,
      r: sizeRange[0] + Math.random() * (sizeRange[1] - sizeRange[0]),
      opacity: baseOpacity * (0.7 + Math.random() * 0.3),
      trailLength: trailLen * (0.8 + Math.random() * 0.4),
    }));
    return { grains, speed, baseOpacity, trailLen, sizeRange };
  }

  function init() {
    resize();
    const totalCount = Math.floor((width * height) / 20000);
    const backCount = Math.floor(totalCount * 0.30);
    const midCount = Math.floor(totalCount * 0.45);
    const frontCount = Math.floor(totalCount * 0.25);

    layers = [
      createLayer(backCount, 0.15, 0.12, 0, [2.0, 3.5]),
      createLayer(midCount, 0.4, 0.20, 0, [1.2, 2.2]),
      createLayer(frontCount, 0.8, 0.30, 3, [0.8, 1.5]),
    ];
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    for (const layer of layers) {
      for (const g of layer.grains) {
        g.vyPhase += 0.008;
        g.vy = Math.sin(g.vyPhase) * g.vyAmp * 0.1;

        g.x += g.vx;
        g.y += g.vy;

        if (g.x > width + 10) {
          g.x = -10;
          g.y = Math.random() * height;
        }
        if (g.y < -10) g.y = height + 10;
        if (g.y > height + 10) g.y = -10;

        const alpha = g.opacity;

        if (g.trailLength > 0) {
          const gradient = ctx.createLinearGradient(
            g.x - g.trailLength, g.y,
            g.x, g.y,
          );
          gradient.addColorStop(0, `rgba(${SAND_COLOR_R}, ${SAND_COLOR_G}, ${SAND_COLOR_B}, 0)`);
          gradient.addColorStop(1, `rgba(${SAND_COLOR_R}, ${SAND_COLOR_G}, ${SAND_COLOR_B}, ${alpha})`);

          ctx.strokeStyle = gradient;
          ctx.lineWidth = g.r * 1.2;
          ctx.beginPath();
          ctx.moveTo(g.x - g.trailLength, g.y);
          ctx.lineTo(g.x, g.y);
          ctx.stroke();
        }

        ctx.fillStyle = `rgba(${SAND_COLOR_R}, ${SAND_COLOR_G}, ${SAND_COLOR_B}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', () => {
    resize();
    init();
  });

  init();
  draw();
}
```

**Step 2: Update Base.astro to import the new script**

In `web/src/layouts/Base.astro`, change line 23 from:
```typescript
import '../scripts/background-network.ts';
```
to:
```typescript
import '../scripts/sand-flow.ts';
```

**Step 3: Verify sand flow renders**

Run dev server. The background should show warm sand particles flowing left-to-right in three distinct layers — slow/large in the back, fast/small with trails in the front. The overall mood should feel like desert wind.

**Step 4: Commit**

```bash
git add web/src/scripts/sand-flow.ts web/src/layouts/Base.astro
git commit -m "feat: replace particle network with Dune sand flow background"
```

---

### Task 5: Refactor Propagation Demo Colors to CSS Variables

**Files:**
- Modify: `web/src/scripts/propagation-demo.ts:48-55, 65, 81-83, 98, 116, 120-121, 125-126`

**Step 1: Add CSS variable reader at the top of the script**

After the `if (propCanvas)` check (line 23), add a helper to read CSS variables:

```typescript
const rootStyles = getComputedStyle(document.documentElement);
function cssVar(name: string): string {
  return rootStyles.getPropertyValue(name).trim();
}
```

**Step 2: Replace the `statusColor` function**

Replace the hex-based `statusColor` function (lines 48-55) with:

```typescript
function statusColor(status: string): string {
  switch (status) {
    case 'proven': return cssVar('--proven');
    case 'suspect': return cssVar('--suspect');
    case 'broke': return cssVar('--broke');
    default: return cssVar('--unverified');
  }
}
```

**Step 3: Replace hard-coded trace line color**

Replace line 65 (`rgba(100, 120, 110, 0.3)`) with:

```typescript
pCtx.strokeStyle = cssVar('--trace-line');
pCtx.globalAlpha = 0.5;
```

And reset `pCtx.globalAlpha = 1.0;` after the trace drawing loop ends (after line 71).

**Step 4: Replace hard-coded signal color**

Replace lines 81-83 (`#80c870`) with:

```typescript
const signalColor = cssVar('--signal-pulse');
pCtx.fillStyle = signalColor;
pCtx.shadowBlur = 12;
pCtx.shadowColor = signalColor;
```

**Step 5: Replace hard-coded label color**

Replace line 120 (`rgba(180,180,180,0.5)`) with:

```typescript
pCtx.fillStyle = cssVar('--text-muted');
pCtx.globalAlpha = 0.7;
```

And reset `pCtx.globalAlpha = 1.0;` after the fillText call.

**Step 6: Replace hard-coded status label below nodes**

Lines 124-126 already use `statusColor(n.status)` which now reads CSS vars. No change needed.

**Step 7: Verify demo renders with new palette**

Run dev server, click "verify all" and "PM changes story" buttons. Colors should be warm spice gold/burnt sienna instead of green/blue.

**Step 8: Commit**

```bash
git add web/src/scripts/propagation-demo.ts
git commit -m "refactor: propagation demo reads CSS variables instead of hard-coded colors"
```

---

### Task 6: Sand Particle Signals in Propagation Demo

**Files:**
- Modify: `web/src/scripts/propagation-demo.ts`

**Step 1: Replace the `ActiveSignal` interface**

Replace the existing `ActiveSignal` interface with a sand stream system:

```typescript
interface SandParticle {
  progress: number;
  speed: number;
  offsetX: number;
  offsetY: number;
  size: number;
  opacity: number;
}

interface ActiveSignal {
  from: string;
  to: string;
  particles: SandParticle[];
  done: boolean;
  onArrive: (() => void) | null;
  arrived: boolean;
}
```

**Step 2: Update signal creation**

Everywhere `activeSignals.push(...)` is called (lines ~155-167), replace the single-particle signal with a sand stream factory:

```typescript
function createSandSignal(from: string, to: string, onArrive: (() => void) | null): ActiveSignal {
  const particles: SandParticle[] = Array.from({ length: 10 }, () => ({
    progress: -(Math.random() * 0.15),
    speed: 0.012 + (Math.random() - 0.5) * 0.004,
    offsetX: (Math.random() - 0.5) * 6,
    offsetY: (Math.random() - 0.5) * 6,
    size: 1.5 + Math.random() * 1.5,
    opacity: 0.6 + Math.random() * 0.4,
  }));
  return { from, to, particles, done: false, onArrive, arrived: false };
}
```

Then replace all `activeSignals.push({ from: 'x', to: 'y', progress: 0, onArrive: () => {...} })` calls with:
```typescript
activeSignals.push(createSandSignal('x', 'y', () => { getNode('y').status = 'suspect'; }));
```

**Step 3: Update the signal rendering in `drawLoop`**

Replace the signal drawing block (lines ~73-93) with:

```typescript
activeSignals = activeSignals.filter(s => !s.done);
const signalColor = cssVar('--signal-pulse');

for (const s of activeSignals) {
  const fromNode = getNode(s.from);
  const toNode = getNode(s.to);
  let allDone = true;

  for (const p of s.particles) {
    p.progress += p.speed;
    if (p.progress < 0 || p.progress > 1) {
      if (p.progress < 1) allDone = false;
      continue;
    }
    allDone = false;

    const x = fromNode.x + (toNode.x - fromNode.x) * p.progress + p.offsetX;
    const y = fromNode.y + (toNode.y - fromNode.y) * p.progress + p.offsetY;

    const fadeOut = p.progress > 0.8 ? (1.0 - p.progress) / 0.2 : 1.0;
    const alpha = p.opacity * fadeOut;

    pCtx.globalAlpha = alpha;
    pCtx.fillStyle = signalColor;
    pCtx.shadowBlur = 8;
    pCtx.shadowColor = signalColor;
    pCtx.beginPath();
    pCtx.arc(x, y, p.size, 0, Math.PI * 2);
    pCtx.fill();
  }

  pCtx.shadowBlur = 0;
  pCtx.globalAlpha = 1.0;

  if (!s.arrived && s.particles.some(p => p.progress >= 0.85)) {
    s.arrived = true;
    if (s.onArrive) {
      s.onArrive();
      s.onArrive = null;
    }
  }

  if (allDone) s.done = true;
}
```

**Step 4: Update the reset action to clear new signal format**

In the `reset` action handler, ensure:
```typescript
activeSignals = [];
```
This already works since the array is reassigned.

**Step 5: Verify sand particle signals**

Run dev server. Click "verify all" then "PM changes story". Signals should appear as streams of 10 small sand particles flowing along trace lines with slight spread, fading out as they arrive. The spice-orange color should glow softly.

**Step 6: Commit**

```bash
git add web/src/scripts/propagation-demo.ts
git commit -m "feat: replace single-dot signals with sand particle streams"
```

---

### Task 7: Add Organic Node Edges in Propagation Demo

**Files:**
- Modify: `web/src/scripts/propagation-demo.ts`

**Step 1: Replace the node circle drawing with organic edges**

In `drawLoop`, replace the node circle drawing (lines ~95-127) with a function that draws a slightly irregular circle:

```typescript
function drawOrganicCircle(cx: number, cy: number, radius: number, segments: number = 24) {
  pCtx.beginPath();
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const wobble = radius + (Math.sin(angle * 5 + cx) * 1.2);
    const px = cx + Math.cos(angle) * wobble;
    const py = cy + Math.sin(angle) * wobble;
    if (i === 0) pCtx.moveTo(px, py);
    else pCtx.lineTo(px, py);
  }
  pCtx.closePath();
}
```

Then replace the two `pCtx.arc(n.x, n.y, 28, ...)` calls in the node drawing section with:

```typescript
// Fill
pCtx.fillStyle = color + '20';
pCtx.strokeStyle = color;
pCtx.lineWidth = 1.5;
drawOrganicCircle(n.x, n.y, 28);
pCtx.fill();
pCtx.stroke();

// Glow for proven
if (n.status === 'proven') {
  pCtx.shadowBlur = 15;
  pCtx.shadowColor = color;
  drawOrganicCircle(n.x, n.y, 28);
  pCtx.stroke();
  pCtx.shadowBlur = 0;
}
```

**Step 2: Verify organic node edges**

Nodes should have slightly uneven edges — like sand-worn stone markers. The irregularity should be subtle (+-1.2px), not jarring.

**Step 3: Commit**

```bash
git add web/src/scripts/propagation-demo.ts
git commit -m "feat: add organic sand-worn edges to propagation demo nodes"
```

---

### Task 8: Update .impeccable.md Design Context

**Files:**
- Modify: `.impeccable.md`

**Step 1: Update the design context to reflect Dune aesthetic**

Replace the entire content of `.impeccable.md` with:

```markdown
## Design Context

### Users
Primary audience: Duke (the boss) and team leads evaluating the Inventory Network Protocol. They need to immediately grasp that this is a working system, not a theoretical framework. They're technical decision-makers who value proof over polish.

### Brand Personality
**Desert sovereignty. Spice flows. Systems endure.**
The interface should feel like standing in the Arrakis desert — vast, warm, monumental. The protocol is ancient infrastructure disguised as modern technology. Sand flows through traces like spice through the network.

### Aesthetic Direction
- **Visual tone**: Dune (Villeneuve) — warm desert, monumental architecture, restrained power
- **Theme**: Dark warm mode. Deep sand-brown backgrounds. Spice gold and burnt sienna accents.
- **Color approach**: Warm sand base with spice-gold for proven, burnt sienna for suspect, deep rust for broke, desert stone for unverified. Signal pulse is bright spice orange. Everything in the 65-80 OKLCH hue range.
- **Background**: Flowing sand particles in 3 parallax layers (slow/large, medium, fast/small with trails). Left-to-right desert wind. Uniform warm sand color.
- **Typography**: Space Grotesk (geometric, monumental) for display. JetBrains Mono for code. Wider letter-spacing for architectural feel.
- **References**: Villeneuve's Dune (2021/2024), desert observatory UIs, ancient infrastructure
- **Anti-references**: Generic SaaS, AI slop (purple gradients, glassmorphism), neon cyberpunk, green matrix aesthetic

### Design Principles
1. **Show, don't describe** — Animate the actual state machine, don't just list features
2. **The network is the hero** — Interactive visualizations ARE the landing page, not decoration
3. **Signal over noise** — Every visual element should represent real data flow, not decoration
4. **Desert sovereignty** — The UI feels vast, warm, and inevitable — like the desert itself
5. **Proof over assertion** — Show the CLI output, the actual commands, the real state transitions
6. **Sand carries data** — Propagation signals are sand streams, not glowing dots. The medium is the metaphor.
```

**Step 2: Commit**

```bash
git add .impeccable.md
git commit -m "docs: update design context for Dune aesthetic"
```

---

### Task 9: Delete Old Background Script

**Files:**
- Delete: `web/src/scripts/background-network.ts`

**Step 1: Delete the old particle network script**

```bash
rm web/src/scripts/background-network.ts
```

**Step 2: Verify no imports reference the old file**

Search for `background-network` in the codebase. Should find zero references (Base.astro was already updated in Task 4).

**Step 3: Commit**

```bash
git add -u web/src/scripts/background-network.ts
git commit -m "chore: remove old particle network background script"
```

---

### Task 10: Visual Verification Pass

**Files:** None (verification only)

**Step 1: Run dev server and verify full page**

Run: `cd web && npm run dev`

Check each section:
- [ ] Hero: Sand flowing behind. Title is weight 600, wider spacing. "source of truth" and "alive" in spice gold.
- [ ] State Machine: Node colors use warm desert palette (gold, burnt sienna, rust, stone grey). Arrows glow spice orange on activation.
- [ ] Propagation Demo: Sand particle streams flow between nodes. Nodes have organic edges. Terminal output uses warm colors.
- [ ] Voting Card: Vote row borders use CSS variable. AI tags are spice orange. Proven votes are spice gold.
- [ ] Architecture Grid: Cards have warm borders and backgrounds. Signal pulse labels are spice orange.
- [ ] CTA: Install box uses warm palette. Hover glow is spice orange.
- [ ] Overall: No green, no blue-tinted greys, no cool tones anywhere. Everything feels like warm desert.

**Step 2: Check for any remaining hard-coded colors**

Search all `.astro` and `.ts` files for hex colors (`#`), `rgb(`, and hue `260` to catch anything missed.

**Step 3: Build check**

Run: `cd web && npm run build`

Verify no build errors.
