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

interface ActiveSignal {
  from: string;
  to: string;
  progress: number;
  onArrive: (() => void) | null;
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

  function statusColor(status: string): string {
    switch (status) {
      case 'proven': return cssVar('--proven');
      case 'suspect': return cssVar('--suspect');
      case 'broke': return cssVar('--broke');
      default: return cssVar('--unverified');
    }
  }

  function drawLoop() {
    const w = propCanvas!.width;
    const h = propCanvas!.height;
    pCtx.clearRect(0, 0, w, h);

    for (const t of demoTraces) {
      const from = getNode(t.from);
      const to = getNode(t.to);
      pCtx.strokeStyle = cssVar('--trace-line');
      pCtx.globalAlpha = 0.5;
      pCtx.lineWidth = 1;
      pCtx.beginPath();
      pCtx.moveTo(from.x, from.y);
      pCtx.lineTo(to.x, to.y);
      pCtx.stroke();
    }
    pCtx.globalAlpha = 1.0;

    activeSignals = activeSignals.filter(s => s.progress < 1);
    for (const s of activeSignals) {
      const from = getNode(s.from);
      const to = getNode(s.to);
      s.progress += 0.015;
      const x = from.x + (to.x - from.x) * s.progress;
      const y = from.y + (to.y - from.y) * s.progress;

      pCtx.fillStyle = cssVar('--signal-pulse');
      pCtx.shadowBlur = 12;
      pCtx.shadowColor = cssVar('--signal-pulse');
      pCtx.beginPath();
      pCtx.arc(x, y, 5, 0, Math.PI * 2);
      pCtx.fill();
      pCtx.shadowBlur = 0;

      if (s.progress >= 1 && s.onArrive) {
        s.onArrive();
        s.onArrive = null;
      }
    }

    for (const n of demoNodes) {
      const color = statusColor(n.status);

      pCtx.fillStyle = color + '20';
      pCtx.strokeStyle = color;
      pCtx.lineWidth = 1.5;
      pCtx.beginPath();
      pCtx.arc(n.x, n.y, 28, 0, Math.PI * 2);
      pCtx.fill();
      pCtx.stroke();

      if (n.status === 'proven') {
        pCtx.shadowBlur = 15;
        pCtx.shadowColor = color;
        pCtx.beginPath();
        pCtx.arc(n.x, n.y, 28, 0, Math.PI * 2);
        pCtx.stroke();
        pCtx.shadowBlur = 0;
      }

      pCtx.fillStyle = color;
      pCtx.font = '500 11px "JetBrains Mono", monospace';
      pCtx.textAlign = 'center';
      pCtx.fillText(n.label, n.x, n.y - 4);

      pCtx.fillStyle = cssVar('--text-muted');
      pCtx.globalAlpha = 0.7;
      pCtx.font = '300 9px "Space Grotesk", sans-serif';
      pCtx.fillText(n.vertical, n.x, n.y + 10);
      pCtx.globalAlpha = 1.0;

      pCtx.fillStyle = color;
      pCtx.font = '300 8px "JetBrains Mono", monospace';
      pCtx.fillText(n.status, n.x, n.y + 42);
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
        activeSignals.push({ from: 'pm-us001', to: 'des-s001', progress: 0, onArrive: () => { getNode('des-s001').status = 'suspect'; } });
        activeSignals.push({ from: 'pm-us001', to: 'des-s002', progress: 0, onArrive: () => { getNode('des-s002').status = 'suspect'; } });
      }, 300);

      setTimeout(() => {
        output.innerHTML += `\n<span class="out">  -> S-001 in Design is now </span><span class="s-suspect">suspect</span>\n<span class="out">  -> S-002 in Design is now </span><span class="s-suspect">suspect</span>`;
        activeSignals.push({ from: 'des-s001', to: 'dev-api', progress: 0, onArrive: () => { getNode('dev-api').status = 'suspect'; } });
        activeSignals.push({ from: 'des-s002', to: 'dev-adr', progress: 0, onArrive: () => { getNode('dev-adr').status = 'suspect'; } });
      }, 1500);

      setTimeout(() => {
        output.innerHTML += `\n<span class="out">  -> API-001 in Dev is now </span><span class="s-suspect">suspect</span>\n<span class="out">  -> ADR-001 in Dev is now </span><span class="s-suspect">suspect</span>`;
        activeSignals.push({ from: 'dev-api', to: 'qa-tc', progress: 0, onArrive: () => { getNode('qa-tc').status = 'suspect'; } });
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

  document.querySelectorAll<HTMLButtonElement>('.demo-btn').forEach(btn => {
    btn.addEventListener('click', () => runDemo(btn.dataset.action!));
  });
}
