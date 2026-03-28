const BASE = "";

// ── Types ───────────────────────────────────────────────

export interface Metrics {
  connections_active: number;
  messages_routed: number;
  messages_enqueued: number;
  messages_cross_instance: number;
  drains_total: number;
  drain_messages_total: number;
}

export interface TokenInfo {
  id: string;
  nodeId: string;
  name: string;
  vertical: string;
  owner: string;
  projects: string[];
  createdAt: string;
}

export interface CreateTokenResponse {
  token: string;
  nodeId: string;
  id: string;
}

export interface ConnectedNode {
  nodeId: string;
  projects: string[];
  connectedAt: string;
  lastMessageAt: string | null;
}

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  meta?: Record<string, string>;
}

export interface RegisterResponse {
  token: string;
  nodeId: string;
  name: string;
  vertical: string;
  owner: string;
  project: string;
}

// ── Helpers ─────────────────────────────────────────────

function authHeaders(adminKey: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${adminKey}`,
  };
}

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

// ── Public API (no auth) ────────────────────────────────

export async function fetchPublicProjects(): Promise<string[]> {
  const res = await fetch(`${BASE}/api/project/public-list`);
  const data = await handleResponse<{ projects: string[] }>(res);
  return data.projects;
}

export async function registerNode(input: {
  project: string; nodeId: string; name: string; vertical: string; owner: string;
}): Promise<RegisterResponse> {
  const res = await fetch(`${BASE}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<RegisterResponse>(res);
}

// ── Admin API ───────────────────────────────────────────

export async function fetchMetrics(): Promise<Metrics> {
  const res = await fetch(`${BASE}/metrics`);
  return handleResponse<Metrics>(res);
}

export async function createProject(adminKey: string, project: string): Promise<void> {
  const res = await fetch(`${BASE}/api/project/create`, {
    method: "POST",
    headers: authHeaders(adminKey),
    body: JSON.stringify({ project }),
  });
  await handleResponse(res);
}

export async function listProjects(adminKey: string): Promise<string[]> {
  const res = await fetch(`${BASE}/api/project/list`, {
    headers: authHeaders(adminKey),
  });
  const data = await handleResponse<{ projects: string[] }>(res);
  return data.projects;
}

export async function removeProject(adminKey: string, projectName: string): Promise<void> {
  const res = await fetch(`${BASE}/api/project/${encodeURIComponent(projectName)}`, {
    method: "DELETE",
    headers: authHeaders(adminKey),
  });
  await handleResponse(res);
}

export async function createToken(
  adminKey: string,
  input: { nodeId: string; name: string; vertical: string; owner: string },
): Promise<CreateTokenResponse> {
  const res = await fetch(`${BASE}/api/token/create`, {
    method: "POST",
    headers: authHeaders(adminKey),
    body: JSON.stringify(input),
  });
  return handleResponse<CreateTokenResponse>(res);
}

export async function listAllTokens(adminKey: string): Promise<TokenInfo[]> {
  const res = await fetch(`${BASE}/api/token/list`, {
    headers: authHeaders(adminKey),
  });
  const data = await handleResponse<{ tokens: TokenInfo[] }>(res);
  return data.tokens;
}

export async function revokeToken(adminKey: string, secret: string): Promise<void> {
  const res = await fetch(`${BASE}/api/token/revoke`, {
    method: "POST",
    headers: authHeaders(adminKey),
    body: JSON.stringify({ token: secret }),
  });
  await handleResponse(res);
}

export async function removeNode(adminKey: string, projectName: string, nodeId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/node/${encodeURIComponent(projectName)}/${encodeURIComponent(nodeId)}`, {
    method: "DELETE",
    headers: authHeaders(adminKey),
  });
  await handleResponse(res);
}

export async function assignToken(adminKey: string, tokenId: string, project: string): Promise<void> {
  const res = await fetch(`${BASE}/api/token/assign`, {
    method: "POST",
    headers: authHeaders(adminKey),
    body: JSON.stringify({ tokenId, project }),
  });
  await handleResponse(res);
}

export async function unassignToken(adminKey: string, tokenId: string, project: string): Promise<void> {
  const res = await fetch(`${BASE}/api/token/unassign`, {
    method: "POST",
    headers: authHeaders(adminKey),
    body: JSON.stringify({ tokenId, project }),
  });
  await handleResponse(res);
}

export async function disconnectNode(adminKey: string, projectId: string, nodeId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/disconnect/${encodeURIComponent(projectId)}/${encodeURIComponent(nodeId)}`, {
    method: "POST",
    headers: authHeaders(adminKey),
  });
  await handleResponse(res);
}

export async function fetchNodes(adminKey: string): Promise<ConnectedNode[]> {
  const res = await fetch(`${BASE}/api/nodes`, {
    headers: authHeaders(adminKey),
  });
  const data = await handleResponse<{ nodes: ConnectedNode[] }>(res);
  return data.nodes;
}

export async function fetchLogs(adminKey: string): Promise<LogEntry[]> {
  const res = await fetch(`${BASE}/api/logs`, {
    headers: authHeaders(adminKey),
  });
  const data = await handleResponse<{ logs: LogEntry[] }>(res);
  return data.logs;
}
