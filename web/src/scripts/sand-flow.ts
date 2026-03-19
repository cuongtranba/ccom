// ---------------------------------------------------------------------------
// Sand Flow — Dune-inspired turbulent sand stream system
// Perlin noise flow field drives particles into organic, curling streams.
// Scroll pumps energy into the field — still air becomes a sandstorm.
// ---------------------------------------------------------------------------

// ---- Perlin Noise ----

class PerlinNoise {
  private perm: number[];

  constructor() {
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    this.perm = [...p, ...p];
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }

  private grad(hash: number, x: number, y: number): number {
    const h = hash & 3;
    return ((h & 1) === 0 ? x : -x) + ((h & 2) === 0 ? y : -y);
  }

  noise2d(x: number, y: number): number {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    const u = this.fade(xf);
    const v = this.fade(yf);

    const aa = this.perm[this.perm[xi] + yi];
    const ab = this.perm[this.perm[xi] + yi + 1];
    const ba = this.perm[this.perm[xi + 1] + yi];
    const bb = this.perm[this.perm[xi + 1] + yi + 1];

    const x1 = this.lerp(this.grad(aa, xf, yf), this.grad(ba, xf - 1, yf), u);
    const x2 = this.lerp(this.grad(ab, xf, yf - 1), this.grad(bb, xf - 1, yf - 1), u);
    return this.lerp(x1, x2, v);
  }
}

// ---- Types ----

interface SandGrain {
  x: number;
  y: number;
  baseVx: number;
  vx: number;
  vy: number;
  r: number;
  opacity: number;
  trailLength: number;
  colorIdx: number;
}

interface LayerConfig {
  fraction: number;
  speed: number;
  baseOpacity: number;
  trailLen: number;
  sizeRange: [number, number];
  scrollReact: number;
}

interface SandLayer {
  grains: SandGrain[];
  config: LayerConfig;
}

// ---- Palette & Config ----

// Warm amber/gold — Dune desert tones
const SAND_PALETTE = [
  { r: 212, g: 180, b: 128 },
  { r: 198, g: 165, b: 110 },
  { r: 182, g: 150, b: 95 },
  { r: 170, g: 140, b: 88 },
];

// 4-layer parallax: back haze → front sharp grains
// Low opacities for "subtle at rest" — scroll boost makes them dramatic
const LAYER_CONFIGS: LayerConfig[] = [
  { fraction: 0.20, speed: 0.08, baseOpacity: 0.030, trailLen: 0, sizeRange: [3.0, 6.0], scrollReact: 0.25 },
  { fraction: 0.35, speed: 0.22, baseOpacity: 0.055, trailLen: 0, sizeRange: [1.5, 3.0], scrollReact: 0.55 },
  { fraction: 0.28, speed: 0.45, baseOpacity: 0.110, trailLen: 2, sizeRange: [0.8, 1.8], scrollReact: 0.90 },
  { fraction: 0.17, speed: 0.75, baseOpacity: 0.190, trailLen: 4, sizeRange: [0.5, 1.2], scrollReact: 1.30 },
];

// Flow field scale: lower = larger coherent streams
const FIELD_SCALE = 0.002;

// ---- Helpers ----

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function createGrain(w: number, h: number, cfg: LayerConfig): SandGrain {
  const baseVx = cfg.speed + cfg.speed * (Math.random() * 0.6 - 0.3);
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    baseVx,
    vx: baseVx,
    vy: 0,
    r: randomBetween(cfg.sizeRange[0], cfg.sizeRange[1]),
    opacity: cfg.baseOpacity * randomBetween(0.7, 1.3),
    trailLength: cfg.trailLen > 0 ? randomBetween(cfg.trailLen - 1, cfg.trailLen + 2) : 0,
    colorIdx: Math.floor(Math.random() * SAND_PALETTE.length),
  };
}

function createLayers(w: number, h: number): SandLayer[] {
  const totalCount = Math.min(Math.floor((w * h) / 4500), 600);
  return LAYER_CONFIGS.map(cfg => ({
    grains: Array.from({ length: Math.floor(totalCount * cfg.fraction) }, () => createGrain(w, h, cfg)),
    config: cfg,
  }));
}

// ---- Main ----

