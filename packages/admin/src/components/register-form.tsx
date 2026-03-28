import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchPublicProjects, registerNode, type RegisterResponse } from "@/lib/api";
import { slugify } from "@/lib/utils";

export function RegisterForm() {
  const [project, setProject] = useState("");
  const [nodeId, setNodeId] = useState("");
  const [name, setName] = useState("");
  const [vertical, setVertical] = useState("");
  const [owner, setOwner] = useState("");
  const [result, setResult] = useState<RegisterResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: projects = [], isLoading: loadingProjects } = useQuery<string[]>({
    queryKey: ["public-projects"],
    queryFn: fetchPublicProjects,
  });

  const mutation = useMutation({
    mutationFn: () =>
      registerNode({
        project,
        nodeId: slugify(nodeId),
        name,
        vertical,
        owner,
      }),
    onSuccess: (res) => {
      setResult(res);
    },
  });

  async function handleCopy() {
    if (!result) return;
    await navigator.clipboard.writeText(result.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  if (result) {
    return (
      <section className="mb-10">
        <div className="mb-5 border-b border-sand-dim pb-2 text-[0.65rem] font-semibold uppercase tracking-widest text-accent">
          Registration Complete
        </div>
        <div className="bg-card p-6">
          <p className="mb-4 text-sm text-muted-foreground">
            Node <span className="font-semibold text-foreground">{result.nodeId}</span> registered
            to project <span className="font-semibold text-foreground">{result.project}</span>.
            Save your token — it will not be shown again.
          </p>
          <div className="mb-4">
            <div className="mb-1 text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
              Token Secret
            </div>
            <button
              type="button"
              className="w-full cursor-pointer rounded border border-border bg-background px-3 py-2 text-left font-mono text-xs text-foreground hover:bg-muted/50 focus:outline-none focus:ring-1 focus:ring-primary"
              onClick={handleCopy}
              title="Click to copy"
            >
              {result.token}
            </button>
            <p className="mt-1 text-[0.65rem] text-muted-foreground">
              {copied ? "Copied!" : "Click to copy"}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="text-[0.65rem] uppercase tracking-widest"
            onClick={() => {
              setResult(null);
              setProject("");
              setNodeId("");
              setName("");
              setVertical("");
              setOwner("");
            }}
          >
            Register Another
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-10">
      <div className="mb-5 border-b border-sand-dim pb-2 text-[0.65rem] font-semibold uppercase tracking-widest text-accent">
        Node Registration
      </div>
      <div className="bg-card p-6">
        <p className="mb-6 text-sm text-muted-foreground">
          Register your node to join an existing project and receive a token.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="reg-project" className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
              Project
            </label>
            <select
              id="reg-project"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              required
              disabled={loadingProjects}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">
                {loadingProjects ? "Loading projects..." : "Select a project"}
              </option>
              {projects.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
                Node ID
              </label>
              <Input
                value={nodeId}
                onChange={(e) => setNodeId(e.target.value)}
                placeholder="my-node"
                required
                className="border-border bg-background font-mono text-sm"
              />
              {nodeId && slugify(nodeId) !== nodeId && (
                <p className="mt-0.5 text-[0.65rem] text-muted-foreground">
                  Will be saved as: <span className="font-mono">{slugify(nodeId)}</span>
                </p>
              )}
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
          </div>

          <div className="grid grid-cols-2 gap-4">
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

          {mutation.isError && (
            <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
          )}

          <div>
            <Button
              type="submit"
              disabled={mutation.isPending || !project}
              className="text-[0.65rem] uppercase tracking-widest"
            >
              {mutation.isPending ? "Registering..." : "Register Node"}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}
