import { useAuth } from "@/hooks/use-auth";
import { useMetrics } from "@/hooks/use-metrics";
import { useTokens } from "@/hooks/use-tokens";
import { AuthGate } from "@/components/auth-gate";
import { MetricsStrip } from "@/components/metrics-strip";
import { TokenCreateForm } from "@/components/token-create-form";
import { TokenList } from "@/components/token-list";

export default function App() {
  const { adminKey, setAdminKey, isAuthed } = useAuth();
  const { metrics, changed } = useMetrics(true);
  const {
    tokens,
    currentProject,
    loading,
    createResult,
    loadTokens,
    create,
    revoke,
  } = useTokens(adminKey);

  return (
    <div className="mx-auto max-w-[860px] px-[clamp(1rem,3vw,2rem)] py-[clamp(2rem,5vw,4rem)]">
      <header className="mb-12">
        <div className="mb-2 text-[0.7rem] font-medium uppercase tracking-[0.25em] text-spice-dim">
          Spacing Guild Console
        </div>
        <h1 className="text-[clamp(1.6rem,4vw,2.2rem)] font-bold leading-tight tracking-tight">
          inv-server <span className="text-primary">command post</span>
        </h1>
        <div className="mt-1 text-sm text-muted-foreground">
          Token management and signal monitoring
        </div>
      </header>

      <AuthGate
        adminKey={adminKey}
        onKeyChange={setAdminKey}
        isAuthed={isAuthed}
      />

      <MetricsStrip metrics={metrics} changed={changed} />

      <TokenCreateForm
        disabled={!isAuthed}
        onSubmit={create}
        result={createResult}
      />

      <TokenList
        disabled={!isAuthed}
        tokens={tokens}
        currentProject={currentProject}
        loading={loading}
        onLoad={loadTokens}
        onRevoke={revoke}
      />
    </div>
  );
}
