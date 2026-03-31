# Landing Page Expansion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 3 new animated demo sections (P2P cascade, governance lifecycle, Claude Code integration, cross-inventory pipeline) and replace the architecture card grid + static voting card.

**Architecture:** Each new section is an Astro component + TypeScript animation script, following the same patterns as the existing PropagationDemo (canvas/DOM left, terminal panel right, demo buttons, same CSS classes). Index.astro gets restructured from 6 to 8 sections.

**Tech Stack:** Astro, TypeScript, Canvas API, CSS transitions, CSS custom properties (OKLCH)

**Design doc:** `docs/plans/2026-03-19-landing-page-expansion-design.md`

**Existing patterns to follow:**
- Terminal: `<pre class="demo-terminal">` with spans `.prompt`, `.cmd`, `.out`, `.s-proven`, `.s-suspect`
- Buttons: `<button class="demo-btn" data-action="...">` inside `.demo-buttons`
- Layout: `.network-demo` grid with `1fr 1fr`, stacks at 768px
- Panel: `.demo-panel` with `var(--bg-surface)` background
- Colors: Always use CSS variables via `cssVar('--name')` in scripts

---

### Task 1: Cross-Team Cascade Component

**Files:**
- Create: `web/src/components/CrossTeamCascade.astro`
- Create: `web/src/scripts/cross-team-cascade.ts`

**Step 1: Create the Astro component**

Create `web/src/components/CrossTeamCascade.astro`:

```astro
---
---

<div class="cascade-demo">
  <canvas id="cascade-viz" width="900" height="500"></canvas>

  <div class="demo-panel">
    <div class="demo-buttons">
      <button class="demo-btn" data-cascade="connect">connect</button>
      <button class="demo-btn" data-cascade="change">PM changes</button>
      <button class="demo-btn" data-cascade="resolve">resolve</button>
      <button class="demo-btn" data-cascade="reset">reset</button>
    </div>
    <pre class="demo-terminal" id="cascade-output"><span class="prompt">$</span> <span class="cmd">inv network status</span>
<span class="out">NETWORK: clinic-checkin
STATUS:  discovering peers...
NODES:   0 connected</span>

<span class="prompt">$</span> <span class="cmd">_</span></pre>
  </div>
</div>

<script>
  import '../scripts/cross-team-cascade.ts';
</script>

<style>
  .cascade-demo {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: clamp(2rem, 4vw, 5rem);
    align-items: start;
    margin-top: 3rem;
  }

  #cascade-viz {
    width: 100%;
    aspect-ratio: 9 / 5;
    max-width: 900px;
  }

  .demo-panel {
    padding: clamp(1.5rem, 3vw, 2.5rem);
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
  }

  .demo-terminal {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    line-height: 1.8;
    color: var(--text-secondary);
    white-space: pre-wrap;
    margin: 0;
    background: none;
    border: none;
  }

  .demo-terminal :global(.cmd) { color: var(--signal-pulse); }
  .demo-terminal :global(.out) { color: var(--text-muted); }
  .demo-terminal :global(.s-proven) { color: var(--proven); }
  .demo-terminal :global(.s-suspect) { color: var(--suspect); }
  .demo-terminal :global(.prompt) { color: var(--text-muted); }

  .demo-buttons {
    display: flex;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
  }

  .demo-btn {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    padding: 0.5rem 1rem;
    border: 1px solid var(--trace-line);
    border-radius: 4px;
    background: var(--bg-deep);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s ease;
    letter-spacing: 0.02em;
  }

  .demo-btn:hover {
    border-color: var(--signal-pulse);
    color: var(--signal-pulse);
    background: color-mix(in oklch, var(--signal-pulse) 5%, var(--bg-deep));
  }

  @media (max-width: 768px) {
    .cascade-demo { grid-template-columns: 1fr; }
    #cascade-viz { max-width: 100%; }
  }
</style>
```

**Step 2: Create the TypeScript animation script**

Create `web/src/scripts/cross-team-cascade.ts`:

