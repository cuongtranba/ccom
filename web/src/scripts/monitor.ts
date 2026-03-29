// ---- Monitor Dashboard ----
// Polls the inv CLI for live data and renders the monitoring UI

const POLL_INTERVAL = 5_000;
const API_BASE = 'http://localhost:8080';

// ---- DOM helpers ----

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function setText(id: string, text: string | number): void {
  const el = $(id);
  if (el) el.textContent = String(text);
}

// ---- Clock ----

function updateClock(): void {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  setText('header-time', `${h}:${m}:${s}`);
}
setInterval(updateClock, 1000);
updateClock();

// ---- State ----

interface NodeConfig {
  name: string;
  vertical: string;
  project: string;
  owner: string;
  id: string;
  mode: string;
}

interface PeerInfo {
  peer_id: string;
  name: string;
  vertical: string;
  status: string;
  owner: string;
  reputation: number;
}

interface AuditReport {
  proven: number;
  unverified: number;
  suspect: number;
  broke: number;
  orphans: number;
  total: number;
}

interface ActivityEvent {
  id: string;
  type: string;
  summary: string;
  timestamp: string;
}

interface NetworkStatus {
  peers: number;
  outbox_depth: number;
  active_proposals: number;
  active_challenges: number;
}

let config: NodeConfig | null = null;
let activityEvents: ActivityEvent[] = [];

// ---- Simulated data for demo mode (when no API available) ----

function getDemoConfig(): NodeConfig {
  return {
    name: 'phong-node',
    vertical: 'dev',
    project: 'my-inventory',
    owner: 'phong',
    id: '439d8306-4931-4533-bf40-92bbf618a23e',
    mode: 'normal',
  };
}

function getDemoPeers(): PeerInfo[] {
  return [
    { peer_id: '12D3KooWKMo2', name: 'cuong-node', vertical: 'pm', status: 'approved', owner: 'cuong', reputation: 3 },
    { peer_id: '12D3KooWAAhu', name: 'blue-node', vertical: 'qa', status: 'approved', owner: 'blue', reputation: 1 },
    { peer_id: '12D3KooWBBcd', name: 'duke-node', vertical: 'design', status: 'approved', owner: 'duke', reputation: 2 },
  ];
}

function getDemoAudit(): AuditReport {
  return { proven: 8, unverified: 3, suspect: 1, broke: 0, orphans: 1, total: 12 };
}

function getDemoNetworkStatus(): NetworkStatus {
  return { peers: 3, outbox_depth: 0, active_proposals: 1, active_challenges: 0 };
}

function getDemoActivity(): ActivityEvent[] {
  return [
    { id: '1', type: 'verify', summary: 'P2P Handshake Protocol verified by phong', timestamp: new Date().toISOString() },
    { id: '2', type: 'signal', summary: 'Signal propagated: API Spec → Test Plan', timestamp: new Date(Date.now() - 60000).toISOString() },
    { id: '3', type: 'peer_join', summary: 'cuong-node joined the network', timestamp: new Date(Date.now() - 120000).toISOString() },
    { id: '4', type: 'proposal', summary: 'CR: Switch to WebSocket hub', timestamp: new Date(Date.now() - 300000).toISOString() },
    { id: '5', type: 'challenge', summary: 'Stale data challenge on US-003', timestamp: new Date(Date.now() - 600000).toISOString() },
  ];
}

// ---- Fetch helpers ----

async function fetchJSON<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ---- Render functions ----

function renderConfig(cfg: NodeConfig): void {
  setText('node-name', cfg.name);
  setText('node-owner', cfg.owner);
  setText('node-id', cfg.id.length > 16 ? cfg.id.slice(0, 16) + '...' : cfg.id);
  setText('node-mode', cfg.mode);

  const verticalEl = $('node-vertical');
  verticalEl.textContent = cfg.vertical.toUpperCase();

  const projectEl = $('node-project');
  projectEl.textContent = cfg.project;
}

