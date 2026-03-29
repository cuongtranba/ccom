// ---------------------------------------------------------------------------
// Cross-Team Cascade — WebSocket network demo
// Shows 5 team nodes connecting via a central WebSocket server and cascading
// signals when PM changes a story.
// ---------------------------------------------------------------------------

import {
  type ActiveSignal,
  createCssVarReader,
  createSandSignal,
  renderSignals,
  resolveStatusColor,
  setupCanvasHover,
  calcSmoothScale,
  setupDemoButtons,
} from './demo-utils';

interface IslandNode {
  label: string;
  ox: number;
  oy: number;
}

type IslandStatus = 'disconnected' | 'connected' | 'proven' | 'suspect';

interface Island {
  id: string;
  team: string;
  x: number;
  y: number;
  nodes: IslandNode[];
  status: IslandStatus;
  discoveryPulse: number;
  prevStatus: IslandStatus;
  pulse: number;
}

interface P2PLink {
  from: string;
  to: string;
  active: boolean;
  drawProgress: number;
}

const cascadeCanvas = document.getElementById('cascade-viz') as HTMLCanvasElement | null;
if (cascadeCanvas) {
  const ctx = cascadeCanvas.getContext('2d')!;
  const cssVar = createCssVarReader();

  const BASE_W = 900;
  const BASE_H = 500;
  const ISLAND_W = 140;
  const ISLAND_H = 90;
  const ISLAND_R = 6;

  // DPR-aware canvas sizing
  let fontScale = 1;
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function resizeCanvas(): void {
    const dpr = window.devicePixelRatio || 1;
    cascadeCanvas!.width = BASE_W * dpr;
    cascadeCanvas!.height = BASE_H * dpr;
    const rect = cascadeCanvas!.getBoundingClientRect();
    const displayRatio = rect.width / BASE_W;
    fontScale = displayRatio < 0.7 ? Math.min(0.7 / displayRatio, 2) : 1;
  }
  resizeCanvas();
  window.addEventListener('resize', () => { resizeCanvas(); markDirty(); });

  const islands: Island[] = [
    {
      id: 'cuong', team: 'cuong-node', x: 450, y: 60,
      nodes: [{ label: 'US-001', ox: -35, oy: 0 }, { label: 'US-002', ox: 35, oy: 0 }],
      status: 'disconnected', discoveryPulse: 0, prevStatus: 'disconnected', pulse: 0,
    },
    {
      id: 'duke', team: 'duke-node', x: 150, y: 220,
      nodes: [{ label: 'S-001', ox: -30, oy: -18 }, { label: 'S-002', ox: 30, oy: 18 }],
      status: 'disconnected', discoveryPulse: 0, prevStatus: 'disconnected', pulse: 0,
    },
    {
      id: 'phong', team: 'phong-node', x: 750, y: 220,
      nodes: [{ label: 'API-001', ox: -35, oy: -12 }, { label: 'ADR-001', ox: 30, oy: 18 }],
      status: 'disconnected', discoveryPulse: 0, prevStatus: 'disconnected', pulse: 0,
    },
    {
      id: 'blue', team: 'blue-node', x: 350, y: 400,
      nodes: [{ label: 'TC-101', ox: 0, oy: 0 }],
      status: 'disconnected', discoveryPulse: 0, prevStatus: 'disconnected', pulse: 0,
    },
  ];

  const links: P2PLink[] = [
    { from: 'cuong', to: 'duke', active: false, drawProgress: 0 },
    { from: 'cuong', to: 'phong', active: false, drawProgress: 0 },
    { from: 'duke', to: 'phong', active: false, drawProgress: 0 },
    { from: 'phong', to: 'blue', active: false, drawProgress: 0 },
  ];

  let activeSignals: ActiveSignal[] = [];

  function getIsland(id: string): Island {
    return islands.find(i => i.id === id)!;
  }

  const { getHoveredId, hoverScales } = setupCanvasHover(cascadeCanvas, islands, ISLAND_W, ISLAND_H, { w: BASE_W, h: BASE_H });

  function drawIsland(island: Island): void {
    if (island.status !== island.prevStatus) {
      island.pulse = 1.0;
      island.prevStatus = island.status;
    }
    if (island.pulse > 0) island.pulse = Math.max(0, island.pulse - 0.03);

    const scale = calcSmoothScale(island.id, island.id === getHoveredId(), island.pulse, hoverScales);

    if (Math.abs(scale - 1.0) > 0.001) {
      ctx.save();
      ctx.translate(island.x, island.y);
      ctx.scale(scale, scale);
      ctx.translate(-island.x, -island.y);
    }

    const color = resolveStatusColor(cssVar, island.status);
    const dimAlpha = island.status === 'disconnected' ? 0.35 : 1.0;

    // Background: bg-surface base + status color overlay (replicates color-mix)
    ctx.globalAlpha = dimAlpha;
    ctx.fillStyle = cssVar('--bg-surface');
    ctx.beginPath();
    ctx.roundRect(island.x - ISLAND_W / 2, island.y - ISLAND_H / 2, ISLAND_W, ISLAND_H, ISLAND_R);
    ctx.fill();

    ctx.globalAlpha = dimAlpha * 0.15;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(island.x - ISLAND_W / 2, island.y - ISLAND_H / 2, ISLAND_W, ISLAND_H, ISLAND_R);
    ctx.fill();

    // Border — 1.5px matching StateMachine
    ctx.globalAlpha = dimAlpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(island.x - ISLAND_W / 2, island.y - ISLAND_H / 2, ISLAND_W, ISLAND_H, ISLAND_R);
    ctx.stroke();

    // Proven glow using --proven-glow token
    if (island.status === 'proven') {
      ctx.shadowBlur = 25;
      ctx.shadowColor = cssVar('--proven-glow');
      ctx.beginPath();
      ctx.roundRect(island.x - ISLAND_W / 2, island.y - ISLAND_H / 2, ISLAND_W, ISLAND_H, ISLAND_R);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Inner node dots
    const dotR = 4 * Math.max(1, fontScale * 0.7);
    const nodeFontPx = Math.round(11 * fontScale);
    const teamFontPx = Math.round(12 * fontScale);
    for (const node of island.nodes) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(island.x + node.ox, island.y + node.oy, dotR, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = color;
      ctx.font = `500 ${nodeFontPx}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(node.label, island.x + node.ox, island.y + node.oy - 8 * fontScale);
    }

    // Team label below island
    ctx.fillStyle = cssVar('--text-muted');
    ctx.globalAlpha = dimAlpha;
    ctx.font = `500 ${teamFontPx}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(island.team, island.x, island.y + ISLAND_H / 2 + 18 * fontScale);

    ctx.globalAlpha = 1.0;

    if (Math.abs(scale - 1.0) > 0.001) {
      ctx.restore();
    }
  }

  function drawDiscoveryPulse(island: Island): void {
    if (island.discoveryPulse <= 0 || island.status === 'disconnected') return;

    const expand = (island.discoveryPulse % 1) * 25;
    const pulseAlpha = (1.0 - (island.discoveryPulse % 1)) * 0.4;

    ctx.beginPath();
    ctx.roundRect(
      island.x - ISLAND_W / 2 - expand,
      island.y - ISLAND_H / 2 - expand,
      ISLAND_W + expand * 2,
      ISLAND_H + expand * 2,
      ISLAND_R + expand * 0.15
    );
    ctx.strokeStyle = cssVar('--signal-pulse');
    ctx.globalAlpha = pulseAlpha;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1.0;
  }

  function drawLink(link: P2PLink): void {
    if (!link.active || link.drawProgress <= 0) return;

    const fromIsland = getIsland(link.from);
    const toIsland = getIsland(link.to);

    const endX = fromIsland.x + (toIsland.x - fromIsland.x) * link.drawProgress;
    const endY = fromIsland.y + (toIsland.y - fromIsland.y) * link.drawProgress;

    ctx.strokeStyle = cssVar('--trace-active');
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(fromIsland.x, fromIsland.y);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.globalAlpha = 1.0;
  }

  // ---- Link draw animation ----
  let linkAnimations: Array<{ link: P2PLink; startTime: number }> = [];
  const LINK_DRAW_DURATION = 700;

  function updateLinkAnimations(now: number): void {
    for (const anim of linkAnimations) {
      const elapsed = now - anim.startTime;
      anim.link.drawProgress = Math.min(elapsed / LINK_DRAW_DURATION, 1);
    }
    linkAnimations = linkAnimations.filter(a => a.link.drawProgress < 1);
  }

  // ---- Discovery pulse animation ----
  let discoveryActive = false;

  function updateDiscoveryPulses(): void {
    if (!discoveryActive) return;
    for (const island of islands) {
      if (island.status !== 'disconnected') {
        island.discoveryPulse += 0.008;
      }
    }
  }

  // ---- Idle detection ----
  let needsRedraw = true;

  function markDirty(): void {
    if (!needsRedraw) {
      needsRedraw = true;
      requestAnimationFrame(drawLoop);
    }
  }

  // ---- Main draw loop ----
  function drawLoop(timestamp: number): void {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, BASE_W, BASE_H);

    updateDiscoveryPulses();
    updateLinkAnimations(timestamp);

    for (const link of links) {
      drawLink(link);
    }

    activeSignals = renderSignals(ctx, activeSignals, id => getIsland(id), cssVar('--signal-pulse'));

    for (const island of islands) {
      drawDiscoveryPulse(island);
    }

    for (const island of islands) {
      drawIsland(island);
    }

    // Continue loop only if animations are active
    const hasAnimations = discoveryActive
      || linkAnimations.length > 0
      || activeSignals.length > 0
      || islands.some(i => i.pulse > 0.001);

    if (hasAnimations && !prefersReducedMotion.matches) {
      requestAnimationFrame(drawLoop);
    } else {
      needsRedraw = false;
    }
  }

  requestAnimationFrame(drawLoop);

  // ---- Terminal output ----
  const output = document.getElementById('cascade-output')!;

  const INITIAL_TERMINAL = `<span class="prompt">$</span> <span class="cmd">inv network status</span>
<span class="out">NETWORK              STATUS
Nodes connected      0 / 4
Server               idle
Last sweep           --</span>

<span class="prompt">$</span> <span class="cmd">_</span>`;

  // ---- Demo actions ----
  function resetState(): void {
    for (const island of islands) {
      island.status = 'disconnected';
      island.prevStatus = 'disconnected';
      island.pulse = 0;
      island.discoveryPulse = 0;
    }
    for (const link of links) {
      link.active = false;
      link.drawProgress = 0;
    }
    activeSignals = [];
    linkAnimations = [];
    discoveryActive = false;
    output.innerHTML = INITIAL_TERMINAL;
  }

  function runConnect(): void {
    const order = ['cuong', 'duke', 'phong', 'blue'];

    output.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv network connect</span>
<span class="out">Connecting to WebSocket server...</span>`;

    order.forEach((id, i) => {
      setTimeout(() => {
        const island = getIsland(id);
        island.status = 'connected';
        island.discoveryPulse = 0;
        discoveryActive = true;
        markDirty();

        output.innerHTML += `\n<span class="out">  [ws] </span><span class="s-proven">${island.team}</span><span class="out"> node connected (${island.nodes.length} items)</span>`;

        if (i === order.length - 1) {
          output.innerHTML += `\n\n<span class="out">NETWORK              STATUS
Nodes connected      </span><span class="s-proven">4 / 4</span><span class="out">
Server               </span><span class="s-proven">active</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
        }
      }, 900 * (i + 1));
    });

    links.forEach((link, i) => {
      setTimeout(() => {
        link.active = true;
        link.drawProgress = 0;
        linkAnimations.push({ link, startTime: performance.now() });
        markDirty();
      }, 4500 + 500 * i);
    });
  }

  function runChange(): void {
    getIsland('cuong').status = 'proven';
    markDirty();

    output.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv verify US-001 --evidence "Round 3: added mobile check-in" --actor cuong</span>
<span class="out">Item US-001 verified -> </span><span class="s-proven">proven</span>
<span class="out">Initiating cross-node sweep...</span>`;

    setTimeout(() => {
      activeSignals.push(createSandSignal('cuong', 'duke', () => {
        getIsland('duke').status = 'suspect';
      }, 12));
      activeSignals.push(createSandSignal('cuong', 'phong', () => {
        getIsland('phong').status = 'suspect';
      }, 12));
      markDirty();

      output.innerHTML += `\n<span class="out">  -> duke-node now </span><span class="s-suspect">suspect</span><span class="out"> (S-001, S-002)</span>`;
      output.innerHTML += `\n<span class="out">  -> phong-node now </span><span class="s-suspect">suspect</span><span class="out"> (API-001, ADR-001)</span>`;
    }, 800);

    setTimeout(() => {
      activeSignals.push(createSandSignal('duke', 'phong', null, 12));
      activeSignals.push(createSandSignal('phong', 'blue', () => {
        getIsland('blue').status = 'suspect';
      }, 12));
      markDirty();

      output.innerHTML += `\n<span class="out">  -> blue-node now </span><span class="s-suspect">suspect</span><span class="out"> (TC-101)</span>`;
    }, 3500);

    setTimeout(() => {
      output.innerHTML += `\n\n<span class="out">Sweep complete: </span><span class="s-suspect">3 nodes</span><span class="out"> affected by 1 cuong-node change.</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
    }, 6000);
  }

  function runResolve(): void {
    const order = ['duke', 'phong', 'blue'];

    output.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv reconcile --all --network</span>
<span class="out">Starting cross-team reconciliation...</span>`;

    order.forEach((id, i) => {
      setTimeout(() => {
        const island = getIsland(id);
        island.status = 'proven';
        markDirty();

        output.innerHTML += `\n<span class="out">  [${island.team}] Reconciled -> </span><span class="s-proven">proven</span>`;

        if (i === order.length - 1) {
          output.innerHTML += `\n\n<span class="out">All islands </span><span class="s-proven">proven</span><span class="out">. Network consistent.</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
        }
      }, 1000 * (i + 1));
    });
  }

  function runDemo(action: string): void {
    markDirty();
    switch (action) {
      case 'connect': runConnect(); break;
      case 'change': runChange(); break;
      case 'resolve': runResolve(); break;
      case 'reset': resetState(); break;
    }
  }

  const demoContainer = cascadeCanvas.closest('.cascade-demo');
  if (demoContainer) {
    setupDemoButtons(demoContainer, '.demo-btn[data-cascade]', 'cascade', runDemo);
  }
}
