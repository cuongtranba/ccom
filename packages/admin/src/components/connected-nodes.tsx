import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import type { ConnectedNode } from "@/lib/api";

interface ConnectedNodesProps {
  nodes: ConnectedNode[];
  disabled: boolean;
  onDisconnect: (projectId: string, nodeId: string) => Promise<void>;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ConnectedNodes({ nodes, disabled, onDisconnect }: ConnectedNodesProps) {
  async function handleDisconnect(projectId: string, nodeId: string) {
    if (!confirm(`Disconnect node "${nodeId}" from project "${projectId}"?`)) return;
    await onDisconnect(projectId, nodeId);
  }

  return (
    <section className="mb-12">
      <div className="mb-5 border-b border-sand-dim pb-2 text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-accent">
        Connected Nodes
      </div>

      {disabled ? (
        <div className="bg-card p-8 text-sm text-muted-foreground">
          Authenticate to view connected nodes.
        </div>
      ) : nodes.length === 0 ? (
        <div className="bg-card p-8 text-sm text-muted-foreground">
          No nodes currently connected.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="border-sand-dim">
              <TableHead className="text-muted-foreground">Node ID</TableHead>
              <TableHead className="text-muted-foreground">Project</TableHead>
              <TableHead className="text-muted-foreground">Connected Since</TableHead>
              <TableHead className="text-muted-foreground">Last Message</TableHead>
              <TableHead className="text-muted-foreground w-[100px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {nodes.map((node) => (
              <TableRow key={`${node.project}:${node.nodeId}`} className="border-sand-dim">
                <TableCell className="font-semibold">{node.nodeId}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {node.project}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {formatRelativeTime(node.connectedAt)}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {node.lastMessageAt
                    ? formatRelativeTime(node.lastMessageAt)
                    : "—"}
                </TableCell>
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                    onClick={() => handleDisconnect(node.project, node.nodeId)}
                  >
                    Disconnect
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
