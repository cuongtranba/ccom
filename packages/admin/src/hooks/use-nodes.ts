import { useState, useEffect } from "react";
import { fetchNodes, type ConnectedNode } from "@/lib/api";

export function useNodes(adminKey: string) {
  const [nodes, setNodes] = useState<ConnectedNode[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!adminKey) {
      setNodes([]);
      return;
    }

    let cancelled = false;

    async function poll() {
      try {
        const list = await fetchNodes(adminKey);
        if (!cancelled) {
          setNodes(list);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Fetch failed");
      }
    }

    poll();
    const id = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [adminKey]);

  return { nodes, error };
}
