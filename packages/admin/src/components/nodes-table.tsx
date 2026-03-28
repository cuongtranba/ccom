import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { DataTable, type Column } from "@/components/data-table";
import { useTokens } from "@/hooks/queries";
import type { TokenInfo } from "@/lib/api";

interface NodesTableProps {
  adminKey: string;
}

interface TokenWithSecret extends TokenInfo {
  secret?: string;
}

export function NodesTable({ adminKey }: NodesTableProps) {
  const { tokens, loading, create, revokeToken, createPending } = useTokens(adminKey);
  const [nodeId, setNodeId] = useState("");
  const [name, setName] = useState("");
  const [vertical, setVertical] = useState("");
  const [owner, setOwner] = useState("");
  const [creating, setCreating] = useState(false);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!nodeId.trim() || !name.trim() || !vertical.trim() || !owner.trim()) return;
    const res = await create({ nodeId: nodeId.trim(), name: name.trim(), vertical: vertical.trim(), owner: owner.trim() });
    setSecrets((prev) => ({ ...prev, [res.id]: res.token }));
    setNodeId("");
    setName("");
    setVertical("");
    setOwner("");
    setCreating(false);
  }

  async function handleCopy(tokenId: string) {
    const secret = secrets[tokenId];
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    setCopiedId(tokenId);
    setTimeout(() => setCopiedId(null), 2000);
  }

  const tokensWithSecrets: TokenWithSecret[] = tokens.map((t) => ({
    ...t,
    secret: secrets[t.id],
  }));

  const columns: Column<TokenWithSecret>[] = [
    {
      header: "Node ID",
      accessor: (row) => (
        <span className="font-mono text-sm font-semibold">{row.nodeId}</span>
      ),
    },
    {
      header: "Name",
      accessor: (row) => <span className="text-sm">{row.name}</span>,
    },
    {
      header: "Vertical",
      accessor: (row) => (
        <Badge variant="secondary" className="text-[0.65rem] uppercase tracking-wider">
          {row.vertical}
        </Badge>
      ),
      className: "w-[100px]",
    },
    {
      header: "Owner",
      accessor: (row) => <span className="text-sm text-muted-foreground">{row.owner}</span>,
    },
    {
      header: "Projects",
      accessor: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.projects.length > 0 ? row.projects.join(", ") : "—"}
        </span>
      ),
    },
    {
      header: "Token",
      accessor: (row) => {
        if (!row.secret) {
          return <span className="font-mono text-xs text-muted-foreground">••••••••...</span>;
        }
        return (
          <button
            className="font-mono text-xs text-foreground hover:text-primary transition-colors"
            onClick={() => handleCopy(row.id)}
            title="Click to copy"
          >
            {copiedId === row.id ? "Copied!" : `${row.secret.substring(0, 8)}...`}
          </button>
        );
      },
      className: "w-[120px]",
    },
    {
      header: "Actions",
      accessor: (row) => (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground text-[0.65rem]"
            >
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete node &quot;{row.nodeId}&quot;?</AlertDialogTitle>
              <AlertDialogDescription>
                This will revoke the token for this node and disconnect it from all projects.
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => revokeToken(row.id)}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ),
      className: "w-[100px]",
    },
  ];

  return (
    <section className="mb-10">
      <div className="mb-5 border-b border-sand-dim pb-2 text-[0.65rem] font-semibold uppercase tracking-widest text-accent">
        Nodes
      </div>

      <div className="mb-4">
        {creating ? (
          <form onSubmit={handleCreate} className="bg-card p-4">
            <div className="mb-3 text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
              New Node
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
                  Node ID
                </label>
                <Input
                  value={nodeId}
                  onChange={(e) => setNodeId(e.target.value)}
                  placeholder="my-node"
                  required
                  autoFocus
                  className="border-border bg-background font-mono text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
                  Name
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Node"
                  required
                  className="border-border bg-background text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
                  Vertical
                </label>
                <Input
                  value={vertical}
                  onChange={(e) => setVertical(e.target.value)}
                  placeholder="dev"
                  required
                  className="border-border bg-background text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
                  Owner
                </label>
                <Input
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                  placeholder="your-name"
                  required
                  className="border-border bg-background text-sm"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={createPending}
                className="text-[0.65rem] uppercase tracking-widest"
              >
                {createPending ? "Creating..." : "Create Node"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-[0.65rem] uppercase tracking-widest"
                onClick={() => setCreating(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button
            size="sm"
            className="text-[0.65rem] uppercase tracking-widest"
            onClick={() => setCreating(true)}
          >
            + New Node
          </Button>
        )}
      </div>

      <div className="bg-card">
        <DataTable
          columns={columns}
          data={tokensWithSecrets}
          keyFn={(row) => row.id}
          loading={loading}
          emptyMessage="No nodes yet. Create one above."
        />
      </div>
    </section>
  );
}