function renderPeers(peers: PeerInfo[]): void {
  const list = $('peers-list');
  if (peers.length === 0) {
    list.innerHTML = '<div class="empty-state">No peers connected</div>';
    return;
  }

  list.innerHTML = peers.map(p => {
    const repColor = p.reputation >= 0 ? 'var(--proven)' : 'var(--broke)';
    const repSign = p.reputation >= 0 ? '+' : '';
    const statusDot = p.status === 'approved' ? 'dot-proven' : p.status === 'pending' ? 'dot-suspect' : 'dot-broke';
    return `
      <div class="peer-row">
        <span class="dot ${statusDot}" style="animation: connPulse 2s ease-in-out infinite;"></span>
        <div class="peer-info">
          <span class="peer-name">${p.name}</span>
          <span class="peer-meta">${p.vertical} · ${p.owner}</span>
        </div>
        <span class="peer-rep" style="color:${repColor}">${repSign}${p.reputation}</span>
      </div>`;
  }).join('');
}

function renderAudit(audit: AuditReport): void {
  setText('a-proven', audit.proven);
  setText('a-unverified', audit.unverified);
  setText('a-suspect', audit.suspect);
  setText('a-broke', audit.broke);
  setText('a-orphans', audit.orphans);

  const total = audit.total || 1;
  const healthPct = Math.round((audit.proven / total) * 100);
  setText('audit-score', `${healthPct}%`);

  // Animate ring
  const circumference = 2 * Math.PI * 52; // r=52
  const offset = circumference - (healthPct / 100) * circumference;
  const ring = $('audit-ring-fill') as unknown as SVGCircleElement;
  ring.style.strokeDashoffset = String(offset);

  // Color based on health
  if (healthPct >= 80) {
    ring.style.stroke = 'var(--proven)';
  } else if (healthPct >= 50) {
    ring.style.stroke = 'var(--suspect)';
  } else {
    ring.style.stroke = 'var(--broke)';
  }
}

function renderVitals(peers: number, items: number, traces: number, outbox: number): void {
  animateValue('v-peers', peers);
  animateValue('v-items', items);
  animateValue('v-traces', traces);
  animateValue('v-outbox', outbox);

  const maxPeers = Math.max(peers, 10);
  const maxItems = Math.max(items, 20);
  const maxTraces = Math.max(traces, 20);
  const maxOutbox = Math.max(outbox, 50);

  ($('v-peers-bar') as HTMLElement).style.width = `${(peers / maxPeers) * 100}%`;
  ($('v-items-bar') as HTMLElement).style.width = `${(items / maxItems) * 100}%`;
  ($('v-traces-bar') as HTMLElement).style.width = `${(traces / maxTraces) * 100}%`;
  ($('v-outbox-bar') as HTMLElement).style.width = `${(outbox / maxOutbox) * 100}%`;
}