const canvas = document.getElementById('network-canvas') as HTMLCanvasElement;
if (canvas) {
  const ctx = canvas.getContext('2d')!;
  const noise = new PerlinNoise();
  let layers: SandLayer[] = [];

  // Scroll velocity tracking
  let lastScrollY = window.scrollY;
  let scrollDelta = 0;
  let smoothScrollV = 0;

  window.addEventListener('scroll', () => {
    scrollDelta = window.scrollY - lastScrollY;
    lastScrollY = window.scrollY;
  }, { passive: true });

  // Reduced motion
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function resize(): void {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    layers = createLayers(canvas.width, canvas.height);
  }

  function draw(): void {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const time = performance.now() * 0.001;

    // Smooth scroll velocity with exponential decay
    smoothScrollV += (scrollDelta - smoothScrollV) * 0.08;
    scrollDelta *= 0.92;

    // Scroll intensity 0→1 (clamped)
    const scrollIntensity = Math.min(Math.abs(smoothScrollV) / 20, 1.0);

    // Dynamic opacity: subtle at rest, dramatic when scrolling
    const opacityBoost = 1.0 + scrollIntensity * 3.0;

    // Noise field time offset — evolves slowly, advances faster on scroll
    const timeOffset = time * 0.06;

    // Ambient wind gust (organic even without scroll)
    const gust = Math.sin(time * 0.25) * 0.25 + Math.sin(time * 0.67) * 0.15;

    for (const layer of layers) {
      const { config, grains } = layer;

      // Flow field strength: gentle curves at rest, strong turbulence on scroll
      const fieldStrength = 0.25 + scrollIntensity * 2.2;

      for (const grain of grains) {
        // ---- Sample noise flow field ----
        const gx = grain.x * FIELD_SCALE;
        const gy = grain.y * FIELD_SCALE;

        // Base: large-scale smooth flow (coherent streams)
        const baseN = noise.noise2d(gx + timeOffset, gy + timeOffset * 0.7);
        // Turbulence: high-frequency detail (mixed in on scroll)
        const turbN = noise.noise2d(gx * 3.5 + timeOffset * 1.5, gy * 3.5 + timeOffset);

        const combined = baseN + turbN * scrollIntensity * 0.5;
        const angle = combined * Math.PI * 2;

        // ---- Velocity ----
        const fieldVx = Math.cos(angle) * fieldStrength * config.scrollReact;
        const fieldVy = Math.sin(angle) * fieldStrength * config.scrollReact;

        // Scroll push: sand flies upward when scrolling down
        const scrollPush = -smoothScrollV * config.scrollReact * 0.04;

        // Ambient gust
        const gustForce = gust * config.scrollReact * 0.06;

        // Rightward drift fades when field takes over
        const driftBlend = 1.0 - scrollIntensity * 0.6;

        grain.vx = grain.baseVx * driftBlend + fieldVx + gustForce;
        grain.vy = fieldVy + scrollPush;

        grain.x += grain.vx;
        grain.y += grain.vy;

        // ---- Wrap ----
        if (grain.x > w + 10) { grain.x = -10; grain.y = Math.random() * h; }
        else if (grain.x < -10) { grain.x = w + 10; grain.y = Math.random() * h; }
        if (grain.y < -10) grain.y = h + 10;
        else if (grain.y > h + 10) grain.y = -10;

        // ---- Draw ----
        const color = SAND_PALETTE[grain.colorIdx];
        const dynOpacity = Math.min(grain.opacity * opacityBoost, 0.65);

        const speed = Math.sqrt(grain.vx * grain.vx + grain.vy * grain.vy);
        const dynamicTrail = grain.trailLength + speed * 2.5;

        // Trail: follows velocity direction (curves with the flow field)
        if (dynamicTrail > 0.5 && speed > 0.1) {
          const nx = -grain.vx / speed;
          const ny = -grain.vy / speed;
          const tx = grain.x + nx * dynamicTrail;
          const ty = grain.y + ny * dynamicTrail;

          const grad = ctx.createLinearGradient(tx, ty, grain.x, grain.y);
          grad.addColorStop(0, `rgba(${color.r},${color.g},${color.b},0)`);
          grad.addColorStop(1, `rgba(${color.r},${color.g},${color.b},${dynOpacity})`);
          ctx.strokeStyle = grad;
          ctx.lineWidth = grain.r * 1.8;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(grain.x, grain.y);
          ctx.stroke();
        }

        // Grain circle
        ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${dynOpacity})`;
        ctx.beginPath();
        ctx.arc(grain.x, grain.y, grain.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (!prefersReducedMotion.matches) {
      requestAnimationFrame(draw);
    }
  }

  window.addEventListener('resize', resize);
  resize();

  if (prefersReducedMotion.matches) {
    draw(); // single static frame
  } else {
    draw();
  }
}
