import { useState, useEffect } from "react";
import { fetchLogs, type LogEntry } from "@/lib/api";

export function useLogs(adminKey: string) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!adminKey) {
      setLogs([]);
      return;
    }

    let cancelled = false;

    async function poll() {
      try {
        const entries = await fetchLogs(adminKey);
        if (!cancelled) {
          setLogs(entries);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Fetch failed");
      }
    }

    poll();
    const id = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [adminKey]);

  return { logs, error };
}
