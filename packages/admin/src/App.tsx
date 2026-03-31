import { useAuth } from "@/hooks/use-auth";
import { AuthGate } from "@/components/auth-gate";
import { MetricsStrip } from "@/components/metrics-strip";
import { ServerLogs } from "@/components/server-logs";
import { RegisterForm } from "@/components/register-form";
import { ProjectsTable } from "@/components/projects-table";
import { NodesTable } from "@/components/nodes-table";
import { SignalFlow } from "@/components/signal-flow";
import { useMetrics, useNodes } from "@/hooks/queries";
import { useSignalStream } from "@/hooks/use-signal-stream";

export default function App() {
  const { adminKey, setAdminKey, isAuthed } = useAuth();
  const metrics = useMetrics(isAuthed);
  const nodes = useNodes(adminKey);
  const { logs, signals } = useSignalStream(isAuthed ? adminKey : "");

  return (
    <div className="mx-auto max-w-[960px] px-[clamp(1rem,3vw,2rem)] py-8 font-sans">
      <header className="mb-8 text-center">
        <h1 className="font-sans text-[clamp(1.2rem,3vw,1.6rem)] font-bold tracking-tight text-foreground">
          admin
        </h1>
      </header>

      <AuthGate adminKey={adminKey} onKeyChange={setAdminKey} isAuthed={isAuthed} />

      {!isAuthed ? (
        <RegisterForm />
      ) : (
        <>
          <MetricsStrip metrics={metrics.data} changedFields={metrics.changedFields} />
          <ProjectsTable adminKey={adminKey} />
          <NodesTable adminKey={adminKey} />
          <SignalFlow
            connectedNodes={nodes.data ?? []}
            signals={signals}
            isAuthed={isAuthed}
          />
          <ServerLogs
            logs={logs}
            signals={signals}
            connectedNodes={nodes.data ?? []}
            isAuthed={isAuthed}
          />
        </>
      )}
    </div>
  );
}
