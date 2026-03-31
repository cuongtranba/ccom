import { useState, useEffect } from "react";
import type { LogEntry, SignalEvent } from "@/lib/api";
import { fetchLogs } from "@/lib/api";

const MAX_SIGNALS = 50;
const MAX_LOGS = 200;

export function useSignalStream(adminKey: string) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [signals, setSignals] = useState<SignalEvent[]>([]);

  // Load initial log history once
  useEffect(() => {
    if (!adminKey) return;
    fetchLogs(adminKey).then(setLogs).catch(() => {});
  }, [adminKey]);

  // Open SSE stream
  useEffect(() => {
    if (!adminKey) return;

    const es = new EventSource(
      `/api/stream?key=${encodeURIComponent(adminKey)}`,
    );

    es.addEventListener("signal", (e: MessageEvent) => {
      const data = JSON.parse(e.data) as SignalEvent;
      setSignals((prev) => {
        // Replace existing entry for same from→to pair, keep rolling max
        const filtered = prev.filter(
          (s) => !(s.from === data.from && s.to === data.to),
        );
        return [data, ...filtered].slice(0, MAX_SIGNALS);
      });
    });

    es.addEventListener("log", (e: MessageEvent) => {
      const entry = JSON.parse(e.data) as LogEntry;
      setLogs((prev) => [...prev, entry].slice(-MAX_LOGS));
    });

    es.onerror = () => {
      // EventSource auto-reconnects — no manual handling needed
    };

    return () => es.close();
  }, [adminKey]);

  return { logs, signals };
}
