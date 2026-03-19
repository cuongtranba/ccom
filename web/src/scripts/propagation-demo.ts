interface DemoNode {
  id: string;
  label: string;
  vertical: string;
  x: number;
  y: number;
  status: string;
}

interface DemoTrace {
  from: string;
  to: string;
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

const propCanvas = document.getElementById('propagation-viz') as HTMLCanvasElement | null;
if (propCanvas) {
  const pCtx = propCanvas.getContext('2d')!;

  const rootStyles = getComputedStyle(document.documentElement);
  function cssVar(name: string): string {
    return rootStyles.getPropertyValue(name).trim();
  }

  const demoNodes: DemoNode[] = [
    { id: 'pm-us001', label: 'US-001', vertical: 'PM', x: 275, y: 60, status: 'unverified' },
    { id: 'des-s001', label: 'S-001', vertical: 'Design', x: 120, y: 220, status: 'unverified' },
    { id: 'des-s002', label: 'S-002', vertical: 'Design', x: 430, y: 220, status: 'unverified' },
    { id: 'dev-api', label: 'API-001', vertical: 'Dev', x: 160, y: 400, status: 'unverified' },
    { id: 'dev-adr', label: 'ADR-001', vertical: 'Dev', x: 390, y: 400, status: 'unverified' },
    { id: 'qa-tc', label: 'TC-101', vertical: 'QA', x: 275, y: 510, status: 'unverified' },
  ];

  const demoTraces: DemoTrace[] = [
    { from: 'des-s001', to: 'pm-us001' },
    { from: 'des-s002', to: 'pm-us001' },
    { from: 'dev-api', to: 'des-s001' },
    { from: 'dev-api', to: 'pm-us001' },
    { from: 'dev-adr', to: 'des-s002' },
    { from: 'qa-tc', to: 'dev-api' },
  ];

  let activeSignals: ActiveSignal[] = [];

  function getNode(id: string) { return demoNodes.find(n => n.id === id)!; }

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

  function statusColor(status: string): string {
    switch (status) {
      case 'proven': return cssVar('--proven');
      case 'suspect': return cssVar('--suspect');
      case 'broke': return cssVar('--broke');
      default: return cssVar('--unverified');
    }
  }

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

  function drawLoop() {
    const w = propCanvas!.width;
    const h = propCanvas!.height;
    pCtx.clearRect(0, 0, w, h);

    for (const t of demoTraces) {
      const from = getNode(t.from);
      const to = getNode(t.to);
      pCtx.strokeStyle = cssVar('--trace-active');
      pCtx.globalAlpha = 0.8;
      pCtx.lineWidth = 1.5;
      pCtx.beginPath();
      pCtx.moveTo(from.x, from.y);
      pCtx.lineTo(to.x, to.y);
      pCtx.stroke();
    }
    pCtx.globalAlpha = 1.0;

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

    for (const n of demoNodes) {
      const color = statusColor(n.status);

      // Fill & stroke
      pCtx.globalAlpha = 0.1;
      pCtx.fillStyle = color;
      drawOrganicCircle(n.x, n.y, 34);
      pCtx.fill();
      pCtx.globalAlpha = 1.0;
      pCtx.strokeStyle = color;
      pCtx.lineWidth = 2;
      drawOrganicCircle(n.x, n.y, 34);
      pCtx.stroke();

      // Glow for proven
      if (n.status === 'proven') {
        pCtx.shadowBlur = 18;
        pCtx.shadowColor = color;
        drawOrganicCircle(n.x, n.y, 34);
        pCtx.stroke();
        pCtx.shadowBlur = 0;
      }

      // Node label (e.g. US-001)
      pCtx.fillStyle = cssVar('--text-primary');
      pCtx.font = '500 13px "JetBrains Mono", monospace';
      pCtx.textAlign = 'center';
      pCtx.fillText(n.label, n.x, n.y - 6);

      // Vertical label (e.g. PM, Design)
      pCtx.fillStyle = cssVar('--text-secondary');
      pCtx.font = '400 10px "Space Grotesk", sans-serif';
      pCtx.fillText(n.vertical, n.x, n.y + 10);

      // Status label below node
      pCtx.fillStyle = cssVar('--text-secondary');
      pCtx.font = '500 11px "JetBrains Mono", monospace';
      pCtx.fillText(n.status, n.x, n.y + 54);
    }

    requestAnimationFrame(drawLoop);
  }

  drawLoop();

  const output = document.getElementById('demo-output')!;

  function runDemo(action: string) {
    if (action === 'reset') {
      demoNodes.forEach(n => n.status = 'unverified');
      activeSignals = [];
      output.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv node list --project clinic-checkin</span>\n<span class="out">ID        NAME              VERTICAL  OWNER\n0fb8353f  Dev Inventory     dev       cuong\nde061a81  PM Inventory      pm        duke\n5447c4b6  Design Inventory  design    may</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
      return;
    }

    if (action === 'verify') {
      demoNodes.forEach(n => n.status = 'proven');
      output.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv verify US-001 --evidence "Round 1 interview" --actor duke</span>\n<span class="out">Item 38ae34fd verified -> </span><span class="s-proven">proven</span>\n\n<span class="prompt">$</span> <span class="cmd">inv verify S-001 --evidence "Figma reviewed" --actor may</span>\n<span class="out">Item f5a14352 verified -> </span><span class="s-proven">proven</span>\n\n<span class="prompt">$</span> <span class="cmd">inv verify API-001 --evidence "Tests passing" --actor cuong</span>\n<span class="out">Item e8def515 verified -> </span><span class="s-proven">proven</span>\n\n<span class="out">All items </span><span class="s-proven">proven</span><span class="out"> across the network.</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
      return;
    }

    if (action === 'change') {
      getNode('pm-us001').status = 'proven';
      output.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv verify US-001 --evidence "Round 3: added mobile check-in" --actor duke</span>\n<span class="out">Item 38ae34fd verified -> </span><span class="s-proven">proven</span>\n<span class="out">Propagated signals through the network:</span>`;

      setTimeout(() => {
        activeSignals.push(createSandSignal('pm-us001', 'des-s001', () => { getNode('des-s001').status = 'suspect'; }));
        activeSignals.push(createSandSignal('pm-us001', 'des-s002', () => { getNode('des-s002').status = 'suspect'; }));
      }, 300);

      setTimeout(() => {
        output.innerHTML += `\n<span class="out">  -> S-001 in Design is now </span><span class="s-suspect">suspect</span>\n<span class="out">  -> S-002 in Design is now </span><span class="s-suspect">suspect</span>`;
        activeSignals.push(createSandSignal('des-s001', 'dev-api', () => { getNode('dev-api').status = 'suspect'; }));
        activeSignals.push(createSandSignal('des-s002', 'dev-adr', () => { getNode('dev-adr').status = 'suspect'; }));
      }, 1500);

      setTimeout(() => {
        output.innerHTML += `\n<span class="out">  -> API-001 in Dev is now </span><span class="s-suspect">suspect</span>\n<span class="out">  -> ADR-001 in Dev is now </span><span class="s-suspect">suspect</span>`;
        activeSignals.push(createSandSignal('dev-api', 'qa-tc', () => { getNode('qa-tc').status = 'suspect'; }));
      }, 2800);

      setTimeout(() => {
        output.innerHTML += `\n<span class="out">  -> TC-101 in QA is now </span><span class="s-suspect">suspect</span>\n\n<span class="out">5 items across 3 nodes became </span><span class="s-suspect">suspect</span><span class="out"> from 1 change.</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
      }, 4000);
      return;
    }