```typescript
interface Island {
  id: string;
  label: string;
  x: number;
  y: number;
  nodes: { label: string; offsetX: number; offsetY: number }[];
  status: 'disconnected' | 'connected' | 'proven' | 'suspect';
  discoveryPulse: number;
}

interface P2PLink {
  from: string;
  to: string;
  active: boolean;
  drawProgress: number;
}

interface CascadeSignal {
  from: string;
  to: string;
  particles: { progress: number; speed: number; ox: number; oy: number; size: number; opacity: number }[];
  done: boolean;
  onArrive: (() => void) | null;
  arrived: boolean;
}

const cascadeCanvas = document.getElementById('cascade-viz') as HTMLCanvasElement | null;
if (cascadeCanvas) {
  const ctx = cascadeCanvas.getContext('2d')!;
  const rootStyles = getComputedStyle(document.documentElement);
  function cssVar(name: string): string {
    return rootStyles.getPropertyValue(name).trim();
  }

  const islands: Island[] = [
    { id: 'pm', label: 'PM', x: 450, y: 60, nodes: [
      { label: 'US-001', offsetX: -30, offsetY: 0 },
      { label: 'US-002', offsetX: 30, offsetY: 0 },
    ], status: 'disconnected', discoveryPulse: 0 },
    { id: 'design', label: 'Design', x: 150, y: 220, nodes: [
      { label: 'S-001', offsetX: -25, offsetY: -15 },
      { label: 'S-002', offsetX: 25, offsetY: 15 },
    ], status: 'disconnected', discoveryPulse: 0 },
    { id: 'dev', label: 'Dev', x: 750, y: 220, nodes: [
      { label: 'API-001', offsetX: -30, offsetY: -10 },
      { label: 'ADR-001', offsetX: 25, offsetY: 15 },
    ], status: 'disconnected', discoveryPulse: 0 },
    { id: 'qa', label: 'QA', x: 250, y: 400, nodes: [
      { label: 'TC-101', offsetX: 0, offsetY: 0 },
    ], status: 'disconnected', discoveryPulse: 0 },
    { id: 'devops', label: 'DevOps', x: 650, y: 400, nodes: [
      { label: 'MON-01', offsetX: 0, offsetY: 0 },
    ], status: 'disconnected', discoveryPulse: 0 },
  ];

  const links: P2PLink[] = [
    { from: 'pm', to: 'design', active: false, drawProgress: 0 },
    { from: 'pm', to: 'dev', active: false, drawProgress: 0 },
    { from: 'design', to: 'dev', active: false, drawProgress: 0 },
    { from: 'dev', to: 'qa', active: false, drawProgress: 0 },
    { from: 'dev', to: 'devops', active: false, drawProgress: 0 },
  ];

  let signals: CascadeSignal[] = [];
  let animatingConnect = false;

  function getIsland(id: string) { return islands.find(i => i.id === id)!; }

  function createSignal(from: string, to: string, onArrive: (() => void) | null): CascadeSignal {
    const particles = Array.from({ length: 12 }, () => ({
      progress: -(Math.random() * 0.2),
      speed: 0.010 + (Math.random() - 0.5) * 0.003,
      ox: (Math.random() - 0.5) * 8,
      oy: (Math.random() - 0.5) * 8,
      size: 1.5 + Math.random() * 2,
      opacity: 0.5 + Math.random() * 0.5,
    }));
    return { from, to, particles, done: false, onArrive, arrived: false };
  }

  function drawIsland(island: Island) {
    const color = island.status === 'proven' ? cssVar('--proven')
      : island.status === 'suspect' ? cssVar('--suspect')
      : island.status === 'connected' ? cssVar('--unverified')
      : cssVar('--text-muted');

    // Discovery pulse ring
    if (island.discoveryPulse > 0) {
      const pulseR = island.discoveryPulse * 60;
      const pulseA = 1 - island.discoveryPulse;
      ctx.strokeStyle = cssVar('--signal-pulse');
      ctx.globalAlpha = pulseA * 0.4;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(island.x, island.y, pulseR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      island.discoveryPulse += 0.015;
      if (island.discoveryPulse > 1) island.discoveryPulse = 0;
    }

    if (island.status === 'disconnected') {
      ctx.globalAlpha = 0.3;
    }

    // Island background circle
    ctx.fillStyle = color + '15';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(island.x, island.y, 45, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Glow for proven
    if (island.status === 'proven') {
      ctx.shadowBlur = 20;
      ctx.shadowColor = color;
      ctx.beginPath();
      ctx.arc(island.x, island.y, 45, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Nodes inside island
    for (const node of island.nodes) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(island.x + node.offsetX, island.y + node.offsetY, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Label
    ctx.fillStyle = color;
    ctx.font = '600 12px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(island.label, island.x, island.y + 65);

    // Status
    if (island.status !== 'disconnected') {
      ctx.font = '300 9px "JetBrains Mono", monospace';
      ctx.fillStyle = color;
      ctx.fillText(island.status, island.x, island.y + 78);
    }

    ctx.globalAlpha = 1;
  }

  function drawLoop() {
    ctx.clearRect(0, 0, cascadeCanvas!.width, cascadeCanvas!.height);

    // Draw links
    for (const link of links) {
      if (!link.active && link.drawProgress <= 0) continue;
      const from = getIsland(link.from);
      const to = getIsland(link.to);

      if (link.drawProgress < 1 && link.active) {
        link.drawProgress += 0.02;
        if (link.drawProgress > 1) link.drawProgress = 1;
      }

      const endX = from.x + (to.x - from.x) * link.drawProgress;
      const endY = from.y + (to.y - from.y) * link.drawProgress;

      ctx.strokeStyle = cssVar('--trace-line');
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Draw signals
    signals = signals.filter(s => !s.done);
    const sigColor = cssVar('--signal-pulse');
    for (const s of signals) {
      const from = getIsland(s.from);
      const to = getIsland(s.to);
      let allDone = true;
      for (const p of s.particles) {
        p.progress += p.speed;
        if (p.progress < 0 || p.progress > 1) { if (p.progress < 1) allDone = false; continue; }
        allDone = false;
        const x = from.x + (to.x - from.x) * p.progress + p.ox;
        const y = from.y + (to.y - from.y) * p.progress + p.oy;
        const fade = p.progress > 0.8 ? (1 - p.progress) / 0.2 : 1;
        ctx.globalAlpha = p.opacity * fade;
        ctx.fillStyle = sigColor;
        ctx.shadowBlur = 8;
        ctx.shadowColor = sigColor;
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      if (!s.arrived && s.particles.some(p => p.progress >= 0.85)) {
        s.arrived = true;
        if (s.onArrive) { s.onArrive(); s.onArrive = null; }
      }
      if (allDone) s.done = true;
    }

    // Draw islands
    for (const island of islands) {
      drawIsland(island);
    }

    requestAnimationFrame(drawLoop);
  }

  drawLoop();

  const output = document.getElementById('cascade-output')!;

  function runCascade(action: string) {
    if (action === 'reset') {
      islands.forEach(i => { i.status = 'disconnected'; i.discoveryPulse = 0; });
      links.forEach(l => { l.active = false; l.drawProgress = 0; });
      signals = [];
      animatingConnect = false;
      output.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv network status</span>\n<span class="out">NETWORK: clinic-checkin\nSTATUS:  discovering peers...\nNODES:   0 connected</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
      return;
    }

    if (action === 'connect') {
      animatingConnect = true;
      const order = ['pm', 'design', 'dev', 'qa', 'devops'];
      order.forEach((id, i) => {
        setTimeout(() => {
          const island = getIsland(id);
          island.status = 'connected';
          island.discoveryPulse = 0.01;
        }, i * 500);
      });

      // Activate links progressively
      links.forEach((link, i) => {
        setTimeout(() => { link.active = true; }, 2500 + i * 300);
      });

      output.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv network join --discovery mdns</span>\n<span class="out">Discovering peers on local network...</span>`;

      setTimeout(() => {
        output.innerHTML += `\n<span class="out">  Found: PM Inventory (de061a81)</span>`;
      }, 500);
      setTimeout(() => {
        output.innerHTML += `\n<span class="out">  Found: Design Inventory (5447c4b6)</span>`;
      }, 1000);
      setTimeout(() => {
        output.innerHTML += `\n<span class="out">  Found: Dev Inventory (0fb8353f)</span>`;
      }, 1500);
      setTimeout(() => {
        output.innerHTML += `\n<span class="out">  Found: QA Inventory (a23bc891)</span>`;
      }, 2000);
      setTimeout(() => {
        output.innerHTML += `\n<span class="out">  Found: DevOps Inventory (f90de234)</span>\n\n<span class="out">5 nodes connected. P2P mesh established.</span>`;
      }, 2500);
      setTimeout(() => {
        output.innerHTML += `\n<span class="out">Syncing trace graph across nodes...</span>\n<span class="out">Trace sync complete. 5 links active.</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
        animatingConnect = false;
      }, 4000);
      return;
    }

    if (action === 'change') {
      getIsland('pm').status = 'proven';
      output.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv verify US-001 --evidence "Added mobile check-in" --actor duke</span>\n<span class="out">Item verified → </span><span class="s-proven">proven</span>\n<span class="out">Propagating across P2P network:</span>`;

      setTimeout(() => {
        signals.push(createSignal('pm', 'design', () => { getIsland('design').status = 'suspect'; }));
        signals.push(createSignal('pm', 'dev', () => { getIsland('dev').status = 'suspect'; }));
      }, 400);

      setTimeout(() => {
        output.innerHTML += `\n<span class="out">  → Design node: 2 items now </span><span class="s-suspect">suspect</span>\n<span class="out">  → Dev node: 2 items now </span><span class="s-suspect">suspect</span>`;
        signals.push(createSignal('design', 'dev', null));
        signals.push(createSignal('dev', 'qa', () => { getIsland('qa').status = 'suspect'; }));
        signals.push(createSignal('dev', 'devops', () => { getIsland('devops').status = 'suspect'; }));
      }, 2000);

      setTimeout(() => {
        output.innerHTML += `\n<span class="out">  → QA node: 1 item now </span><span class="s-suspect">suspect</span>\n<span class="out">  → DevOps node: 1 item now </span><span class="s-suspect">suspect</span>\n\n<span class="out">1 change → 4 teams notified → 6 items </span><span class="s-suspect">suspect</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
      }, 3800);
      return;
    }

    if (action === 'resolve') {
      const order = ['design', 'dev', 'qa', 'devops'];
      order.forEach((id, i) => {
        setTimeout(() => { getIsland(id).status = 'proven'; }, i * 600);
      });

      output.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv reconcile --network --session RS-007</span>\n<span class="out">Starting reconciliation session RS-007...</span>`;

      setTimeout(() => { output.innerHTML += `\n<span class="out">  Design: S-001 re-verified → </span><span class="s-proven">proven</span>`; }, 600);
      setTimeout(() => { output.innerHTML += `\n<span class="out">  Dev: API-001 re-verified → </span><span class="s-proven">proven</span>`; }, 1200);
      setTimeout(() => { output.innerHTML += `\n<span class="out">  QA: TC-101 re-verified → </span><span class="s-proven">proven</span>`; }, 1800);
      setTimeout(() => {
        output.innerHTML += `\n<span class="out">  DevOps: MON-01 re-verified → </span><span class="s-proven">proven</span>\n\n<span class="out">Reconciliation complete. All nodes </span><span class="s-proven">proven</span><span class="out">.</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
      }, 2400);
    }
  }

  document.querySelectorAll<HTMLButtonElement>('[data-cascade]').forEach(btn => {
    btn.addEventListener('click', () => runCascade(btn.dataset.cascade!));
  });
}
```

**Step 3: Verify component renders**

Temporarily add `CrossTeamCascade` to index.astro to test. Check that:
- Canvas renders 5 islands in an arc
- "connect" shows discovery pulses and link drawing
- "change" sends sand streams PM→Design, PM→Dev, then second wave
- "resolve" turns all islands to proven
- Terminal updates at each stage

**Step 4: Commit**

```bash
git add web/src/components/CrossTeamCascade.astro web/src/scripts/cross-team-cascade.ts
git commit -m "feat: add cross-team cascade P2P network demo"
```

---

### Task 2: Governance Lifecycle Component

**Files:**
- Create: `web/src/components/GovernanceLifecycle.astro`
- Create: `web/src/scripts/governance-lifecycle.ts`

**Step 1: Create the Astro component**

Create `web/src/components/GovernanceLifecycle.astro`:

```astro
---
---

<div class="governance-demo">
  <div class="cr-lifecycle" id="cr-lifecycle">
    <div class="cr-header-bar">
      <span class="cr-badge" id="cr-badge">DRAFT</span>
      <span class="cr-id">CR-042</span>
    </div>
    <div class="cr-title-line">Change check-in API from sync to async</div>
    <div class="cr-proposer">
      <span class="cr-proposer-label">Proposed by:</span> Dev Node
    </div>

    <div class="cr-votes" id="cr-votes"></div>

    <div class="cr-quorum" id="cr-quorum">
      <div class="quorum-label">Human quorum</div>
      <div class="quorum-bar">
        <div class="quorum-fill" id="quorum-fill"></div>
      </div>
      <div class="quorum-text" id="quorum-text">0 / 3 votes</div>
    </div>
  </div>

  <div class="demo-panel">
    <div class="demo-buttons">
      <button class="demo-btn" data-gov="draft">draft</button>
      <button class="demo-btn" data-gov="open">open voting</button>
      <button class="demo-btn" data-gov="vote">cast votes</button>
      <button class="demo-btn" data-gov="approve">approve</button>
      <button class="demo-btn" data-gov="archive">archive</button>
      <button class="demo-btn" data-gov="reset">reset</button>
    </div>
    <pre class="demo-terminal" id="gov-output"><span class="prompt">$</span> <span class="cmd">inv cr list --status draft</span>
<span class="out">ID      TITLE                                  STATUS
CR-042  Change check-in API from sync to async  draft</span>

<span class="prompt">$</span> <span class="cmd">_</span></pre>
  </div>
</div>

<script>
  import '../scripts/governance-lifecycle.ts';
</script>

<style>
  .governance-demo {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: clamp(2rem, 4vw, 5rem);
    align-items: start;
    margin-top: 3rem;
  }

  .cr-lifecycle {
    padding: clamp(2rem, 3vw, 3rem);
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    transition: border-color 0.6s ease, box-shadow 0.6s ease;
  }

  .cr-lifecycle.approved {
    border-color: var(--proven);
    box-shadow: 0 0 30px color-mix(in oklch, var(--proven) 15%, transparent);
  }

  .cr-lifecycle.archived {
    opacity: 0.6;
    border-color: var(--border-subtle);
    box-shadow: none;
  }

  .cr-header-bar {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .cr-badge {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    padding: 0.25rem 0.6rem;
    border-radius: 3px;
    font-weight: 500;
    transition: all 0.4s ease;
  }

  .cr-badge.draft {
    background: color-mix(in oklch, var(--unverified) 15%, transparent);
    color: var(--unverified);
    border: 1px solid color-mix(in oklch, var(--unverified) 30%, transparent);
  }

  .cr-badge.voting {
    background: color-mix(in oklch, var(--proven) 15%, transparent);
    color: var(--proven);
    border: 1px solid color-mix(in oklch, var(--proven) 30%, transparent);
  }

  .cr-badge.approved {
    background: color-mix(in oklch, var(--proven) 25%, transparent);
    color: var(--proven);
    border: 1px solid color-mix(in oklch, var(--proven) 50%, transparent);
  }

  .cr-badge.archived {
    background: color-mix(in oklch, var(--text-muted) 15%, transparent);
    color: var(--text-muted);
    border: 1px solid color-mix(in oklch, var(--text-muted) 30%, transparent);
  }

  .cr-id {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .cr-title-line {
    font-size: 1.1rem;
    font-weight: 500;
    margin-bottom: 0.5rem;
  }

  .cr-proposer {
    font-size: 0.82rem;
    color: var(--text-muted);
    margin-bottom: 1.5rem;
  }

  .cr-proposer-label {
    font-family: var(--font-mono);
    font-size: 0.72rem;
  }

  .cr-votes {
    min-height: 0;
    transition: min-height 0.3s ease;
  }

  .vote-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.6rem 0;
    border-top: 1px solid var(--border-subtle);
    font-size: 0.85rem;
    opacity: 0;
    transform: translateX(-20px);
    animation: voteSlideIn 0.4s ease-out forwards;
  }

  @keyframes voteSlideIn {
    to { opacity: 1; transform: translateX(0); }
  }

  .vote-node {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    color: var(--text-secondary);
    min-width: 110px;
  }

  .vote-icon { font-size: 1rem; }
  .vote-icon.approve { color: var(--proven); }
  .vote-icon.revise { color: var(--suspect); }

  .vote-reason {
    font-size: 0.78rem;
    color: var(--text-muted);
    font-style: italic;
  }

  .vote-ai-tag {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    padding: 0.15rem 0.4rem;
    background: color-mix(in oklch, var(--signal-pulse) 10%, transparent);
    color: var(--signal-pulse);
    border-radius: 2px;
    letter-spacing: 0.05em;
  }

  .vote-advisory {
    font-size: 0.65rem;
    color: var(--text-muted);
    font-style: italic;
  }

  .cr-quorum {
    margin-top: 1.5rem;
    display: none;
  }

  .cr-quorum.visible { display: block; }

  .quorum-label {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    color: var(--text-muted);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin-bottom: 0.5rem;
  }

  .quorum-bar {
    height: 4px;
    background: var(--bg-elevated);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 0.3rem;
  }

  .quorum-fill {
    height: 100%;
    width: 0%;
    background: var(--proven);
    border-radius: 2px;
    transition: width 0.5s ease;
  }

  .quorum-text {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    color: var(--text-muted);
  }

  .demo-panel {
    padding: clamp(1.5rem, 3vw, 2.5rem);
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
  }

  .demo-terminal {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    line-height: 1.8;
    color: var(--text-secondary);
    white-space: pre-wrap;
    margin: 0;
    background: none;
    border: none;
  }

  .demo-terminal :global(.cmd) { color: var(--signal-pulse); }
  .demo-terminal :global(.out) { color: var(--text-muted); }
  .demo-terminal :global(.s-proven) { color: var(--proven); }
  .demo-terminal :global(.prompt) { color: var(--text-muted); }

  .demo-buttons {
    display: flex;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
  }

  .demo-btn {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    padding: 0.5rem 1rem;
    border: 1px solid var(--trace-line);
    border-radius: 4px;
    background: var(--bg-deep);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s ease;
    letter-spacing: 0.02em;
  }

  .demo-btn:hover {
    border-color: var(--signal-pulse);
    color: var(--signal-pulse);
    background: color-mix(in oklch, var(--signal-pulse) 5%, var(--bg-deep));
  }

  @media (max-width: 768px) {
    .governance-demo { grid-template-columns: 1fr; }
  }
</style>
```

**Step 2: Create the TypeScript animation script**

Create `web/src/scripts/governance-lifecycle.ts`:

```typescript
interface VoteData {
  node: string;
  icon: string;
  iconClass: string;
  reason: string;
  isAI: boolean;
  isHuman: boolean;
}

const allVotes: VoteData[] = [
  { node: 'PM Node', icon: '✓', iconClass: 'approve', reason: 'Aligns with mobile check-in epic', isAI: false, isHuman: true },
  { node: 'Design Node', icon: '↻', iconClass: 'revise', reason: 'Need loading state for async — creating screen spec', isAI: true, isHuman: false },
  { node: 'QA Node', icon: '✓', iconClass: 'approve', reason: 'Can update test suites, no breaking changes', isAI: true, isHuman: false },
  { node: 'DevOps Node', icon: '✓', iconClass: 'approve', reason: 'Monitoring covers async patterns', isAI: false, isHuman: true },
  { node: 'Arch Lead', icon: '✓', iconClass: 'approve', reason: 'Consistent with async-first strategy', isAI: false, isHuman: true },
];

const badge = document.getElementById('cr-badge');
const votesContainer = document.getElementById('cr-votes');
const quorumEl = document.getElementById('cr-quorum');
const quorumFill = document.getElementById('quorum-fill');
const quorumText = document.getElementById('quorum-text');
const lifecycle = document.getElementById('cr-lifecycle');
const output = document.getElementById('gov-output');

if (badge && votesContainer && quorumEl && quorumFill && quorumText && lifecycle && output) {
  let humanVotes = 0;

  function setBadge(stage: string) {
    badge!.textContent = stage.toUpperCase();
    badge!.className = 'cr-badge ' + stage;
  }

  function resetAll() {
    setBadge('draft');
    votesContainer!.innerHTML = '';
    quorumEl!.classList.remove('visible');
    quorumFill!.style.width = '0%';
    quorumText!.textContent = '0 / 3 votes';
    lifecycle!.className = 'cr-lifecycle';
    humanVotes = 0;
    output!.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv cr list --status draft</span>\n<span class="out">ID      TITLE                                  STATUS\nCR-042  Change check-in API from sync to async  draft</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
  }

  function runGov(action: string) {
    if (action === 'reset') { resetAll(); return; }

    if (action === 'draft') {
      resetAll();
      return;
    }

    if (action === 'open') {
      setBadge('voting');
      quorumEl!.classList.add('visible');
      quorumFill!.style.width = '0%';
      quorumText!.textContent = '0 / 3 human votes (need >50%)';
      output!.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv cr open CR-042 --scope pm,design,qa,devops,arch</span>\n<span class="out">CR-042 opened for voting.</span>\n<span class="out">Required quorum: >50% human votes (3 of 5 nodes)</span>\n<span class="out">Notifying affected nodes...</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
      return;
    }

    if (action === 'vote') {
      votesContainer!.innerHTML = '';
      humanVotes = 0;

      allVotes.forEach((vote, i) => {
        setTimeout(() => {
          const row = document.createElement('div');
          row.className = 'vote-row';

          let html = `<span class="vote-node">${vote.node}</span>`;
          html += `<span class="vote-icon ${vote.iconClass}">${vote.icon}</span>`;
          html += `<span class="vote-reason">${vote.reason}</span>`;
          if (vote.isAI) {
            html += `<span class="vote-ai-tag">AI</span>`;
            html += `<span class="vote-advisory">(advisory)</span>`;
          }

          row.innerHTML = html;
          votesContainer!.appendChild(row);

          if (vote.isHuman) {
            humanVotes++;
            const pct = (humanVotes / 3) * 100;
            quorumFill!.style.width = Math.min(pct, 100) + '%';
            quorumText!.textContent = `${humanVotes} / 3 human votes`;
          }
        }, i * 600);
      });

      output!.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv cr vote CR-042 --node pm --decision approve</span>\n<span class="out">PM Node voted: approve</span>`;

      setTimeout(() => {
        output!.innerHTML += `\n\n<span class="prompt">$</span> <span class="cmd">inv cr vote CR-042 --node design --decision revise</span>\n<span class="out">Design Node (AI) voted: revise (advisory)</span>`;
      }, 600);
      setTimeout(() => {
        output!.innerHTML += `\n\n<span class="prompt">$</span> <span class="cmd">inv cr vote CR-042 --node qa --decision approve</span>\n<span class="out">QA Node (AI) voted: approve (advisory)</span>`;
      }, 1200);
      setTimeout(() => {
        output!.innerHTML += `\n\n<span class="prompt">$</span> <span class="cmd">inv cr vote CR-042 --node devops --decision approve</span>\n<span class="out">DevOps Node voted: approve</span>`;
      }, 1800);
      setTimeout(() => {
        output!.innerHTML += `\n\n<span class="prompt">$</span> <span class="cmd">inv cr vote CR-042 --node arch --decision approve</span>\n<span class="out">Arch Lead voted: approve</span>\n\n<span class="out">Quorum reached: 3/3 human approvals.</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
      }, 2400);
      return;
    }

    if (action === 'approve') {
      setBadge('approved');
      lifecycle!.classList.add('approved');
      quorumFill!.style.width = '100%';
      quorumText!.textContent = '3 / 3 human votes — approved';
      output!.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv cr approve CR-042</span>\n<span class="out">CR-042 </span><span class="s-proven">approved</span>\n<span class="out">Human votes: 3/3 approve</span>\n<span class="out">AI advisory: 1 approve, 1 revise</span>\n<span class="out">Applying changes to affected inventories...</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
      return;
    }

    if (action === 'archive') {
      setBadge('archived');
      lifecycle!.classList.remove('approved');
      lifecycle!.classList.add('archived');
      output!.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv cr archive CR-042</span>\n<span class="out">CR-042 archived.</span>\n<span class="out">Changes applied. Traces updated.</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
      return;
    }
  }

  document.querySelectorAll<HTMLButtonElement>('[data-gov]').forEach(btn => {
    btn.addEventListener('click', () => runGov(btn.dataset.gov!));
  });
}
```

**Step 3: Commit**

```bash
git add web/src/components/GovernanceLifecycle.astro web/src/scripts/governance-lifecycle.ts
git commit -m "feat: add governance lifecycle demo with animated voting"
```

---

### Task 3: Claude Code Demo Component

**Files:**
- Create: `web/src/components/ClaudeCodeDemo.astro`
- Create: `web/src/scripts/claude-code-demo.ts`

**Step 1: Create the Astro component**

Create `web/src/components/ClaudeCodeDemo.astro`:

```astro
---
---

<div class="claude-demo">
  <div class="terminal-split">
    <div class="terminal-column">
      <div class="terminal-label">
        <span class="terminal-label-icon">⌘</span>
        <span>HUMAN — CLI</span>
      </div>
      <pre class="demo-terminal split-terminal" id="human-terminal"><span class="prompt">$</span> <span class="cmd">_</span></pre>
    </div>
    <div class="terminal-column">
      <div class="terminal-label">
        <span class="terminal-label-ai">AI</span>
        <span>AGENT — MCP</span>
      </div>
      <pre class="demo-terminal split-terminal" id="ai-terminal"><span class="prompt">⟩</span> <span class="cmd">_</span></pre>
    </div>
  </div>

  <div class="demo-buttons claude-buttons">
    <button class="demo-btn" data-claude="start">session start</button>
    <button class="demo-btn" data-claude="edit">human edits</button>
    <button class="demo-btn" data-claude="ai">AI acts</button>
    <button class="demo-btn" data-claude="cross">cross-node event</button>
    <button class="demo-btn" data-claude="reset">reset</button>
  </div>
</div>

<script>
  import '../scripts/claude-code-demo.ts';
</script>

<style>
  .claude-demo {
    margin-top: 3rem;
  }

  .terminal-split {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
    margin-bottom: 1.5rem;
  }

  .terminal-column {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    overflow: hidden;
  }

  .terminal-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 1.2rem;
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
  }

  .terminal-label-icon {
    font-size: 0.9rem;
  }

  .terminal-label-ai {
    font-size: 0.6rem;
    padding: 0.1rem 0.35rem;
    background: color-mix(in oklch, var(--signal-pulse) 15%, transparent);
    color: var(--signal-pulse);
    border-radius: 2px;
    font-weight: 500;
  }

  .split-terminal {
    padding: 1.2rem;
    min-height: 260px;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    line-height: 1.8;
    color: var(--text-secondary);
    white-space: pre-wrap;
    margin: 0;
    background: none;
    border: none;
  }

  .split-terminal :global(.cmd) { color: var(--signal-pulse); }
  .split-terminal :global(.out) { color: var(--text-muted); }
  .split-terminal :global(.s-proven) { color: var(--proven); }
  .split-terminal :global(.s-suspect) { color: var(--suspect); }
  .split-terminal :global(.event) { color: var(--suspect); }
  .split-terminal :global(.warn) { color: var(--suspect); font-weight: 500; }
  .split-terminal :global(.prompt) { color: var(--text-muted); }
  .split-terminal :global(.ai-mode) { color: var(--signal-pulse); }

  .claude-buttons {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .demo-btn {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    padding: 0.5rem 1rem;
    border: 1px solid var(--trace-line);
    border-radius: 4px;
    background: var(--bg-deep);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s ease;
    letter-spacing: 0.02em;
  }

  .demo-btn:hover {
    border-color: var(--signal-pulse);
    color: var(--signal-pulse);
    background: color-mix(in oklch, var(--signal-pulse) 5%, var(--bg-deep));
  }

  @media (max-width: 768px) {
    .terminal-split { grid-template-columns: 1fr; }
  }
</style>
```

**Step 2: Create the TypeScript animation script**

Create `web/src/scripts/claude-code-demo.ts`:

```typescript
const humanTerm = document.getElementById('human-terminal');
const aiTerm = document.getElementById('ai-terminal');

if (humanTerm && aiTerm) {
  function typeLines(el: HTMLElement, lines: string[], startDelay: number = 0) {
    lines.forEach((line, i) => {
      setTimeout(() => {
        if (i === 0) {
          el.innerHTML = line;
        } else {
          el.innerHTML += '\n' + line;
        }
      }, startDelay + i * 300);
    });
  }

  function runClaude(action: string) {
    if (action === 'reset') {
      humanTerm!.innerHTML = `<span class="prompt">$</span> <span class="cmd">_</span>`;
      aiTerm!.innerHTML = `<span class="prompt">⟩</span> <span class="cmd">_</span>`;
      return;
    }

    if (action === 'start') {
      humanTerm!.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv item list --node dev</span>`;
      setTimeout(() => {
        humanTerm!.innerHTML += `\n<span class="out">ID        KIND      TITLE                    STATUS</span>\n<span class="out">e8def515  api-spec  API-001: POST /check-in  </span><span class="s-proven">proven</span>\n<span class="out">c65ae3eb  adr       ADR-001: WebSocket sync  </span><span class="s-proven">proven</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
      }, 400);

      aiTerm!.innerHTML = `<span class="prompt">⟩</span> <span class="cmd">inv_session_status</span>`;
      setTimeout(() => {
        aiTerm!.innerHTML += `\n<span class="out">Node: Dev Inventory (0fb8353f)</span>\n<span class="out">Items: 2 total, 2 </span><span class="s-proven">proven</span><span class="out">, 0 suspect</span>\n<span class="out">Pending CRs: 0</span>\n<span class="out">Challenges: 0</span>\n<span class="ai-mode">[mode: autonomous]</span>\n\n<span class="prompt">⟩</span> <span class="cmd">_</span>`;
      }, 600);
      return;
    }

    if (action === 'edit') {
      humanTerm!.innerHTML = `<span class="prompt">$</span> <span class="cmd">vim api/checkin.go</span>\n<span class="out">... editing ...</span>`;

      setTimeout(() => {
        humanTerm!.innerHTML += `\n<span class="prompt">$</span> <span class="cmd">git commit -m "feat: async check-in handler"</span>\n<span class="out">[dev 4a2f8c1] feat: async check-in handler</span>\n<span class="out"> 1 file changed, 23 insertions(+), 8 deletions(-)</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
      }, 800);

      setTimeout(() => {
        aiTerm!.innerHTML = `<span class="event">[event]</span> <span class="out">file changed: api/checkin.go</span>`;
      }, 1000);

      setTimeout(() => {
        aiTerm!.innerHTML += `\n<span class="ai-mode">[auto-detect]</span> <span class="out">api/checkin.go → kind: api-spec</span>`;
      }, 1400);

      setTimeout(() => {
        aiTerm!.innerHTML += `\n<span class="ai-mode">[suggest]</span> <span class="out">verify API-001 with evidence</span>\n<span class="out">         "checkin.go: async handler added"</span>\n\n<span class="prompt">⟩</span> <span class="cmd">_</span>`;
      }, 1800);
      return;
    }

    if (action === 'ai') {
      aiTerm!.innerHTML = `<span class="ai-mode">[mode: autonomous]</span> <span class="out">acting on own node...</span>`;

      setTimeout(() => {
        aiTerm!.innerHTML += `\n\n<span class="prompt">⟩</span> <span class="cmd">inv verify API-001 --evidence "checkin.go: async handler added"</span>`;
      }, 400);

      setTimeout(() => {
        aiTerm!.innerHTML += `\n<span class="out">Item e8def515 verified → </span><span class="s-proven">proven</span>`;
      }, 800);

      setTimeout(() => {
        aiTerm!.innerHTML += `\n<span class="out">Broadcasting to network...</span>\n\n<span class="prompt">⟩</span> <span class="cmd">_</span>`;
      }, 1200);

      setTimeout(() => {
        humanTerm!.innerHTML = `<span class="event">[network]</span> <span class="out">Dev node verified API-001</span>\n<span class="out">         evidence: "checkin.go: async handler added"</span>\n<span class="out">         actor: claude-dev-agent</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
      }, 1400);
      return;
    }

    if (action === 'cross') {
      aiTerm!.innerHTML = `<span class="event">[event]</span> <span class="out">challenge received</span>\n<span class="out">  from: QA Node (a23bc891)</span>\n<span class="out">  type: weak-evidence</span>\n<span class="out">  reason: "API-001 tests not updated"</span>`;

      setTimeout(() => {
        aiTerm!.innerHTML += `\n\n<span class="warn">⚠ [mode: normal] cross-node governance</span>\n<span class="out">  requires human confirmation</span>\n<span class="out">  waiting for human response...</span>`;
      }, 800);

      setTimeout(() => {
        humanTerm!.innerHTML = `<span class="event">[challenge]</span> <span class="out">QA challenges API-001</span>\n<span class="out">  "API-001 tests not updated"</span>\n\n<span class="prompt">$</span> <span class="cmd">inv challenge respond CH-019 \\</span>\n<span class="cmd">  --action update-evidence \\</span>\n<span class="cmd">  --proof "test suite updated in c7f2a1"</span>`;
      }, 1200);

      setTimeout(() => {
        humanTerm!.innerHTML += `\n<span class="out">Challenge CH-019 resolved.</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;

        aiTerm!.innerHTML += `\n\n<span class="event">[resolved]</span> <span class="out">challenge CH-019 closed</span>\n<span class="out">  human provided updated evidence</span>\n\n<span class="prompt">⟩</span> <span class="cmd">_</span>`;
      }, 2200);
      return;
    }
  }

  document.querySelectorAll<HTMLButtonElement>('[data-claude]').forEach(btn => {
    btn.addEventListener('click', () => runClaude(btn.dataset.claude!));
  });
}
```

**Step 3: Commit**

```bash
git add web/src/components/ClaudeCodeDemo.astro web/src/scripts/claude-code-demo.ts
git commit -m "feat: add Claude Code split-terminal demo"
```

---

### Task 4: Pipeline Demo Component

**Files:**
- Create: `web/src/components/PipelineDemo.astro`
- Create: `web/src/scripts/pipeline-demo.ts`

**Step 1: Create the Astro component**

Create `web/src/components/PipelineDemo.astro`:

```astro
---
---

<div class="pipeline-demo">
  <div class="pipeline-columns" id="pipeline-viz">
    <div class="pipeline-col" data-vertical="pm">
      <div class="pipeline-vertical-label">PM</div>
      <div class="pipeline-card" id="pm-card"></div>
    </div>
    <div class="pipeline-arrow" id="arrow-pm-design">
      <div class="arrow-line"></div>
      <div class="arrow-particles" id="particles-pm-design"></div>
    </div>
    <div class="pipeline-col" data-vertical="design">
      <div class="pipeline-vertical-label">Designer</div>
      <div class="pipeline-card" id="design-card"></div>
    </div>
    <div class="pipeline-arrow" id="arrow-design-dev">
      <div class="arrow-line"></div>
      <div class="arrow-particles" id="particles-design-dev"></div>
    </div>
    <div class="pipeline-col" data-vertical="dev">
      <div class="pipeline-vertical-label">Dev</div>
      <div class="pipeline-card" id="dev-card"></div>
    </div>
  </div>

  <div class="pipeline-audit-bar" id="audit-bar"></div>

  <div class="pipeline-controls">
    <div class="demo-buttons">
      <button class="demo-btn" data-pipeline="pm">PM defines</button>
      <button class="demo-btn" data-pipeline="design">Designer references</button>
      <button class="demo-btn" data-pipeline="dev">Dev implements</button>
      <button class="demo-btn" data-pipeline="audit">audit</button>
      <button class="demo-btn" data-pipeline="reset">reset</button>
    </div>
    <pre class="demo-terminal" id="pipeline-output"><span class="prompt">$</span> <span class="cmd">inv audit --check mandatory-traces</span>
<span class="out">No items found. Run the pipeline to begin.</span>

<span class="prompt">$</span> <span class="cmd">_</span></pre>
  </div>
</div>

<script>
  import '../scripts/pipeline-demo.ts';
</script>

<style>
  .pipeline-demo {
    margin-top: 3rem;
  }

  .pipeline-columns {
    display: grid;
    grid-template-columns: 1fr auto 1fr auto 1fr;
    gap: 0;
    align-items: start;
    margin-bottom: 2rem;
  }

  .pipeline-col {
    text-align: center;
  }

  .pipeline-vertical-label {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--text-muted);
    letter-spacing: 0.2em;
    text-transform: uppercase;
    margin-bottom: 1rem;
  }

  .pipeline-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 1.2rem;
    min-height: 180px;
    text-align: left;
    transition: border-color 0.4s ease, opacity 0.4s ease;
  }

  .pipeline-card.active {
    border-color: var(--proven);
  }

  .pipeline-card :global(.trace-ref) {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    color: var(--signal-pulse);
    padding: 0.2rem 0.5rem;
    background: color-mix(in oklch, var(--signal-pulse) 8%, transparent);
    border-radius: 3px;
    display: inline-block;
    margin-bottom: 0.8rem;
  }

  .pipeline-card :global(.check-item) {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0;
    font-size: 0.8rem;
    color: var(--text-secondary);
    opacity: 0;
    transform: translateY(8px);
    animation: checkSlideIn 0.3s ease-out forwards;
  }

  @keyframes checkSlideIn {
    to { opacity: 1; transform: translateY(0); }
  }

  .pipeline-card :global(.check-box) {
    width: 14px;
    height: 14px;
    border: 1.5px solid var(--border-hover);
    border-radius: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.6rem;
    transition: all 0.3s ease;
    flex-shrink: 0;
  }

  .pipeline-card :global(.check-box.checked) {
    border-color: var(--proven);
    color: var(--proven);
    background: color-mix(in oklch, var(--proven) 15%, transparent);
  }

  .pipeline-card :global(.check-box.missing) {
    border-color: var(--suspect);
    color: var(--suspect);
  }

  .pipeline-arrow {
    display: flex;
    align-items: center;
    justify-content: center;
    padding-top: 5rem;
    width: 60px;
    position: relative;
  }

  .arrow-line {
    width: 100%;
    height: 1px;
    background: var(--trace-line);
    position: relative;
  }

  .arrow-line::after {
    content: '→';
    position: absolute;
    right: -4px;
    top: -8px;
    color: var(--trace-line);
    font-size: 0.9rem;
  }

  .pipeline-arrow.active .arrow-line {
    background: var(--signal-pulse);
  }

  .pipeline-arrow.active .arrow-line::after {
    color: var(--signal-pulse);
  }

  .pipeline-audit-bar {
    height: 2px;
    background: transparent;
    margin-bottom: 2rem;
    border-radius: 1px;
    position: relative;
    overflow: hidden;
  }

  .pipeline-audit-bar.scanning::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 30%;
    height: 100%;
    background: var(--signal-pulse);
    animation: auditSweep 1.5s ease-in-out forwards;
  }

  @keyframes auditSweep {
    from { left: -30%; }
    to { left: 100%; }
  }

  .pipeline-controls {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: clamp(1.5rem, 3vw, 2.5rem);
  }

  .demo-terminal {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    line-height: 1.8;
    color: var(--text-secondary);
    white-space: pre-wrap;
    margin: 0;
    background: none;
    border: none;
  }

  .demo-terminal :global(.cmd) { color: var(--signal-pulse); }
  .demo-terminal :global(.out) { color: var(--text-muted); }
  .demo-terminal :global(.s-proven) { color: var(--proven); }
  .demo-terminal :global(.s-suspect) { color: var(--suspect); }
  .demo-terminal :global(.prompt) { color: var(--text-muted); }

  .demo-buttons {
    display: flex;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
  }

  .demo-btn {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    padding: 0.5rem 1rem;
    border: 1px solid var(--trace-line);
    border-radius: 4px;
    background: var(--bg-deep);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s ease;
    letter-spacing: 0.02em;
  }

  .demo-btn:hover {
    border-color: var(--signal-pulse);
    color: var(--signal-pulse);
    background: color-mix(in oklch, var(--signal-pulse) 5%, var(--bg-deep));
  }

  @media (max-width: 768px) {
    .pipeline-columns {
      grid-template-columns: 1fr;
      gap: 1rem;
    }
    .pipeline-arrow {
      transform: rotate(90deg);
      width: 40px;
      padding-top: 0;
      margin: 0 auto;
    }
  }
</style>
```

**Step 2: Create the TypeScript animation script**

Create `web/src/scripts/pipeline-demo.ts`:

```typescript
interface CheckItem {
  label: string;
  checked: boolean;
}

interface VerticalState {
  traces: string[];
  items: CheckItem[];
}

const pmCard = document.getElementById('pm-card');
const designCard = document.getElementById('design-card');
const devCard = document.getElementById('dev-card');
const auditBar = document.getElementById('audit-bar');
const pipeOutput = document.getElementById('pipeline-output');

if (pmCard && designCard && devCard && auditBar && pipeOutput) {

  function renderCard(el: HTMLElement, state: VerticalState | null, active: boolean) {
    if (!state) { el.innerHTML = ''; el.classList.remove('active'); return; }
    if (active) el.classList.add('active');

    let html = '';
    for (const trace of state.traces) {
      html += `<span class="trace-ref">trace: ${trace}</span> `;
    }
    if (state.traces.length > 0) html += '<br>';

    state.items.forEach((item, i) => {
      const boxClass = item.checked ? 'checked' : '';
      const mark = item.checked ? '✓' : '';
      html += `<div class="check-item" style="animation-delay: ${i * 0.15}s">`;
      html += `<span class="check-box ${boxClass}">${mark}</span>`;
      html += `<span>${item.label}</span>`;
      html += `</div>`;
    });

    el.innerHTML = html;
  }

  function activateArrow(fromTo: string) {
    const arrow = document.getElementById(`arrow-${fromTo}`);
    if (arrow) arrow.classList.add('active');
  }

  function resetArrows() {
    document.querySelectorAll('.pipeline-arrow').forEach(a => a.classList.remove('active'));
  }

  function runPipeline(action: string) {
    if (action === 'reset') {
      renderCard(pmCard!, null, false);
      renderCard(designCard!, null, false);
      renderCard(devCard!, null, false);
      resetArrows();
      auditBar!.className = 'pipeline-audit-bar';
      pipeOutput!.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv audit --check mandatory-traces</span>\n<span class="out">No items found. Run the pipeline to begin.</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
      return;
    }

    if (action === 'pm') {
      renderCard(pmCard!, {
        traces: [],
        items: [
          { label: 'User story written', checked: true },
          { label: 'Acceptance criteria defined', checked: true },
          { label: 'Compliance reviewed', checked: true },
        ],
      }, true);

      pipeOutput!.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv checklist complete US-001 --proof "stakeholder sign-off"</span>\n<span class="out">Checklist for US-001:</span>\n<span class="out">  [✓] User story written</span>\n<span class="out">  [✓] Acceptance criteria defined</span>\n<span class="out">  [✓] Compliance reviewed</span>\n<span class="out">All items complete. Item </span><span class="s-proven">proven</span><span class="out">.</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
      return;
    }

    if (action === 'design') {
      activateArrow('pm-design');

      setTimeout(() => {
        renderCard(designCard!, {
          traces: ['US-001 (PM)'],
          items: [
            { label: 'Screen spec created', checked: true },
            { label: 'Mobile variant added', checked: true },
            { label: 'Accessibility reviewed', checked: false },
          ],
        }, true);
      }, 400);

      pipeOutput!.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv trace add S-001 --depends-on US-001</span>\n<span class="out">Trace created: S-001 → US-001 (PM)</span>`;

      setTimeout(() => {
        pipeOutput!.innerHTML += `\n\n<span class="prompt">$</span> <span class="cmd">inv checklist update S-001</span>\n<span class="out">Checklist for S-001:</span>\n<span class="out">  [✓] Screen spec created</span>\n<span class="out">  [✓] Mobile variant added</span>\n<span class="out">  [ ] Accessibility reviewed</span>\n<span class="out">2/3 complete. Item remains </span><span class="s-suspect">unverified</span><span class="out">.</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
      }, 600);
      return;
    }

    if (action === 'dev') {
      activateArrow('pm-design');
      activateArrow('design-dev');

      setTimeout(() => {
        renderCard(devCard!, {
          traces: ['US-001 (PM)', 'S-001 (Design)'],
          items: [
            { label: 'API endpoint built', checked: true },
            { label: 'Tests passing', checked: true },
            { label: 'ADR documented', checked: false },
          ],
        }, true);
      }, 600);

      pipeOutput!.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv trace add API-001 --depends-on US-001,S-001</span>\n<span class="out">Traces created:</span>\n<span class="out">  API-001 → US-001 (PM)</span>\n<span class="out">  API-001 → S-001 (Design)</span>`;

      setTimeout(() => {
        pipeOutput!.innerHTML += `\n\n<span class="prompt">$</span> <span class="cmd">inv audit --check mandatory-traces --node dev</span>\n<span class="out">Dev node: all items have required upstream traces.</span>\n<span class="out">  API-001 → PM ✓, Design ✓</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
      }, 800);
      return;
    }

    if (action === 'audit') {
      auditBar!.className = 'pipeline-audit-bar scanning';

      pipeOutput!.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv audit --node all --format summary</span>\n<span class="out">Scanning all verticals...</span>`;

      setTimeout(() => {
        // Flash missing items
        document.querySelectorAll('.check-box:not(.checked)').forEach(el => {
          el.classList.add('missing');
        });
      }, 800);

      setTimeout(() => {
        pipeOutput!.innerHTML += `\n\n<span class="out">AUDIT SUMMARY</span>\n<span class="out">─────────────────────────────────</span>\n<span class="out">  PM:     3/3 complete  </span><span class="s-proven">✓ healthy</span>\n<span class="out">  Design: 2/3 complete  </span><span class="s-suspect">⚠ 1 pending</span>\n<span class="out">  Dev:    2/3 complete  </span><span class="s-suspect">⚠ 1 pending</span>\n<span class="out">─────────────────────────────────</span>\n<span class="out">  Total: 3 verticals, 9 items, 2 pending</span>\n<span class="out">  Traces: all mandatory refs present</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
      }, 1500);
    }
  }

  document.querySelectorAll<HTMLButtonElement>('[data-pipeline]').forEach(btn => {
    btn.addEventListener('click', () => runPipeline(btn.dataset.pipeline!));
  });
}
```

**Step 3: Commit**

```bash
git add web/src/components/PipelineDemo.astro web/src/scripts/pipeline-demo.ts
git commit -m "feat: add cross-inventory pipeline demo with checklists"
```

---

### Task 5: Restructure index.astro

**Files:**
- Modify: `web/src/pages/index.astro`

**Step 1: Update imports and section structure**

Replace the entire frontmatter and template in `index.astro`. Keep the existing `<script>` and `<style>` blocks unchanged.

New frontmatter (lines 1-8):
```astro
---
import Base from '../layouts/Base.astro';
import SectionHeader from '../components/SectionHeader.astro';
import StateMachine from '../components/StateMachine.astro';
import PropagationDemo from '../components/PropagationDemo.astro';
import CrossTeamCascade from '../components/CrossTeamCascade.astro';
import GovernanceLifecycle from '../components/GovernanceLifecycle.astro';
import ClaudeCodeDemo from '../components/ClaudeCodeDemo.astro';
import PipelineDemo from '../components/PipelineDemo.astro';
---
```

New template (replacing everything between `<Base>` tags):
```astro
<Base title="Inventory Network — A Living Protocol">

  <!-- HERO -->
  <section class="hero">
    <p class="hero-eyebrow">Inventory Network Protocol v1.0</p>
    <h1 class="hero-title">
      Each team owns its <span class="highlight">source of truth.</span>
      The network keeps them <span class="highlight">alive.</span>
    </h1>
    <p class="hero-sub">
      A distributed protocol where inventories are nodes, traces are synapses,
      and signals propagate change across teams — automatically.
      Human and AI agents participate as equals.
    </p>
  </section>

  <!-- STATE MACHINE -->
  <section class="section">
    <SectionHeader
      label="01 — The Lifecycle"
      title="Every item has a pulse"
      description="Items enter as unverified. Evidence makes them proven. When upstream changes, they become suspect — automatically. Click a state to see the transitions fire."
    />
    <StateMachine />
  </section>

  <!-- NEURAL PROPAGATION -->
  <section class="section">
    <SectionHeader
      label="02 — Neural Propagation"
      title="Change one node. Watch the network respond."
      description="When PM updates a user story, signals travel through traces and automatically mark affected items in Design and Dev as suspect. Like neurons firing across synapses."
    />
    <PropagationDemo />
  </section>

  <!-- P2P NETWORK CASCADE -->
  <section class="section">
    <SectionHeader
      label="03 — P2P Network"
      title="One team changes. Five teams know."
      description="Each vertical runs its own inventory node. The P2P network connects them — discovery is automatic, propagation is instant, and no central server decides what's true."
    />
    <CrossTeamCascade />
  </section>

  <!-- GOVERNANCE -->
  <section class="section">
    <SectionHeader
      label="04 — Governance"
      title="No change lands without consensus."
      description="Cross-inventory changes go through a formal lifecycle. Affected nodes vote. AI participates with reasons — but only humans decide quorum."
    />
    <GovernanceLifecycle />
  </section>

  <!-- CLAUDE CODE -->
  <section class="section">
    <SectionHeader
      label="05 — AI as First-Class Citizen"
      title="Same engine. Same network. Different interface."
      description="Claude Code connects via MCP — the same protocol, the same state. AI detects file changes, suggests verifications, and acts autonomously on its own node. Governance still requires human confirmation."
    />
    <ClaudeCodeDemo />
  </section>

  <!-- PIPELINE -->
  <section class="section">
    <SectionHeader
      label="06 — The Pipeline"
      title="Every vertical references upstream. Every handoff leaves a trace."
      description="PM defines the requirements. Designer references them. Dev references both. The protocol enforces these connections — no orphan work, no lost context."
    />
    <PipelineDemo />
  </section>

  <!-- CTA -->
  <section class="cta-section">
    <SectionHeader
      label="07 — Start"
      title="Own your inventory."
      description="Each team decides its own structure, its own workflow. The protocol handles the connections."
    />
    <div class="cta-install" id="cta-install">
      <span class="dollar">$</span> go install github.com/cuongtran/my-inventory@latest
    </div>
  </section>

