import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ProjectCreateFormProps {
  disabled: boolean;
  onSubmit: (project: string) => Promise<void>;
  result: { type: "success" | "error"; message: string } | null;
}

export function ProjectCreateForm({
  disabled,
  onSubmit,
  result,
}: ProjectCreateFormProps) {
  const [project, setProject] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!project.trim()) return;
    setSubmitting(true);
    await onSubmit(project.trim());
    setProject("");
    setSubmitting(false);
  }

  return (
    <section className="mb-12">
      <div className="mb-5 border-b border-sand-dim pb-2 text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-accent">
        Create Project
      </div>
      <form onSubmit={handleSubmit} className="mb-6 flex items-end gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
            Project Name
          </label>
          <Input
            placeholder="e.g. clinic-checkin"
            value={project}
            onChange={(e) => setProject(e.target.value)}
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
          {result.message}
        </div>
      )}
    </section>
  );
}
