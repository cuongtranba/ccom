import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TokenCreateFormProps {
  disabled: boolean;
  onSubmit: (project: string, nodeId: string) => Promise<void>;
  result: {
    type: "success" | "error";
    message: string;
    token?: string;
    nodeId?: string;
  } | null;
}

export function TokenCreateForm({
  disabled,
  onSubmit,
  result,
}: TokenCreateFormProps) {
  const [project, setProject] = useState("");
  const [nodeId, setNodeId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!project.trim() || !nodeId.trim()) return;
    setSubmitting(true);
    setCopied(false);
    await onSubmit(project.trim(), nodeId.trim());
    setProject("");
    setNodeId("");
    setSubmitting(false);
  }

  async function copyToken(token: string) {
    await navigator.clipboard.writeText(token);
    setCopied(true);
  }

  return (
    <section className="mb-12">
      <div className="mb-5 border-b border-sand-dim pb-2 text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-accent">
        Issue Credential
      </div>
      <form onSubmit={handleSubmit} className="mb-6 flex items-end gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
            Project
          </label>
          <Input
            placeholder="e.g. clinic-checkin"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            disabled={disabled}
            className="border-border bg-background"
          />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
            Node ID
          </label>
          <Input
            placeholder="e.g. dev-node"
            value={nodeId}
            onChange={(e) => setNodeId(e.target.value)}
            disabled={disabled}
            className="border-border bg-background"
          />
        </div>
        <Button
          type="submit"
          disabled={disabled || submitting}
          className="bg-primary text-primary-foreground hover:bg-spice-bright"
        >
          Create
        </Button>
      </form>

      {result && (
        <div
          className={cn(
            "border-l-2 bg-card p-3 font-mono text-[0.78rem]",
            result.type === "success"
              ? "border-success text-foreground"
              : "border-destructive text-destructive",
          )}
        >
          {result.type === "success" && result.token ? (
            <>
              Token created for <strong>{result.nodeId}</strong> — click to copy
              <br />
              <span
                className="cursor-pointer text-primary hover:text-spice-bright"
                onClick={() => copyToken(result.token!)}
              >
                {copied ? "copied!" : result.token}
              </span>
            </>
          ) : (
            result.message
          )}
        </div>
      )}
    </section>
  );
}
