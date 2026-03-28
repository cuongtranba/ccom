import { useState, useCallback, useEffect } from "react";
import { createProject, listProjects } from "@/lib/api";

interface CreateResult {
  type: "success" | "error";
  message: string;
}

export function useProjects(adminKey: string) {
  const [projects, setProjects] = useState<string[]>([]);
  const [createResult, setCreateResult] = useState<CreateResult | null>(null);

  const refresh = useCallback(async () => {
    if (!adminKey) return;
    try {
      const list = await listProjects(adminKey);
      setProjects(list.sort());
    } catch {
      setProjects([]);
    }
  }, [adminKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(
    async (project: string) => {
      if (!adminKey) return;
      try {
        await createProject(adminKey, project);
        setCreateResult({ type: "success", message: `Project "${project}" created` });
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

  return {
    projects,
    createResult,
    create,
    refresh,
    clearResult: () => setCreateResult(null),
  } as const;
}
