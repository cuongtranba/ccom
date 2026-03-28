import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchMetrics,
  listProjects,
  createProject,
  listAllTokens,
  createToken,
  revokeToken,
  removeNode,
  removeProject,
  assignToken,
  unassignToken,
  fetchNodes,
  disconnectNode,
  fetchLogs,
  type Metrics,
  type TokenInfo,
  type ConnectedNode,
  type LogEntry,
  type CreateTokenResponse,
} from "@/lib/api";

// ─── Query Keys ──────────────────────────────────────────────────────────────

const keys = {
  metrics: ["metrics"] as const,
  projects: (adminKey: string) => ["projects", adminKey] as const,
  tokens: (adminKey: string) => ["tokens", adminKey] as const,
  nodes: (adminKey: string) => ["nodes", adminKey] as const,
  logs: (adminKey: string) => ["logs", adminKey] as const,
};

// ─── useMetrics ──────────────────────────────────────────────────────────────

export function useMetrics(enabled: boolean) {
  const prevRef = useRef<Metrics | null>(null);
  const [changedFields, setChangedFields] = useState<Set<keyof Metrics>>(new Set());

  const query = useQuery<Metrics>({
    queryKey: keys.metrics,
    queryFn: async () => {
      const m = await fetchMetrics();

      const prev = prevRef.current;
      if (prev) {
        const diff = new Set<keyof Metrics>();
        for (const key of Object.keys(m) as (keyof Metrics)[]) {
          if (m[key] !== prev[key]) diff.add(key);
        }
        setChangedFields(diff);
      }

      prevRef.current = m;
      return m;
    },
    enabled,
    refetchInterval: 3000,
  });

  return { data: query.data ?? null, changedFields };
}

// ─── useProjects ─────────────────────────────────────────────────────────────

export function useProjects(adminKey: string) {
  const qc = useQueryClient();

  const { data: projects = [], isLoading: loading } = useQuery<string[]>({
    queryKey: keys.projects(adminKey),
    queryFn: async () => {
      const list = await listProjects(adminKey);
      return list.sort();
    },
    enabled: !!adminKey,
  });

  const createMutation = useMutation({
    mutationFn: (project: string) => createProject(adminKey, project),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.projects(adminKey) });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (projectName: string) => removeProject(adminKey, projectName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.projects(adminKey) });
      qc.invalidateQueries({ queryKey: keys.tokens(adminKey) });
    },
  });

  return {
    projects,
    loading,
    create: createMutation.mutateAsync,
    remove: removeMutation.mutateAsync,
    createPending: createMutation.isPending,
    removePending: removeMutation.isPending,
  } as const;
}

// ─── useTokens ───────────────────────────────────────────────────────────────

export function useTokens(adminKey: string) {
  const qc = useQueryClient();
  const [lastCreated, setLastCreated] = useState<CreateTokenResponse | null>(null);

  const { data: tokens = [], isLoading: loading } = useQuery<TokenInfo[]>({
    queryKey: keys.tokens(adminKey),
    queryFn: () => listAllTokens(adminKey),
    enabled: !!adminKey,
  });

  const createMutation = useMutation({
    mutationFn: (input: { nodeId: string; name: string; vertical: string; owner: string }) =>
      createToken(adminKey, input),
    onSuccess: (res) => {
      setLastCreated(res);
      qc.invalidateQueries({ queryKey: keys.tokens(adminKey) });
      qc.invalidateQueries({ queryKey: keys.projects(adminKey) });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (secret: string) => revokeToken(adminKey, secret),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.tokens(adminKey) });
      qc.invalidateQueries({ queryKey: keys.projects(adminKey) });
    },
  });

  const removeNodeMutation = useMutation({
    mutationFn: ({ projectName, nodeId }: { projectName: string; nodeId: string }) =>
      removeNode(adminKey, projectName, nodeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.tokens(adminKey) });
      qc.invalidateQueries({ queryKey: keys.projects(adminKey) });
    },
  });

  const assignProjectMutation = useMutation({
    mutationFn: ({ tokenId, project }: { tokenId: string; project: string }) =>
      assignToken(adminKey, tokenId, project),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.tokens(adminKey) });
      qc.invalidateQueries({ queryKey: keys.projects(adminKey) });
    },
  });

  const unassignProjectMutation = useMutation({
    mutationFn: ({ tokenId, project }: { tokenId: string; project: string }) =>
      unassignToken(adminKey, tokenId, project),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.tokens(adminKey) });
      qc.invalidateQueries({ queryKey: keys.projects(adminKey) });
    },
  });

  return {
    tokens,
    loading,
    lastCreated,
    clearLastCreated: () => setLastCreated(null),
    create: createMutation.mutateAsync,
    revokeToken: revokeMutation.mutateAsync,
    removeNode: removeNodeMutation.mutateAsync,
    assignProject: assignProjectMutation.mutateAsync,
    unassignProject: unassignProjectMutation.mutateAsync,
    createPending: createMutation.isPending,
  } as const;
}

// ─── useNodes ────────────────────────────────────────────────────────────────

export function useNodes(adminKey: string) {
  const qc = useQueryClient();

  const { data: nodes = [] } = useQuery<ConnectedNode[]>({
    queryKey: keys.nodes(adminKey),
    queryFn: () => fetchNodes(adminKey),
    enabled: !!adminKey,
    refetchInterval: 5000,
  });

  const disconnectMutation = useMutation({
    mutationFn: ({ projectId, nodeId }: { projectId: string; nodeId: string }) =>
      disconnectNode(adminKey, projectId, nodeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.nodes(adminKey) });
    },
  });

  const disconnect = (projectId: string, nodeId: string) => {
    if (!adminKey) return Promise.resolve();
    return disconnectMutation.mutateAsync({ projectId, nodeId });
  };

  return { data: nodes, disconnect };
}

// ─── useLogs ─────────────────────────────────────────────────────────────────

export function useLogs(adminKey: string) {
  const { data: logs = [] } = useQuery<LogEntry[]>({
    queryKey: keys.logs(adminKey),
    queryFn: () => fetchLogs(adminKey),
    enabled: !!adminKey,
    refetchInterval: 3000,
  });

  return { data: logs };
}
