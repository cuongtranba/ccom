// ---------------------------------------------------------------------------
// Cross-Team Cascade — P2P network demo
// Shows 5 team islands discovering each other via mDNS and cascading signals
// when PM changes a story.
// ---------------------------------------------------------------------------

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
}

interface P2PLink {
  from: string;
  to: string;
  active: boolean;
  drawProgress: number;
}

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

const cascadeCanvas = document.getElementById('cascade-viz') as HTMLCanvasElement | null;
if (cascadeCanvas) {
  const ctx = cascadeCanvas.getContext('2d')!;

  const rootStyles = getComputedStyle(document.documentElement);
  function cssVar(name: string): string {
    return rootStyles.getPropertyValue(name).trim();
  }

  // ---- Islands (5 teams) ----
  const islands: Island[] = [
    {
      id: 'pm', team: 'PM', x: 450, y: 60,
      nodes: [{ label: 'US-001', ox: -35, oy: 0 }, { label: 'US-002', ox: 35, oy: 0 }],
      status: 'disconnected', discoveryPulse: 0,
    },
    {
      id: 'design', team: 'Design', x: 150, y: 220,
      nodes: [{ label: 'S-001', ox: -30, oy: -18 }, { label: 'S-002', ox: 30, oy: 18 }],
      status: 'disconnected', discoveryPulse: 0,
    },
    {
      id: 'dev', team: 'Dev', x: 750, y: 220,
      nodes: [{ label: 'API-001', ox: -35, oy: -12 }, { label: 'ADR-001', ox: 30, oy: 18 }],
      status: 'disconnected', discoveryPulse: 0,
    },
    {
      id: 'qa', team: 'QA', x: 250, y: 400,
      nodes: [{ label: 'TC-101', ox: 0, oy: 0 }],
      status: 'disconnected', discoveryPulse: 0,
    },
    {
      id: 'devops', team: 'DevOps', x: 650, y: 400,
      nodes: [{ label: 'MON-01', ox: 0, oy: 0 }],
      status: 'disconnected', discoveryPulse: 0,
    },
  ];

  // ---- P2P links ----
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

  // ---- Sand particle signal (same pattern as propagation-demo) ----
  function createSandSignal(from: string, to: string, onArrive: (() => void) | null): ActiveSignal {
    const particles: SandParticle[] = Array.from({ length: 12 }, () => ({
      progress: -(Math.random() * 0.15),
      speed: 0.012 + (Math.random() - 0.5) * 0.004,
      offsetX: (Math.random() - 0.5) * 6,
      offsetY: (Math.random() - 0.5) * 6,
      size: 1.5 + Math.random() * 1.5,
      opacity: 0.6 + Math.random() * 0.4,
    }));
    return { from, to, particles, done: false, onArrive, arrived: false };
  }

  function statusColor(status: IslandStatus): string {
    switch (status) {
      case 'proven': return cssVar('--proven');
      case 'suspect': return cssVar('--suspect');
      case 'disconnected': return cssVar('--unverified');
      case 'connected': return cssVar('--unverified');
    }
  }

  // ---- Drawing helpers ----
  function drawIsland(island: Island): void {
    const radius = 55;
    const color = statusColor(island.status);

    // Disconnected islands are dim
    if (island.status === 'disconnected') {
      ctx.globalAlpha = 0.35;
    }

    // Fill circle
    ctx.beginPath();
    ctx.arc(island.x, island.y, radius, 0, Math.PI * 2);
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = (island.status === 'disconnected' ? 0.35 : 1.0) * 0.1;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = prevAlpha;

    // Stroke circle
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Proven glow
    if (island.status === 'proven') {
      ctx.shadowBlur = 18;
      ctx.shadowColor = color;
      ctx.beginPath();
      ctx.arc(island.x, island.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Inner node dots
    for (const node of island.nodes) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(island.x + node.ox, island.y + node.oy, 5.5, 0, Math.PI * 2);
      ctx.fill();

      // Node label
      ctx.fillStyle = cssVar('--text-primary');
      ctx.font = '500 13px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(node.label, island.x + node.ox, island.y + node.oy - 10);
    }

    // Team label below island
    ctx.fillStyle = cssVar('--text-primary');
    ctx.globalAlpha = island.status === 'disconnected' ? 0.35 : 1.0;
    ctx.font = '500 14px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(island.team, island.x, island.y + radius + 20);

    ctx.globalAlpha = 1.0;
  }

  function drawDiscoveryPulse(island: Island): void {
    if (island.discoveryPulse <= 0 || island.status === 'disconnected') return;

    const maxRadius = 85;
    const pulseRadius = (island.discoveryPulse % 1) * maxRadius;
    const pulseAlpha = 1.0 - (island.discoveryPulse % 1);

    ctx.beginPath();
    ctx.arc(island.x, island.y, pulseRadius, 0, Math.PI * 2);
    ctx.strokeStyle = cssVar('--signal-pulse');
    ctx.globalAlpha = pulseAlpha * 0.4;
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

  function drawSignals(): void {
    activeSignals = activeSignals.filter(s => !s.done);
    const signalColor = cssVar('--signal-pulse');

    for (const s of activeSignals) {
      const fromIsland = getIsland(s.from);
      const toIsland = getIsland(s.to);
      let allDone = true;

      for (const p of s.particles) {
        p.progress += p.speed;
        if (p.progress < 0 || p.progress > 1) {
          if (p.progress < 1) allDone = false;
          continue;
        }
        allDone = false;

        const x = fromIsland.x + (toIsland.x - fromIsland.x) * p.progress + p.offsetX;
        const y = fromIsland.y + (toIsland.y - fromIsland.y) * p.progress + p.offsetY;

        const fadeOut = p.progress > 0.8 ? (1.0 - p.progress) / 0.2 : 1.0;
        const alpha = p.opacity * fadeOut;

        ctx.globalAlpha = alpha;
        ctx.fillStyle = signalColor;
        ctx.shadowBlur = 8;
        ctx.shadowColor = signalColor;
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1.0;

      if (!s.arrived && s.particles.some(p => p.progress >= 0.85)) {
        s.arrived = true;
        if (s.onArrive) {
          s.onArrive();
          s.onArrive = null;
        }
      }

      if (allDone) s.done = true;
    }
  }

  // ---- Link draw animation ----
  let linkAnimations: Array<{ link: P2PLink; startTime: number }> = [];
  const LINK_DRAW_DURATION = 400; // ms

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

    // Draw links
    for (const link of links) {
      drawLink(link);
    }

    // Draw signals
    drawSignals();

    // Draw discovery pulses
    for (const island of islands) {
      drawDiscoveryPulse(island);
    }

    // Draw islands
    for (const island of islands) {
      drawIsland(island);
    }

    requestAnimationFrame(drawLoop);
  }

  requestAnimationFrame(drawLoop);

  // ---- Terminal output ----
  const output = document.getElementById('cascade-output')!;

  const INITIAL_TERMINAL = `<span class="prompt">$</span> <span class="cmd">inv network status</span>
<span class="out">P2P NETWORK          STATUS
Nodes connected      0 / 5
Discovery            idle
Last sweep           --</span>

<span class="prompt">$</span> <span class="cmd">_</span>`;

  // ---- Demo actions ----
  function resetState(): void {
    for (const island of islands) {
      island.status = 'disconnected';
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
    // Islands appear one by one (500ms each)
    const order = ['pm', 'design', 'dev', 'qa', 'devops'];

    output.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv network discover --mdns</span>
<span class="out">Starting mDNS discovery on local network...</span>`;

    order.forEach((id, i) => {
      setTimeout(() => {
        const island = getIsland(id);
        island.status = 'connected';
        island.discoveryPulse = 0;
        discoveryActive = true;

        output.innerHTML += `\n<span class="out">  [mDNS] Found </span><span class="s-proven">${island.team}</span><span class="out"> island (${island.nodes.length} items)</span>`;

        // After last island, show final status
        if (i === order.length - 1) {
          output.innerHTML += `\n\n<span class="out">P2P NETWORK          STATUS
Nodes connected      </span><span class="s-proven">5 / 5</span><span class="out">
Discovery            </span><span class="s-proven">active</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
        }
      }, 500 * (i + 1));
    });

    // Links activate starting at 2500ms (300ms each)
    links.forEach((link, i) => {
      setTimeout(() => {
        link.active = true;
        link.drawProgress = 0;
        linkAnimations.push({ link, startTime: performance.now() });
      }, 2500 + 300 * i);
    });
  }

  function runChange(): void {
    // PM becomes proven
    getIsland('pm').status = 'proven';

    output.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv verify US-001 --evidence "Round 3: added mobile check-in" --actor duke</span>
<span class="out">Item US-001 verified -> </span><span class="s-proven">proven</span>
<span class="out">Initiating cross-team sweep...</span>`;

    // Wave 1: PM -> Design + PM -> Dev (400ms)
    setTimeout(() => {
      activeSignals.push(createSandSignal('pm', 'design', () => {
        getIsland('design').status = 'suspect';
      }));
      activeSignals.push(createSandSignal('pm', 'dev', () => {
        getIsland('dev').status = 'suspect';
      }));

      output.innerHTML += `\n<span class="out">  -> Design island now </span><span class="s-suspect">suspect</span><span class="out"> (S-001, S-002)</span>`;
      output.innerHTML += `\n<span class="out">  -> Dev island now </span><span class="s-suspect">suspect</span><span class="out"> (API-001, ADR-001)</span>`;
    }, 400);

    // Wave 2: Design -> Dev + Dev -> QA + Dev -> DevOps (2000ms)
    setTimeout(() => {
      activeSignals.push(createSandSignal('design', 'dev', null));
      activeSignals.push(createSandSignal('dev', 'qa', () => {
        getIsland('qa').status = 'suspect';
      }));
      activeSignals.push(createSandSignal('dev', 'devops', () => {
        getIsland('devops').status = 'suspect';
      }));

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

  // ---- Button listeners ----
  const cascadeBtns = document.querySelectorAll<HTMLButtonElement>('[data-cascade]');
  cascadeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      cascadeBtns.forEach(b => b.classList.remove('active'));
      if (btn.dataset.cascade !== 'reset') btn.classList.add('active');
      runDemo(btn.dataset.cascade!);
    });
  });
}
