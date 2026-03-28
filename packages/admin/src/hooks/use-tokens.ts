import { useState, useCallback } from "react";
import {
  createToken,
  listTokens,
  revokeToken,
  type TokenInfo,
} from "@/lib/api";

interface CreateResult {
  type: "success" | "error";
  message: string;
  token?: string;
  nodeId?: string;
}

export function useTokens(adminKey: string) {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [currentProject, setCurrentProject] = useState("");
  const [loading, setLoading] = useState(false);
  const [createResult, setCreateResult] = useState<CreateResult | null>(null);

  const loadTokens = useCallback(
    async (project: string) => {
      if (!adminKey || !project) return;
      setLoading(true);
      try {
        const list = await listTokens(adminKey, project);
        setTokens(list);
        setCurrentProject(project);
      } catch {
        setTokens([]);
      } finally {
        setLoading(false);
      }
    },
    [adminKey],
  );

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
        // Auto-refresh: load the token list for this project immediately
        await loadTokens(project);
      } catch (err) {
        setCreateResult({
          type: "error",
          message: err instanceof Error ? err.message : "Failed",
        });
      }
    },
    [adminKey, loadTokens],
  );

  const revoke = useCallback(
    async (token: string) => {
      if (!adminKey) return;
      try {
        await revokeToken(adminKey, token);
        // Refresh list after revoke
        if (currentProject) {
          await loadTokens(currentProject);
        }
      } catch (err) {
        setCreateResult({
          type: "error",
          message: err instanceof Error ? err.message : "Revoke failed",
        });
      }
    },
    [adminKey, currentProject, loadTokens],
  );

  return {
    tokens,
    currentProject,
    loading,
    createResult,
    loadTokens,
    create,
    revoke,
    clearResult: () => setCreateResult(null),
  } as const;
}
