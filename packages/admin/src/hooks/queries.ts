import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchMetrics,
  listProjects,
  createProject,
  listAllTokens,
  createToken,
  removeNode,
  removeProject,
  fetchNodes,
  disconnectNode,
  fetchLogs,
  type Metrics,
  type TokenInfo,
  type ConnectedNode,
  type LogEntry,
} from "@/lib/api";

// ─── Query Keys ──────────────────────────────────────────────────────────────

const keys = {
  metrics: ["metrics"] as const,
  projects: (adminKey: string) => ["projects", adminKey] as const,
  tokens: (adminKey: string) => ["tokens", adminKey] as const,
  nodes: (adminKey: string) => ["nodes", adminKey] as const,
  logs: (adminKey: string) => ["logs", adminKey] as const,
};

// ─── Result Types ────────────────────────────────────────────────────────────

interface CreateProjectResult {
  type: "success" | "error";
  message: string;
}

interface CreateTokenResult {
  type: "success" | "error";
  message: string;
  token?: string;
  nodeId?: string;
}

// ─── useMetrics ──────────────────────────────────────────────────────────────

export function useMetrics(enabled: boolean) {
  const prevRef = useRef<Metrics | null>(null);
  const [changed, setChanged] = useState<Set<keyof Metrics>>(new Set());

  const { data: metrics = null } = useQuery<Metrics>({
    queryKey: keys.metrics,
    queryFn: async () => {
      const m = await fetchMetrics();

      const prev = prevRef.current;
      if (prev) {
        const diff = new Set<keyof Metrics>();
        for (const key of Object.keys(m) as (keyof Metrics)[]) {
          if (m[key] !== prev[key]) diff.add(key);
        }
        setChanged(diff);
      }

      prevRef.current = m;
      return m;
    },
    enabled,
    refetchInterval: 3000,
  });

  return { metrics, changed };
}

// ─── useProjects ─────────────────────────────────────────────────────────────

export function useProjects(adminKey: string) {
  const qc = useQueryClient();
  const [createResult, setCreateResult] = useState<CreateProjectResult | null>(null);

  const { data: projects = [] } = useQuery<string[]>({
    queryKey: keys.projects(adminKey),
    queryFn: async () => {
      const list = await listProjects(adminKey);
      return list.sort();
    },
    enabled: !!adminKey,
  });

  const createMutation = useMutation({
    mutationFn: (project: string) => createProject(adminKey, project),
    onSuccess: (_data, project) => {
      setCreateResult({ type: "success", message: `Project "${project}" created` });
      qc.invalidateQueries({ queryKey: keys.projects(adminKey) });
    },
    onError: (err: Error) => {
      setCreateResult({ type: "error", message: err.message });
    },
  });

  const create = async (project: string) => {
    if (!adminKey) return;
    createMutation.mutate(project);
  };

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: keys.projects(adminKey) });
  };

  return { projects, createResult, create, refresh } as const;
}

// ─── useTokens ───────────────────────────────────────────────────────────────

export function useTokens(adminKey: string, onProjectChange?: () => Promise<void>) {
  const qc = useQueryClient();
  const [createResult, setCreateResult] = useState<CreateTokenResult | null>(null);

  const { data: tokens = [], isLoading: loading } = useQuery<TokenInfo[]>({
    queryKey: keys.tokens(adminKey),
    queryFn: () => listAllTokens(adminKey),
    enabled: !!adminKey,
  });

  const createMutation = useMutation({
    mutationFn: ({ project, nodeId }: { project: string; nodeId: string }) =>
      createToken(adminKey, project, nodeId),
    onSuccess: (res) => {
      setCreateResult({
        type: "success",
        message: `Token created for ${res.nodeId}`,
        token: res.token,
        nodeId: res.nodeId,
      });
      qc.invalidateQueries({ queryKey: keys.tokens(adminKey) });
    },
    onError: (err: Error) => {
      setCreateResult({ type: "error", message: err.message });
    },
  });

  const removeNodeMutation = useMutation({
    mutationFn: ({ projectId, nodeId }: { projectId: string; nodeId: string }) =>
      removeNode(adminKey, projectId, nodeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.tokens(adminKey) });
    },
    onError: (err: Error) => {
      setCreateResult({ type: "error", message: err.message });
    },
  });

  const removeProjectMutation = useMutation({
    mutationFn: (projectId: string) => removeProject(adminKey, projectId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.tokens(adminKey) });
      await onProjectChange?.();
    },
    onError: (err: Error) => {
      setCreateResult({ type: "error", message: err.message });
    },
  });

  const create = async (project: string, nodeId: string) => {
    if (!adminKey) return;
    createMutation.mutate({ project, nodeId });
  };

  const removeNodeFn = async (projectId: string, nodeId: string) => {
    if (!adminKey) return;
    removeNodeMutation.mutate({ projectId, nodeId });
  };

  const removeProjectFn = async (projectId: string) => {
    if (!adminKey) return;
    removeProjectMutation.mutate(projectId);
  };

  return {
    tokens,
    loading,
    createResult,
    create,
    removeNode: removeNodeFn,
    removeProject: removeProjectFn,
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

  const disconnect = async (projectId: string, nodeId: string) => {
    if (!adminKey) return;
    disconnectMutation.mutate({ projectId, nodeId });
  };

  return { nodes, disconnect };
}

// ─── useLogs ─────────────────────────────────────────────────────────────────

export function useLogs(adminKey: string) {
  const { data: logs = [] } = useQuery<LogEntry[]>({
    queryKey: keys.logs(adminKey),
    queryFn: () => fetchLogs(adminKey),
    enabled: !!adminKey,
    refetchInterval: 3000,
  });

  return { logs };
}
