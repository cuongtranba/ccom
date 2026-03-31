// Initializes asciinema-player instances from data attributes on .cast-player elements.
// The player JS + CSS are loaded from CDN on first intersection (lazy).

const PLAYER_JS = 'https://cdn.jsdelivr.net/npm/asciinema-player@3.9.0/dist/bundle/asciinema-player.min.js';
const PLAYER_CSS = 'https://cdn.jsdelivr.net/npm/asciinema-player@3.9.0/dist/bundle/asciinema-player.css';

let loaded = false;
let loadPromise: Promise<void> | null = null;

export function loadPlayerAssets(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = PLAYER_CSS;
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = PLAYER_JS;
    script.onload = () => {
      loaded = true;
      resolve();
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

export function initPlayer(el: HTMLElement): void {
  const container = el.querySelector('.cast-container') as HTMLElement;
  if (!container || container.children.length > 0) return;

  const src = el.dataset.src ?? '';
  const rows = Number(el.dataset.rows ?? 32);
  const cols = Number(el.dataset.cols ?? 92);
  const speed = Number(el.dataset.speed ?? 1.5);
  const loop = el.dataset.loop === 'true';
  const autoplay = el.dataset.autoplay === 'true';
  const idleTimeLimit = Number(el.dataset.idleTimeLimit ?? 2);
  const fit = el.dataset.fit ?? 'width';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const AsciinemaPlayer = (window as any).AsciinemaPlayer;
  if (!AsciinemaPlayer) return;

  AsciinemaPlayer.create(src, container, {
    rows,
    cols,
    speed,
    loop,
    autoPlay: autoplay,
    idleTimeLimit,
    fit,
    theme: 'asciinema',
    terminalFontFamily: "'JetBrains Mono', monospace",
    terminalFontSize: '13px',
  });
}

// Observe all .cast-player elements — load assets & init on first visibility
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        observer.unobserve(entry.target);
        loadPlayerAssets().then(() => initPlayer(entry.target as HTMLElement));
      }
    }
  },
  { rootMargin: '200px' },
);

document.querySelectorAll<HTMLElement>('.cast-player').forEach((el) => {
  observer.observe(el);
});
