import { useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { LogEntry, ConnectedNode, SignalEvent } from "@/lib/api";

interface ServerLogsProps {
  logs: LogEntry[];
  signals: SignalEvent[];
  connectedNodes: ConnectedNode[];
  isAuthed: boolean;
}

const LEVEL_STYLES: Record<string, string> = {
  info: "bg-primary/20 text-primary",
  warn: "bg-accent/20 text-accent",
  error: "bg-destructive/20 text-destructive",
};

function isMsgEntry(entry: LogEntry): boolean {
  return entry.message.startsWith("msg: ");
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function LogLine({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const isMsg = isMsgEntry(entry);

  if (isMsg) {
    const from = entry.meta?.from ?? "";
    const to = entry.meta?.to ?? "";
    const type = entry.message.replace("msg: ", "");
    const content = entry.meta?.content ?? "";

    return (
      <div className="py-0.5">
        <div
          className="flex cursor-pointer gap-3"
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="shrink-0 text-muted-foreground">
            {new Date(entry.timestamp).toLocaleTimeString("en-US", {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
          <Badge className="h-4 shrink-0 rounded px-1.5 text-[0.6rem] font-medium uppercase bg-primary/20 text-primary">
            msg
          </Badge>
          <span className="text-foreground">
            <span style={{ color: "oklch(0.72 0.16 55)" }}>{from}</span>
            <span className="text-muted-foreground"> → </span>
            <span style={{ color: "oklch(0.78 0.14 85)" }}>{to || "*"}</span>
            <span className="ml-2 text-muted-foreground">{type}</span>
          </span>
        </div>
        {expanded && content && (
          <div className="ml-[6.5rem] mt-0.5 rounded bg-muted p-1.5 text-[0.6rem] text-muted-foreground break-all">
            {content}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex gap-3 py-0.5">
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
      {entry.meta && !isMsgEntry(entry) && (
        <span className="text-muted-foreground">
          {Object.entries(entry.meta)
            .filter(([k]) => !["from", "to", "project", "content"].includes(k))
            .map(([k, v]) => `${k}=${v}`)
            .join(" ")}
        </span>
      )}
    </div>
  );
}

export function ServerLogs({
  logs,
  signals,
  connectedNodes,
  isAuthed,
}: ServerLogsProps) {
  const disabled = !isAuthed;
  const [paused, setPaused] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const now = Date.now();

  const activeNodeIds = new Set(
    signals
      .filter((s) => now - new Date(s.timestamp).getTime() < 10_000)
      .flatMap((s) => [s.from, s.to].filter(Boolean)),
  );

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
      ) : (
        <div className="flex gap-4">
          {/* Log stream — 65% */}
          <div className="min-w-0 flex-[65]">
            {logs.length === 0 ? (
              <div className="bg-card p-8 text-sm text-muted-foreground">
                No log entries yet.
              </div>
            ) : (
              <ScrollArea className="h-[300px] bg-card">
                <div className="p-4 font-mono text-xs">
                  {logs.map((entry, i) => (
                    <LogLine key={`${entry.timestamp}-${i}`} entry={entry} />
                  ))}
                  <div ref={bottomRef} />
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Peers sidebar — 35% */}
          <div className="flex-[35]">
            <div className="mb-2 text-[0.6rem] font-semibold uppercase tracking-widest text-muted-foreground">
              Live Peers
            </div>
            {connectedNodes.length === 0 ? (
              <div className="bg-card p-4 text-[0.7rem] text-muted-foreground">
                No nodes connected.
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {connectedNodes.map((node) => {
                  const isActive = activeNodeIds.has(node.nodeId);
                  return (
                    <div
                      key={node.nodeId}
                      className="flex items-start gap-2 rounded bg-card px-3 py-2"
                    >
                      <span
                        className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
                        style={{
                          background: isActive
                            ? "oklch(0.65 0.14 145)"
                            : "oklch(0.38 0.05 65)",
                          boxShadow: isActive
                            ? "0 0 6px oklch(0.65 0.14 145 / 0.6)"
                            : "none",
                          transition: "background 0.4s, box-shadow 0.4s",
                        }}
                      />
                      <div className="min-w-0">
                        <div className="truncate font-mono text-[0.65rem] font-semibold text-foreground">
                          {node.nodeId}
                        </div>
                        <div className="text-[0.58rem] text-muted-foreground">
                          {node.projects.join(", ")}
                        </div>
                        <div className="text-[0.58rem] text-muted-foreground">
                          {node.lastMessageAt
                            ? formatRelative(node.lastMessageAt)
                            : "no messages"}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