function animateValue(id: string, target: number): void {
  const el = $(id);
  const current = parseInt(el.textContent || '0', 10);
  if (current === target) return;

  const duration = 600;
  const start = performance.now();

  function step(now: number): void {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const value = Math.round(current + (target - current) * eased);
    el.textContent = String(value);
    if (progress < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

function renderActivity(events: ActivityEvent[]): void {
  const feed = $('activity-feed');
  if (events.length === 0) {
    feed.innerHTML = '<div class="empty-state">No recent activity</div>';
    return;
  }

  const badge = $('activity-count');
  badge.textContent = String(events.length);
  badge.style.display = events.length > 0 ? '' : 'none';

  feed.innerHTML = events.map((e, i) => {
    const icon = getEventIcon(e.type);
    const timeAgo = formatTimeAgo(e.timestamp);
    const delay = i * 0.05;
    return `
      <div class="activity-row" style="animation: activitySlideIn 0.4s ease-out ${delay}s both;">
        <span class="activity-icon">${icon}</span>
        <span class="activity-text">${e.summary}</span>
        <span class="activity-time">${timeAgo}</span>
      </div>`;
  }).join('');
}

function renderGovernance(proposals: number, challenges: number, reputation: number): void {
  setText('g-proposals', proposals);
  setText('g-challenges', challenges);
  setText('g-reputation', `${reputation >= 0 ? '+' : ''}${reputation}`);
}

// ---- Helpers ----

function getEventIcon(type: string): string {
  switch (type) {
    case 'verify': return '&#9673;';
    case 'signal': return '&#9656;';
    case 'peer_join': return '&#9672;';
    case 'proposal': return '&#9671;';
    case 'challenge': return '&#9670;';
    case 'query': return '&#63;';
    default: return '&#9679;';
  }
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function setConnectionStatus(status: 'online' | 'offline' | 'connecting'): void {
  const el = $('conn-status');
  el.className = `connection-status ${status}`;
  const label = el.querySelector('.conn-label')!;
  switch (status) {
    case 'online': label.textContent = 'Connected'; break;
    case 'offline': label.textContent = 'Offline'; break;
    case 'connecting': label.textContent = 'Connecting...'; break;
  }
}

// ---- Inject dynamic styles ----

const style = document.createElement('style');
style.textContent = `
  .peer-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.6rem;
    border-radius: 6px;
    transition: background 0.2s;
  }
  .peer-row:hover { background: oklch(0.20 0.02 65 / 0.5); }
  .peer-info { flex: 1; display: flex; flex-direction: column; }
  .peer-name { font-size: 0.85rem; color: var(--text-primary); font-weight: 500; }
  .peer-meta { font-size: 0.7rem; color: var(--text-muted); font-family: var(--font-mono); }
  .peer-rep { font-family: var(--font-mono); font-size: 0.8rem; font-weight: 600; }

  .activity-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.4rem 0.6rem;
    border-radius: 6px;
    font-size: 0.8rem;
    border-left: 2px solid var(--border-subtle);
    transition: border-color 0.3s, background 0.2s;
  }
  .activity-row:hover {
    background: oklch(0.20 0.02 65 / 0.5);
    border-left-color: var(--proven);
  }
  .activity-icon { color: var(--proven); font-size: 0.7rem; flex-shrink: 0; }
  .activity-text { flex: 1; color: var(--text-secondary); }
  .activity-time {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  @keyframes activitySlideIn {
    from { opacity: 0; transform: translateX(-8px); }
    to { opacity: 1; transform: translateX(0); }
  }

  .gov-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.6rem;
    border-radius: 6px;
    font-size: 0.8rem;
    color: var(--text-secondary);
    border-left: 2px solid var(--suspect);
  }
  .gov-item-type {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    color: var(--text-muted);
    text-transform: uppercase;
  }
`;
document.head.appendChild(style);

// ---- Poll loop ----

async function poll(): Promise<void> {
  // Try API first, fall back to demo data
  const apiConfig = await fetchJSON<NodeConfig>('/api/node');

  if (apiConfig) {
    config = apiConfig;
    setConnectionStatus('online');

    renderConfig(config);

    const peers = await fetchJSON<PeerInfo[]>('/api/peers') || [];
    renderPeers(peers);

    const audit = await fetchJSON<AuditReport>('/api/audit') || { proven: 0, unverified: 0, suspect: 0, broke: 0, orphans: 0, total: 0 };
    renderAudit(audit);

    const status = await fetchJSON<NetworkStatus>('/api/network') || { peers: 0, outbox_depth: 0, active_proposals: 0, active_challenges: 0 };
    renderVitals(status.peers, audit.total, 0, status.outbox_depth);
    renderGovernance(status.active_proposals, status.active_challenges, 0);

    const events = await fetchJSON<ActivityEvent[]>('/api/events') || [];
    activityEvents = events;
    renderActivity(activityEvents);
  } else {
    // Demo mode — show rich UI with sample data
    setConnectionStatus('online');
    config = getDemoConfig();
    renderConfig(config);
    renderPeers(getDemoPeers());

    const audit = getDemoAudit();
    renderAudit(audit);
    renderVitals(3, audit.total, 8, 0);
    renderGovernance(1, 0, 3);
    renderActivity(getDemoActivity());
  }
}

// Initial load
poll();
setInterval(poll, POLL_INTERVAL);