</Base>
```

Keep the existing `<script>` and `<style>` blocks (lines 79-156) **unchanged**.

**Step 2: Verify all sections render**

Run: `cd web && npm run dev`

Check that all 8 sections appear in order with correct headers and functional demos.

**Step 3: Commit**

```bash
git add web/src/pages/index.astro
git commit -m "feat: restructure page with 8 sections — 3 new demos replace arch grid + voting"
```

---

### Task 6: Delete Old Components

**Files:**
- Delete: `web/src/components/VotingCard.astro`
- Delete: `web/src/components/ArchGrid.astro`

**Step 1: Delete the files**

```bash
rm web/src/components/VotingCard.astro web/src/components/ArchGrid.astro
```

**Step 2: Verify no remaining imports**

Search for `VotingCard` and `ArchGrid` in the codebase. Should find zero references (index.astro was already updated in Task 5).

**Step 3: Commit**

```bash
git add -u web/src/components/VotingCard.astro web/src/components/ArchGrid.astro
git commit -m "chore: remove VotingCard and ArchGrid (replaced by new demos)"
```

---

### Task 7: Build Verification

**Files:** None (verification only)

**Step 1: Build the site**

Run: `cd web && npm run build`

Verify no build errors.

**Step 2: Check for TypeScript errors**

Verify the build output shows all modules transformed successfully.

**Step 3: Visual check**

Run dev server and verify:
- [ ] Hero section renders correctly
- [ ] State Machine section works (click states)
- [ ] Propagation demo works (all 4 buttons)
- [ ] Cross-Team Cascade works (connect → change → resolve → reset)
- [ ] Governance Lifecycle works (draft → open → vote → approve → archive → reset)
- [ ] Claude Code demo works (session start → human edits → AI acts → cross-node → reset)
- [ ] Pipeline demo works (PM → Designer → Dev → audit → reset)
- [ ] CTA section renders correctly
- [ ] Mobile responsive (all sections stack on narrow viewport)
- [ ] Sand flow background visible throughout

**Step 4: Check section label numbering**

Verify sections are numbered 01-07 in order:
01 — The Lifecycle, 02 — Neural Propagation, 03 — P2P Network, 04 — Governance, 05 — AI as First-Class Citizen, 06 — The Pipeline, 07 — Start
