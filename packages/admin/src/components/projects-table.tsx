import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useProjects } from "@/hooks/queries";
import { useTokens } from "@/hooks/queries";

interface ProjectsTableProps {
  adminKey: string;
}

interface ProjectRow {
  name: string;
  nodeCount: number;
}

export function ProjectsTable({ adminKey }: ProjectsTableProps) {
  const { projects, create, remove } = useProjects(adminKey);
  const { tokens, assignProject, unassignProject } = useTokens(adminKey);
  const [newProject, setNewProject] = useState("");
  const [creating, setCreating] = useState(false);
  const [assignSelections, setAssignSelections] = useState<Record<string, string>>({});

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newProject.trim()) return;
    await create(newProject.trim());
    setNewProject("");
  }

  const rows: ProjectRow[] = projects.map((name) => ({
    name,
    nodeCount: tokens.filter((t) => t.projects.includes(name)).length,
  }));

  const columns: Column<ProjectRow>[] = [
    {
      header: "Name",
      accessor: (row) => (
        <span className="font-mono text-sm font-semibold">{row.name}</span>
      ),
    },
    {
      header: "Nodes",
      accessor: (row) => (
        <span className="text-sm text-muted-foreground">{row.nodeCount}</span>
      ),
      className: "w-[80px]",
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
              onClick={(e) => e.stopPropagation()}
            >
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete project &quot;{row.name}&quot;?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove the project and revoke all associated tokens. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => remove(row.name)}
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

  function expandRow(row: ProjectRow) {
    const assignedTokens = tokens.filter((t) => t.projects.includes(row.name));
    const unassignedTokens = tokens.filter((t) => !t.projects.includes(row.name));
    const selectedTokenId = assignSelections[row.name] ?? "";

    return (
      <div onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
          Assigned Nodes
        </div>

        {assignedTokens.length === 0 ? (
          <p className="mb-3 text-sm text-muted-foreground">No nodes assigned to this project.</p>
        ) : (
          <div className="mb-4 flex flex-col gap-px bg-sand-dim">
            {assignedTokens.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between bg-card px-4 py-2"
              >
                <div>
                  <span className="font-semibold text-sm">{t.nodeId}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{t.name}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground text-[0.65rem]"
                  onClick={() => unassignProject({ tokenId: t.id, project: row.name })}
                >
                  Unassign
                </Button>
              </div>
            ))}
          </div>
        )}

        {unassignedTokens.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              value={selectedTokenId}
              onChange={(e) =>
                setAssignSelections((prev) => ({ ...prev, [row.name]: e.target.value }))
              }
              className="rounded border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Select node to assign...</option>
              {unassignedTokens.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nodeId} — {t.name}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={!selectedTokenId}
              className="text-[0.65rem] uppercase tracking-widest"
              onClick={() => {
                if (!selectedTokenId) return;
                assignProject({ tokenId: selectedTokenId, project: row.name });
                setAssignSelections((prev) => ({ ...prev, [row.name]: "" }));
              }}
            >
              Assign
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="mb-10">
      <div className="mb-5 border-b border-sand-dim pb-2 text-[0.65rem] font-semibold uppercase tracking-widest text-accent">
        Projects
      </div>

      <div className="mb-4 flex items-end gap-2">
        {creating ? (
          <form onSubmit={handleCreate} className="flex items-end gap-2">
            <div>
              <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
                New Project Name
              </label>
              <Input
                value={newProject}
                onChange={(e) => setNewProject(e.target.value)}
                placeholder="project-name"
                autoFocus
                className="border-border bg-background font-mono text-sm w-[220px]"
              />
            </div>
            <Button type="submit" size="sm" className="text-[0.65rem] uppercase tracking-widest">
              Create
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
          </form>
        ) : (
          <Button
            size="sm"
            className="text-[0.65rem] uppercase tracking-widest"
            onClick={() => setCreating(true)}
          >
            + New Project
          </Button>
        )}
      </div>

      <div className="bg-card">
        <DataTable
          columns={columns}
          data={rows}
          keyFn={(row) => row.name}
          expandable={expandRow}
          emptyMessage="No projects yet. Create one above."
        />
      </div>
    </section>
  );
}
