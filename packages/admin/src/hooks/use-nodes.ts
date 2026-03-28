import { useState, useEffect, useCallback } from "react";
import { fetchNodes, disconnectNode, type ConnectedNode } from "@/lib/api";

export function useNodes(adminKey: string) {
  const [nodes, setNodes] = useState<ConnectedNode[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!adminKey) return;
    try {
      const list = await fetchNodes(adminKey);
      setNodes(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fetch failed");
    }
  }, [adminKey]);

  useEffect(() => {
    if (!adminKey) {
      setNodes([]);
      return;
    }

    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [adminKey, refresh]);

  const disconnect = useCallback(
    async (projectId: string, nodeId: string) => {
      if (!adminKey) return;
      await disconnectNode(adminKey, projectId, nodeId);
      await refresh();
    },
    [adminKey, refresh],
  );

  return { nodes, error, disconnect };
}
