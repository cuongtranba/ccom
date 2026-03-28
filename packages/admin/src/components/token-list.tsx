import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { TokenInfo } from "@/lib/api";

interface TokenListProps {
  disabled: boolean;
  tokens: TokenInfo[];
  currentProject: string;
  loading: boolean;
  onLoad: (project: string) => Promise<void>;
  onRevoke: (token: string) => Promise<void>;
}

export function TokenList({
  disabled,
  tokens,
  currentProject,
  loading,
  onLoad,
  onRevoke,
}: TokenListProps) {
  const [project, setProject] = useState(currentProject);

  // Sync external project changes (from auto-refresh after create)
  if (currentProject && currentProject !== project) {
    setProject(currentProject);
  }

  async function handleLoad(e: React.FormEvent) {
    e.preventDefault();
    if (!project.trim()) return;
    await onLoad(project.trim());
  }

  async function handleRevoke(nodeId: string) {
    const token = prompt(`Enter the token for ${nodeId} to revoke it:`);
    if (!token) return;
    if (!confirm(`Revoke credential for ${nodeId}? This disconnects the node immediately.`)) return;
    await onRevoke(token);
  }

  return (
    <section className="mb-12">
      <div className="mb-5 border-b border-sand-dim pb-2 text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-accent">
        Active Credentials
      </div>
      <form onSubmit={handleLoad} className="mb-4 flex items-end gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
            Project
          </label>
          <Input
            placeholder="Project to list"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            disabled={disabled}
            className="border-border bg-background"
          />
        </div>
        <Button
          type="submit"
          disabled={disabled || loading}
          className="bg-primary text-primary-foreground hover:bg-spice-bright"
        >
          Load
        </Button>
      </form>

      {currentProject && tokens.length === 0 && !loading && (
        <div className="bg-card p-8 text-sm text-muted-foreground">
          No credentials issued for this project yet.
        </div>
      )}

      {tokens.length > 0 && (
        <div className="flex flex-col gap-px bg-sand-dim">
          {tokens.map((t, i) => (
            <div
              key={`${t.nodeId}-${i}`}
              className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-4 bg-card px-4 py-3"
            >
              <div className="font-semibold">{t.nodeId}</div>
              <div className="font-mono text-xs text-muted-foreground">
                {new Date(t.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
              <div className="max-w-[160px] truncate font-mono text-xs text-border">
                token:hidden
              </div>
              <Button
                variant="outline"
                size="sm"
                className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                onClick={() => handleRevoke(t.nodeId)}
                disabled={disabled}
              >
                Revoke
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
