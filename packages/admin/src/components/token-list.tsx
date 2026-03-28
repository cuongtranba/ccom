import { Button } from "@/components/ui/button";
import type { TokenInfo } from "@/lib/api";

interface TokenListProps {
  disabled: boolean;
  tokens: TokenInfo[];
  loading: boolean;
  onRevoke: (token: string) => Promise<void>;
}

export function TokenList({
  disabled,
  tokens,
  loading,
  onRevoke,
}: TokenListProps) {
  async function handleRevoke(nodeId: string) {
    const token = prompt(`Enter the token for ${nodeId} to revoke it:`);
    if (!token) return;
    if (!confirm(`Revoke credential for ${nodeId}? This disconnects the node immediately.`)) return;
    await onRevoke(token);
  }

  // Group tokens by project
  const grouped = new Map<string, TokenInfo[]>();
  for (const t of tokens) {
    const list = grouped.get(t.projectId) ?? [];
    list.push(t);
    grouped.set(t.projectId, list);
  }

  return (
    <section className="mb-12">
      <div className="mb-5 border-b border-sand-dim pb-2 text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-accent">
        Active Credentials
      </div>

      {loading && (
        <div className="bg-card p-8 text-sm text-muted-foreground">
          Loading...
        </div>
      )}

      {!loading && tokens.length === 0 && (
        <div className="bg-card p-8 text-sm text-muted-foreground">
          No credentials issued yet.
        </div>
      )}

      {!loading && grouped.size > 0 && (
        <div className="flex flex-col gap-6">
          {Array.from(grouped.entries()).map(([project, projectTokens]) => (
            <div key={project}>
              <div className="mb-2 font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {project}
              </div>
              <div className="flex flex-col gap-px bg-sand-dim">
                {projectTokens.map((t, i) => (
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
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
