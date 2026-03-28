import { useAuth } from "@/hooks/use-auth";
import { AuthGate } from "@/components/auth-gate";
import { MetricsStrip } from "@/components/metrics-strip";
import { ConnectedNodes } from "@/components/connected-nodes";
import { ServerLogs } from "@/components/server-logs";
import { RegisterForm } from "@/components/register-form";
import { ProjectsTable } from "@/components/projects-table";
import { NodesTable } from "@/components/nodes-table";
import { useMetrics, useNodes, useLogs } from "@/hooks/queries";

export default function App() {
  const { adminKey, setAdminKey, isAuthed } = useAuth();
  const metrics = useMetrics(isAuthed);
  const nodes = useNodes(adminKey);
  const logs = useLogs(adminKey);

  return (
    <div className="mx-auto max-w-[960px] px-[clamp(1rem,3vw,2rem)] py-8 font-sans">
      <header className="mb-8 text-center">
        <h1 className="font-sans text-[clamp(1.2rem,3vw,1.6rem)] font-bold tracking-tight text-foreground">
          Spacing Guild Console
        </h1>
        <p className="text-xs text-muted-foreground">inventory network control</p>
      </header>

      <AuthGate adminKey={adminKey} onKeyChange={setAdminKey} isAuthed={isAuthed} />

      {!isAuthed ? (
        <RegisterForm />
      ) : (
        <>
          <MetricsStrip metrics={metrics.data} changedFields={metrics.changedFields} />
          <ProjectsTable adminKey={adminKey} />
          <NodesTable adminKey={adminKey} />
          <ConnectedNodes
            nodes={nodes.data ?? []}
            isAuthed={isAuthed}
            onDisconnect={nodes.disconnect}
          />
          <ServerLogs logs={logs.data ?? []} isAuthed={isAuthed} />
        </>
      )}
    </div>
  );
}
