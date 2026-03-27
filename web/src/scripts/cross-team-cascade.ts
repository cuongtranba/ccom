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

  const ISLAND_W = 140;
  const ISLAND_H = 90;
  const ISLAND_R = 6;

  const islands: Island[] = [
    {
      id: 'pm', team: 'PM', x: 450, y: 60,
      nodes: [{ label: 'US-001', ox: -35, oy: 0 }, { label: 'US-002', ox: 35, oy: 0 }],
      status: 'disconnected', discoveryPulse: 0, prevStatus: 'disconnected', pulse: 0,
    },
    {
      id: 'design', team: 'Design', x: 150, y: 220,
      nodes: [{ label: 'S-001', ox: -30, oy: -18 }, { label: 'S-002', ox: 30, oy: 18 }],
      status: 'disconnected', discoveryPulse: 0, prevStatus: 'disconnected', pulse: 0,
    },
    {
      id: 'dev', team: 'Dev', x: 750, y: 220,
      nodes: [{ label: 'API-001', ox: -35, oy: -12 }, { label: 'ADR-001', ox: 30, oy: 18 }],
      status: 'disconnected', discoveryPulse: 0, prevStatus: 'disconnected', pulse: 0,
    },
    {
      id: 'qa', team: 'QA', x: 250, y: 400,
      nodes: [{ label: 'TC-101', ox: 0, oy: 0 }],
      status: 'disconnected', discoveryPulse: 0, prevStatus: 'disconnected', pulse: 0,
    },
    {
      id: 'devops', team: 'DevOps', x: 650, y: 400,
      nodes: [{ label: 'MON-01', ox: 0, oy: 0 }],
      status: 'disconnected', discoveryPulse: 0, prevStatus: 'disconnected', pulse: 0,
    },
  ];

  const links: P2PLink[] = [
    { from: 'pm', to: 'design', active: false, drawProgress: 0 },
    { from: 'pm', to: 'dev', active: false, drawProgress: 0 },
    { from: 'design', to: 'dev', active: false, drawProgress: 0 },
    { from: 'dev', to: 'qa', active: false, drawProgress: 0 },
    { from: 'dev', to: 'devops', active: false, drawProgress: 0 },
  ];

  let activeSignals: ActiveSignal[] = [];

  function getIsland(id: string): Island {
    return islands.find(i => i.id === id)!;
  }

  const { getHoveredId, hoverScales } = setupCanvasHover(cascadeCanvas, islands, ISLAND_W, ISLAND_H);

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
    for (const node of island.nodes) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(island.x + node.ox, island.y + node.oy, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = color;
      ctx.font = '500 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(node.label, island.x + node.ox, island.y + node.oy - 8);
    }

    // Team label below island
    ctx.fillStyle = cssVar('--text-muted');
    ctx.globalAlpha = dimAlpha;
    ctx.font = '500 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(island.team, island.x, island.y + ISLAND_H / 2 + 18);

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
  const LINK_DRAW_DURATION = 400;

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

  // ---- Main draw loop ----
  function drawLoop(timestamp: number): void {
    const w = cascadeCanvas!.width;
    const h = cascadeCanvas!.height;
    ctx.clearRect(0, 0, w, h);

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

    requestAnimationFrame(drawLoop);
  }

  requestAnimationFrame(drawLoop);

  // ---- Terminal output ----
  const output = document.getElementById('cascade-output')!;

  const INITIAL_TERMINAL = `<span class="prompt">$</span> <span class="cmd">inv network status</span>
<span class="out">NETWORK              STATUS
Nodes connected      0 / 5
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
    const order = ['pm', 'design', 'dev', 'qa', 'devops'];

    output.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv network connect</span>
<span class="out">Connecting to WebSocket server...</span>`;

    order.forEach((id, i) => {
      setTimeout(() => {
        const island = getIsland(id);
        island.status = 'connected';
        island.discoveryPulse = 0;
        discoveryActive = true;

        output.innerHTML += `\n<span class="out">  [ws] </span><span class="s-proven">${island.team}</span><span class="out"> node connected (${island.nodes.length} items)</span>`;

        if (i === order.length - 1) {
          output.innerHTML += `\n\n<span class="out">NETWORK              STATUS
Nodes connected      </span><span class="s-proven">5 / 5</span><span class="out">
Server               </span><span class="s-proven">active</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
        }
      }, 500 * (i + 1));
    });

    links.forEach((link, i) => {
      setTimeout(() => {
        link.active = true;
        link.drawProgress = 0;
        linkAnimations.push({ link, startTime: performance.now() });
      }, 2500 + 300 * i);
    });
  }

  function runChange(): void {
    getIsland('pm').status = 'proven';

    output.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv verify US-001 --evidence "Round 3: added mobile check-in" --actor duke</span>
<span class="out">Item US-001 verified -> </span><span class="s-proven">proven</span>
<span class="out">Initiating cross-team sweep...</span>`;

    setTimeout(() => {
      activeSignals.push(createSandSignal('pm', 'design', () => {
        getIsland('design').status = 'suspect';
      }, 12));
      activeSignals.push(createSandSignal('pm', 'dev', () => {
        getIsland('dev').status = 'suspect';
      }, 12));

      output.innerHTML += `\n<span class="out">  -> Design island now </span><span class="s-suspect">suspect</span><span class="out"> (S-001, S-002)</span>`;
      output.innerHTML += `\n<span class="out">  -> Dev island now </span><span class="s-suspect">suspect</span><span class="out"> (API-001, ADR-001)</span>`;
    }, 400);

    setTimeout(() => {
      activeSignals.push(createSandSignal('design', 'dev', null, 12));
      activeSignals.push(createSandSignal('dev', 'qa', () => {
        getIsland('qa').status = 'suspect';
      }, 12));
      activeSignals.push(createSandSignal('dev', 'devops', () => {
        getIsland('devops').status = 'suspect';
      }, 12));

      output.innerHTML += `\n<span class="out">  -> QA island now </span><span class="s-suspect">suspect</span><span class="out"> (TC-101)</span>`;
      output.innerHTML += `\n<span class="out">  -> DevOps island now </span><span class="s-suspect">suspect</span><span class="out"> (MON-01)</span>`;
    }, 2000);

    setTimeout(() => {
      output.innerHTML += `\n\n<span class="out">Sweep complete: </span><span class="s-suspect">4 islands</span><span class="out"> affected by 1 PM change.</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
    }, 3500);
  }

  function runResolve(): void {
    const order = ['design', 'dev', 'qa', 'devops'];

    output.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv reconcile --all --network</span>
<span class="out">Starting cross-team reconciliation...</span>`;

    order.forEach((id, i) => {
      setTimeout(() => {
        const island = getIsland(id);
        island.status = 'proven';

        output.innerHTML += `\n<span class="out">  [${island.team}] Reconciled -> </span><span class="s-proven">proven</span>`;

        if (i === order.length - 1) {
          output.innerHTML += `\n\n<span class="out">All islands </span><span class="s-proven">proven</span><span class="out">. Network consistent.</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
        }
      }, 600 * (i + 1));
    });
  }

  function runDemo(action: string): void {
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
