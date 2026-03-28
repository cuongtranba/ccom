import { useState, useCallback, useEffect } from "react";
import {
  createToken,
  listAllTokens,
  removeNode,
  removeProject,
  type TokenInfo,
} from "@/lib/api";

interface CreateResult {
  type: "success" | "error";
  message: string;
  token?: string;
  nodeId?: string;
}

export function useTokens(adminKey: string, onProjectChange?: () => Promise<void>) {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [createResult, setCreateResult] = useState<CreateResult | null>(null);

  const refresh = useCallback(async () => {
    if (!adminKey) return;
    setLoading(true);
    try {
      const list = await listAllTokens(adminKey);
      setTokens(list);
    } catch {
      setTokens([]);
    } finally {
      setLoading(false);
    }
  }, [adminKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(
    async (project: string, nodeId: string) => {
      if (!adminKey) return;
      try {
        const res = await createToken(adminKey, project, nodeId);
        setCreateResult({
          type: "success",
          message: `Token created for ${res.nodeId}`,
          token: res.token,
          nodeId: res.nodeId,
        });
        await refresh();
      } catch (err) {
        setCreateResult({
          type: "error",
          message: err instanceof Error ? err.message : "Failed",
        });
      }
    },
    [adminKey, refresh],
  );

  const removeNodeFn = useCallback(
    async (projectId: string, nodeId: string) => {
      if (!adminKey) return;
      try {
        await removeNode(adminKey, projectId, nodeId);
        await refresh();
      } catch (err) {
        setCreateResult({
          type: "error",
          message: err instanceof Error ? err.message : "Remove node failed",
        });
      }
    },
    [adminKey, refresh],
  );

  const removeProjectFn = useCallback(
    async (projectId: string) => {
      if (!adminKey) return;
      try {
        await removeProject(adminKey, projectId);
        await refresh();
        await onProjectChange?.();
      } catch (err) {
        setCreateResult({
          type: "error",
          message: err instanceof Error ? err.message : "Remove project failed",
        });
      }
    },
    [adminKey, refresh, onProjectChange],
  );

  return {
    tokens,
    loading,
    createResult,
    create,
    removeNode: removeNodeFn,
    removeProject: removeProjectFn,
    clearResult: () => setCreateResult(null),
  } as const;
}
