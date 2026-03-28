import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Metrics } from "@/lib/api";

interface MetricsStripProps {
  metrics: Metrics | null;
  changedFields: Set<keyof Metrics>;
}

const METRIC_CONFIG: { key: keyof Metrics; label: string }[] = [
  { key: "connections_active", label: "Active" },
  { key: "messages_routed", label: "Routed" },
  { key: "messages_enqueued", label: "Enqueued" },
  { key: "messages_cross_instance", label: "Cross-Instance" },
  { key: "drains_total", label: "Drains" },
  { key: "drain_messages_total", label: "Drained Msgs" },
];

export function MetricsStrip({ metrics, changedFields }: MetricsStripProps) {
  return (
    <div className="mb-12 grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-px bg-sand-dim">
      {METRIC_CONFIG.map(({ key, label }) => {
        const value = metrics ? metrics[key] : null;
        const isZero = value === 0;
        const isPulsing = changedFields.has(key);

        return (
          <Card key={key} className="rounded-none border-0 bg-card">
            <CardContent className="p-4">
              <div
                className={cn(
                  "text-[1.6rem] font-bold leading-tight tabular-nums",
                  isZero ? "text-border" : "text-primary",
                  isPulsing && "animate-pulse-metric",
                )}
              >
                {value ?? "--"}
              </div>
              <div className="mt-1 text-[0.65rem] font-medium uppercase tracking-widest text-muted-foreground">
                {label}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
