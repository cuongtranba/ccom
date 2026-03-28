import { useState, useEffect, useRef } from "react";
import { fetchMetrics, type Metrics } from "@/lib/api";

export function useMetrics(enabled: boolean) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prevRef = useRef<Metrics | null>(null);
  const [changed, setChanged] = useState<Set<keyof Metrics>>(new Set());

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    async function poll() {
      try {
        const m = await fetchMetrics();
        if (cancelled) return;

        const prev = prevRef.current;
        if (prev) {
          const diff = new Set<keyof Metrics>();
          for (const key of Object.keys(m) as (keyof Metrics)[]) {
            if (m[key] !== prev[key]) diff.add(key);
          }
          setChanged(diff);
        }

        prevRef.current = m;
        setMetrics(m);
        setError(null);
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
  }, [enabled]);

  return { metrics, error, changed };
}
