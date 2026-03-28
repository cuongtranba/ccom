export interface Metrics {
  connections_active: number;
  messages_routed: number;
  messages_enqueued: number;
  messages_cross_instance: number;
  drains_total: number;
  drain_messages_total: number;
}

export interface TokenInfo {
  projectId: string;
  nodeId: string;
  createdAt: string;
}

export interface CreateTokenResponse {
  token: string;
  project: string;
  nodeId: string;
}

export interface ConnectedNode {
  nodeId: string;
  project: string;
  connectedAt: string;
  lastMessageAt: string | null;
}

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  meta?: Record<string, string>;
}

function authHeaders(adminKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${adminKey}`,
    "Content-Type": "application/json",
  };
}

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export async function fetchMetrics(): Promise<Metrics> {
  const res = await fetch("/metrics");
  return handleResponse<Metrics>(res);
}

export async function createToken(
  adminKey: string,
  project: string,
  nodeId: string,
): Promise<CreateTokenResponse> {
  const res = await fetch("/api/token/create", {
    method: "POST",
    headers: authHeaders(adminKey),
    body: JSON.stringify({ project, nodeId }),
  });
  return handleResponse<CreateTokenResponse>(res);
}

export async function listAllTokens(
  adminKey: string,
): Promise<TokenInfo[]> {
  const res = await fetch("/api/token/list", {
    headers: authHeaders(adminKey),
  });
  const data = await handleResponse<{ tokens: TokenInfo[] }>(res);
  return data.tokens;
}

export async function revokeToken(
  adminKey: string,
  token: string,
): Promise<void> {
  const res = await fetch("/api/token/revoke", {
    method: "POST",
    headers: authHeaders(adminKey),
    body: JSON.stringify({ token }),
  });
  await handleResponse<{ revoked: boolean }>(res);
}

export async function fetchNodes(
  adminKey: string,
): Promise<ConnectedNode[]> {
  const res = await fetch("/api/nodes", {
    headers: authHeaders(adminKey),
  });
  const data = await handleResponse<{ nodes: ConnectedNode[] }>(res);
  return data.nodes;
}

export async function fetchLogs(
  adminKey: string,
): Promise<LogEntry[]> {
  const res = await fetch("/api/logs", {
    headers: authHeaders(adminKey),
  });
  const data = await handleResponse<{ logs: LogEntry[] }>(res);
  return data.logs;
}
