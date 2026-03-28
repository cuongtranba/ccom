import { useState, useCallback, useEffect } from "react";
import {
  createToken,
  listAllTokens,
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

  // Auto-load all tokens when authenticated
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

  const revoke = useCallback(
    async (token: string) => {
      if (!adminKey) return;
      try {
        await revokeToken(adminKey, token);
        await refresh();
      } catch (err) {
        setCreateResult({
          type: "error",
          message: err instanceof Error ? err.message : "Revoke failed",
        });
      }
    },
    [adminKey, refresh],
  );

  return {
    tokens,
    loading,
    createResult,
    create,
    revoke,
    clearResult: () => setCreateResult(null),
  } as const;
}