    if (action === 'reverify') {
      getNode('des-s001').status = 'proven';
      output.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv verify S-001 --evidence "Updated Figma for mobile" --actor may</span>\n<span class="out">Item re-verified -> </span><span class="s-proven">proven</span>`;

      setTimeout(() => { getNode('des-s002').status = 'proven'; output.innerHTML += `\n<span class="prompt">$</span> <span class="cmd">inv verify S-002 --evidence "Mobile screen added" --actor may</span>\n<span class="out">Item verified -> </span><span class="s-proven">proven</span>`; }, 800);
      setTimeout(() => { getNode('dev-api').status = 'proven'; output.innerHTML += `\n<span class="prompt">$</span> <span class="cmd">inv verify API-001 --evidence "Async endpoints tested" --actor cuong</span>\n<span class="out">Item verified -> </span><span class="s-proven">proven</span>`; }, 1600);
      setTimeout(() => {
        getNode('dev-adr').status = 'proven';
        getNode('qa-tc').status = 'proven';
        output.innerHTML += `\n<span class="prompt">$</span> <span class="cmd">inv verify ADR-001 --evidence "Updated for async" --actor cuong</span>\n<span class="out">Item verified -> </span><span class="s-proven">proven</span>\n<span class="prompt">$</span> <span class="cmd">inv verify TC-101 --evidence "New test suite passing" --actor qa-bot</span>\n<span class="out">Item verified -> </span><span class="s-proven">proven</span>\n\n<span class="out">All items re-verified. Network is fully </span><span class="s-proven">proven</span><span class="out">.</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
      }, 2400);
    }
  }

  const demoContainer = propCanvas.closest('.network-demo');
  if (demoContainer) {
    const allBtns = demoContainer.querySelectorAll<HTMLButtonElement>('.demo-btn[data-action]');
    allBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        allBtns.forEach(b => b.classList.remove('active'));
        if (btn.dataset.action !== 'reset') btn.classList.add('active');
        runDemo(btn.dataset.action!);
      });
    });
  }
}
