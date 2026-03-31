import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { ConnectedNode } from "@/lib/api";

interface ConnectedNodesProps {
  nodes: ConnectedNode[];
  isAuthed: boolean;
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

export function ConnectedNodes({ nodes, isAuthed, onDisconnect }: ConnectedNodesProps) {
  return (
    <section className="mb-10">
      <div className="mb-5 border-b border-sand-dim pb-2 text-[0.65rem] font-semibold uppercase tracking-widest text-accent">
        Connected Nodes
      </div>

      {!isAuthed ? (
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
              <TableHead className="text-muted-foreground">Projects</TableHead>
              <TableHead className="text-muted-foreground">Connected Since</TableHead>
              <TableHead className="text-muted-foreground">Last Message</TableHead>
              <TableHead className="text-muted-foreground w-[120px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {nodes.map((node) => (
              <TableRow key={`${node.projects.join(",")}:${node.nodeId}`} className="border-sand-dim">
                <TableCell className="font-semibold">{node.nodeId}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {node.projects.join(", ")}
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
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground text-[0.65rem]"
                      >
                        Disconnect
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Disconnect &quot;{node.nodeId}&quot;?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will close the WebSocket connection for this node. It can reconnect automatically.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => onDisconnect(node.projects[0] ?? "", node.nodeId)}
                        >
                          Disconnect
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
