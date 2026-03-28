import { useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { LogEntry } from "@/lib/api";

interface ServerLogsProps {
  logs: LogEntry[];
  isAuthed: boolean;
}

const LEVEL_STYLES: Record<string, string> = {
  info: "bg-primary/20 text-primary",
  warn: "bg-accent/20 text-accent",
  error: "bg-destructive/20 text-destructive",
};

export function ServerLogs({ logs, isAuthed }: ServerLogsProps) {
  const disabled = !isAuthed;
  const [paused, setPaused] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!paused && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, paused]);

  return (
    <section className="mb-12">
      <div className="mb-5 flex items-center justify-between border-b border-sand-dim pb-2">
        <div className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-accent">
          Server Logs
        </div>
        {!disabled && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPaused(!paused)}
            className="h-6 border-border px-2 text-[0.65rem] uppercase tracking-wider"
          >
            {paused ? "Resume" : "Pause"}
          </Button>
        )}
      </div>

      {disabled ? (
        <div className="bg-card p-8 text-sm text-muted-foreground">
          Authenticate to view server logs.
        </div>
      ) : logs.length === 0 ? (
        <div className="bg-card p-8 text-sm text-muted-foreground">
          No log entries yet.
        </div>
      ) : (
        <ScrollArea className="h-[300px] bg-card">
          <div className="p-4 font-mono text-xs">
            {logs.map((entry, i) => (
              <div key={i} className="flex gap-3 py-0.5">
                <span className="shrink-0 text-muted-foreground">
                  {new Date(entry.timestamp).toLocaleTimeString("en-US", {
                    hour12: false,
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
                <Badge
                  className={cn(
                    "h-4 shrink-0 rounded px-1.5 text-[0.6rem] font-medium uppercase",
                    LEVEL_STYLES[entry.level] ?? "",
                  )}
                >
                  {entry.level}
                </Badge>
                <span className="text-foreground">{entry.message}</span>
                {entry.meta && (
                  <span className="text-muted-foreground">
                    {Object.entries(entry.meta)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(" ")}
                  </span>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      )}
    </section>
  );
}
