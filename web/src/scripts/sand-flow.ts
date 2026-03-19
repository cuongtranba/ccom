interface SandGrain {
  x: number;
  y: number;
  vx: number;
  vy: number;
  vyPhase: number;   // phase offset for sine-wave vertical drift
  vyAmp: number;     // amplitude of vertical drift (0.5-2.0)
  r: number;         // radius
  opacity: number;   // per-grain opacity variation
  trailLength: number; // horizontal trail length (0 for back/mid, 2-4px for front)
}

interface SandLayer {
  grains: SandGrain[];
  speed: number;
  baseOpacity: number;
  trailLen: number;
  sizeRange: [number, number];
}

const SAND_R = 194;
const SAND_G = 168;
const SAND_B = 120;

const LAYER_CONFIGS = [
  { fraction: 0.30, speed: 0.15, baseOpacity: 0.12, trailLen: 0, sizeRange: [2.0, 3.5] as [number, number] },
  { fraction: 0.45, speed: 0.4,  baseOpacity: 0.20, trailLen: 0, sizeRange: [1.2, 2.2] as [number, number] },
  { fraction: 0.25, speed: 0.8,  baseOpacity: 0.30, trailLen: 3, sizeRange: [0.8, 1.5] as [number, number] },
];

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function createGrain(
  width: number,
  height: number,
  speed: number,
  baseOpacity: number,
  trailLen: number,
  sizeRange: [number, number],
): SandGrain {
  const vx = speed + speed * (Math.random() * 0.6 - 0.3); // +-30% variation
  return {
    x: Math.random() * width,
    y: Math.random() * height,
    vx,
    vy: 0,
    vyPhase: Math.random() * Math.PI * 2,
    vyAmp: randomBetween(0.5, 2.0),
    r: randomBetween(sizeRange[0], sizeRange[1]),
    opacity: baseOpacity * randomBetween(0.7, 1.3),
    trailLength: trailLen > 0 ? randomBetween(2, 4) : 0,
  };
}

function createLayers(width: number, height: number): SandLayer[] {
  const totalCount = Math.floor((width * height) / 20000);

  return LAYER_CONFIGS.map((cfg) => {
    const count = Math.floor(totalCount * cfg.fraction);
    const grains: SandGrain[] = Array.from({ length: count }, () =>
      createGrain(width, height, cfg.speed, cfg.baseOpacity, cfg.trailLen, cfg.sizeRange),
    );
    return {
      grains,
      speed: cfg.speed,
      baseOpacity: cfg.baseOpacity,
      trailLen: cfg.trailLen,
      sizeRange: cfg.sizeRange,
    };
  });
}

const canvas = document.getElementById('network-canvas') as HTMLCanvasElement;
if (canvas) {
  const ctx = canvas.getContext('2d')!;
  let layers: SandLayer[] = [];

  function resize(): void {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    layers = createLayers(canvas.width, canvas.height);
  }

  function draw(): void {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const w = canvas.width;
    const h = canvas.height;

    for (const layer of layers) {
      for (const grain of layer.grains) {
        // Update position
        grain.vyPhase += 0.008;
        grain.vy = Math.sin(grain.vyPhase) * grain.vyAmp * 0.1;
        grain.x += grain.vx;
        grain.y += grain.vy;

        // Wrap horizontally
        if (grain.x > w + 10) {
          grain.x = -10;
          grain.y = Math.random() * h;
        }

        // Wrap vertically
        if (grain.y < -10) {
          grain.y = h + 10;
        } else if (grain.y > h + 10) {
          grain.y = -10;
        }

        // Draw trail for front-layer grains
        if (grain.trailLength > 0) {
          const gradient = ctx.createLinearGradient(
            grain.x - grain.trailLength, grain.y,
            grain.x, grain.y,
          );
          gradient.addColorStop(0, `rgba(${SAND_R}, ${SAND_G}, ${SAND_B}, 0)`);
          gradient.addColorStop(1, `rgba(${SAND_R}, ${SAND_G}, ${SAND_B}, ${grain.opacity})`);
          ctx.strokeStyle = gradient;
          ctx.lineWidth = grain.r * 2;
          ctx.beginPath();
          ctx.moveTo(grain.x - grain.trailLength, grain.y);
          ctx.lineTo(grain.x, grain.y);
          ctx.stroke();
        }

        // Draw grain circle
        ctx.fillStyle = `rgba(${SAND_R}, ${SAND_G}, ${SAND_B}, ${grain.opacity})`;
        ctx.beginPath();
        ctx.arc(grain.x, grain.y, grain.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  draw();
}
