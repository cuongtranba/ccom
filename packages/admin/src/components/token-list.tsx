import { Button } from "@/components/ui/button";
import type { TokenInfo } from "@/lib/api";

interface TokenListProps {
  disabled: boolean;
  tokens: TokenInfo[];
  loading: boolean;
  onRemoveNode: (projectId: string, nodeId: string) => Promise<void>;
  onRemoveProject: (projectId: string) => Promise<void>;
}

export function TokenList({
  disabled,
  tokens,
  loading,
  onRemoveNode,
  onRemoveProject,
}: TokenListProps) {
  async function handleRemoveNode(projectId: string, nodeId: string) {
    if (!confirm(`Remove node "${nodeId}" from project "${projectId}"? This revokes all its tokens and disconnects it.`)) return;
    await onRemoveNode(projectId, nodeId);
  }

  async function handleRemoveProject(projectId: string) {
    if (!confirm(`Remove entire project "${projectId}"? This revokes ALL tokens and disconnects ALL nodes in this project.`)) return;
    await onRemoveProject(projectId);
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
              <div className="mb-2 flex items-center justify-between">
                <div className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {project}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground text-[0.65rem]"
                  onClick={() => handleRemoveProject(project)}
                  disabled={disabled}
                >
                  Remove Project
                </Button>
              </div>
              <div className="flex flex-col gap-px bg-sand-dim">
                {projectTokens.map((t, i) => (
                  <div
                    key={`${t.nodeId}-${i}`}
                    className="grid grid-cols-[1fr_1fr_auto] items-center gap-4 bg-card px-4 py-3"
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
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                      onClick={() => handleRemoveNode(project, t.nodeId)}
                      disabled={disabled}
                    >
                      Remove
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
