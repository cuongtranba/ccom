// ---- Shared types for sand particle signal system ----

export interface SandParticle {
  progress: number;
  speed: number;
  offsetX: number;
  offsetY: number;
  size: number;
  opacity: number;
}

export interface ActiveSignal {
  from: string;
  to: string;
  particles: SandParticle[];
  done: boolean;
  onArrive: (() => void) | null;
  arrived: boolean;
}

interface Positioned {
  x: number;
  y: number;
}

// ---- CSS variable reader ----

export function createCssVarReader(): (name: string) => string {
  const rootStyles = getComputedStyle(document.documentElement);
  return (name: string) => rootStyles.getPropertyValue(name).trim();
}

// ---- Status color resolver ----

export function resolveStatusColor(
  cssVar: (name: string) => string,
  status: string,
): string {
  switch (status) {
    case 'proven': return cssVar('--proven');
    case 'suspect': return cssVar('--suspect');
    case 'broke': return cssVar('--broke');
    default: return cssVar('--unverified');
  }
}

// ---- Sand signal factory ----

export function createSandSignal(
  from: string,
  to: string,
  onArrive: (() => void) | null,
  particleCount: number = 10,
): ActiveSignal {
  const particles: SandParticle[] = Array.from({ length: particleCount }, () => ({
    progress: -(Math.random() * 0.2),
    speed: 0.006 + (Math.random() - 0.5) * 0.002,
    offsetX: (Math.random() - 0.5) * 6,
    offsetY: (Math.random() - 0.5) * 6,
    size: 1.5 + Math.random() * 1.5,
    opacity: 0.6 + Math.random() * 0.4,
  }));
  return { from, to, particles, done: false, onArrive, arrived: false };
}

// ---- Signal renderer (draws sand particles between positioned nodes) ----

export function renderSignals(
  ctx: CanvasRenderingContext2D,
  signals: ActiveSignal[],
  getPosition: (id: string) => Positioned,
  signalColor: string,
): ActiveSignal[] {
  const active = signals.filter(s => !s.done);

  for (const s of active) {
    const from = getPosition(s.from);
    const to = getPosition(s.to);
    let allDone = true;

    for (const p of s.particles) {
      p.progress += p.speed;
      if (p.progress < 0 || p.progress > 1) {
        if (p.progress < 1) allDone = false;
        continue;
      }
      allDone = false;

      const x = from.x + (to.x - from.x) * p.progress + p.offsetX;
      const y = from.y + (to.y - from.y) * p.progress + p.offsetY;

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

  return active;
}

// ---- Canvas hover tracking ----

export function setupCanvasHover<T extends Positioned & { id: string }>(
  canvas: HTMLCanvasElement,
  items: T[],
  hitWidth: number,
  hitHeight: number,
  drawingSize?: { w: number; h: number },
): { getHoveredId: () => string | null; hoverScales: Map<string, number> } {
  let hoveredId: string | null = null;
  const hoverScales = new Map<string, number>();

  canvas.addEventListener('pointermove', (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const coordW = drawingSize?.w ?? canvas.width;
    const coordH = drawingSize?.h ?? canvas.height;
    const mx = (e.clientX - rect.left) / rect.width * coordW;
    const my = (e.clientY - rect.top) / rect.height * coordH;

    hoveredId = null;
    for (const item of items) {
      if (mx >= item.x - hitWidth / 2 && mx <= item.x + hitWidth / 2 &&
          my >= item.y - hitHeight / 2 && my <= item.y + hitHeight / 2) {
        hoveredId = item.id;
        break;
      }
    }
    canvas.style.cursor = hoveredId ? 'pointer' : 'default';
  });

  canvas.addEventListener('pointerleave', () => {
    hoveredId = null;
    canvas.style.cursor = 'default';
  });

  return { getHoveredId: () => hoveredId, hoverScales };
}

// ---- Smooth scale calculation (hover + pulse) ----

export function calcSmoothScale(
  id: string,
  isHovered: boolean,
  pulse: number,
  hoverScales: Map<string, number>,
): number {
  const hoverTarget = isHovered ? 1.08 : 1.0;
  const currentHover = hoverScales.get(id) ?? 1.0;
  const smoothHover = currentHover + (hoverTarget - currentHover) * 0.15;
  hoverScales.set(id, smoothHover);
  const pulseScale = 1.0 + pulse * 0.15;
  return Math.max(smoothHover, pulseScale);
}

// ---- Demo button active-toggle setup ----

export function setupDemoButtons(
  scope: Element | Document,
  selector: string,
  dataAttr: string,
  handler: (action: string) => void,
  resetValue: string = 'reset',
): void {
  const btns = scope.querySelectorAll<HTMLButtonElement>(selector);
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      const value = btn.dataset[dataAttr]!;
      if (value !== resetValue) btn.classList.add('active');
      handler(value);
    });
  });
}
