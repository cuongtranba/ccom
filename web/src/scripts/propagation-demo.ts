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

interface DemoNode {
  id: string;
  label: string;
  vertical: string;
  x: number;
  y: number;
  status: string;
  prevStatus: string;
  pulse: number;
}

interface DemoTrace {
  from: string;
  to: string;
}

const propCanvas = document.getElementById('propagation-viz') as HTMLCanvasElement | null;
if (propCanvas) {
  const pCtx = propCanvas.getContext('2d')!;
  const cssVar = createCssVarReader();

  const demoNodes: DemoNode[] = [
    { id: 'pm-us001', label: 'US-001', vertical: 'PM', x: 275, y: 60, status: 'unverified', prevStatus: 'unverified', pulse: 0 },
    { id: 'des-s001', label: 'S-001', vertical: 'Design', x: 120, y: 220, status: 'unverified', prevStatus: 'unverified', pulse: 0 },
    { id: 'des-s002', label: 'S-002', vertical: 'Design', x: 430, y: 220, status: 'unverified', prevStatus: 'unverified', pulse: 0 },
    { id: 'dev-api', label: 'API-001', vertical: 'Dev', x: 160, y: 400, status: 'unverified', prevStatus: 'unverified', pulse: 0 },
    { id: 'dev-adr', label: 'ADR-001', vertical: 'Dev', x: 390, y: 400, status: 'unverified', prevStatus: 'unverified', pulse: 0 },
    { id: 'qa-tc', label: 'TC-101', vertical: 'QA', x: 275, y: 510, status: 'unverified', prevStatus: 'unverified', pulse: 0 },
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

  // Node dimensions matching StateMachine's rounded-rectangle style
  const NODE_W = 88;
  const NODE_H = 40;
  const NODE_R = 6;

  function drawNodeRect(cx: number, cy: number): void {
    pCtx.beginPath();
    pCtx.roundRect(cx - NODE_W / 2, cy - NODE_H / 2, NODE_W, NODE_H, NODE_R);
  }

  const { getHoveredId, hoverScales } = setupCanvasHover(propCanvas, demoNodes, NODE_W, NODE_H);

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

    activeSignals = renderSignals(pCtx, activeSignals, id => getNode(id), cssVar('--signal-pulse'));

    for (const n of demoNodes) {
      // State change pulse
      if (n.status !== n.prevStatus) {
        n.pulse = 1.0;
        n.prevStatus = n.status;
      }
      if (n.pulse > 0) n.pulse = Math.max(0, n.pulse - 0.03);

      const scale = calcSmoothScale(n.id, n.id === getHoveredId(), n.pulse, hoverScales);

      if (Math.abs(scale - 1.0) > 0.001) {
        pCtx.save();
        pCtx.translate(n.x, n.y);
        pCtx.scale(scale, scale);
        pCtx.translate(-n.x, -n.y);
      }

      const color = resolveStatusColor(cssVar, n.status);

      // Background: bg-surface base + status color overlay (replicates color-mix)
      pCtx.fillStyle = cssVar('--bg-surface');
      drawNodeRect(n.x, n.y);
      pCtx.fill();

      pCtx.globalAlpha = 0.15;
      pCtx.fillStyle = color;
      drawNodeRect(n.x, n.y);
      pCtx.fill();
      pCtx.globalAlpha = 1.0;

      // Border — 1.5px matching StateMachine
      pCtx.strokeStyle = color;
      pCtx.lineWidth = 1.5;
      drawNodeRect(n.x, n.y);
      pCtx.stroke();

      // Proven glow using --proven-glow token
      if (n.status === 'proven') {
        pCtx.shadowBlur = 25;
        pCtx.shadowColor = cssVar('--proven-glow');
        drawNodeRect(n.x, n.y);
        pCtx.stroke();
        pCtx.shadowBlur = 0;
      }

      // Label — status color to match StateMachine
      pCtx.fillStyle = color;
      pCtx.font = '500 14px "JetBrains Mono", monospace';
      pCtx.textAlign = 'center';
      pCtx.textBaseline = 'middle';
      pCtx.fillText(n.label, n.x, n.y);

      // Vertical label above node
      pCtx.textBaseline = 'alphabetic';
      pCtx.fillStyle = cssVar('--text-muted');
      pCtx.font = '500 11px "JetBrains Mono", monospace';
      pCtx.fillText(n.vertical, n.x, n.y - NODE_H / 2 - 8);

      // Status label below node
      pCtx.fillStyle = color;
      pCtx.font = '500 11px "JetBrains Mono", monospace';
      pCtx.fillText(n.status, n.x, n.y + NODE_H / 2 + 16);

      if (Math.abs(scale - 1.0) > 0.001) {
        pCtx.restore();
      }
    }

    requestAnimationFrame(drawLoop);
  }

  drawLoop();

  const output = document.getElementById('demo-output')!;

  function runDemo(action: string) {
    if (action === 'reset') {
      demoNodes.forEach(n => { n.status = 'unverified'; n.prevStatus = 'unverified'; n.pulse = 0; });
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
    setupDemoButtons(demoContainer, '.demo-btn[data-action]', 'action', runDemo);
  }
}
