# Admin React Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the server's inline admin.html into a Vite + React + TypeScript + shadcn/ui app at `packages/admin/`, add connected-nodes and server-logs features, and serve the built output from the Bun server at `/admin`.

**Architecture:** New `packages/admin/` React SPA built with Vite. The Bun server in `packages/server/` serves the static dist at `/admin` and `/admin/assets/*`. Two new server endpoints (`/api/nodes`, `/api/logs`) expose connection info and an in-memory log ring buffer. The Dune desert oklch theme is mapped to shadcn/ui CSS variables.

**Tech Stack:** Vite, React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Bun (server runtime)

---

## File Map

### New files — `packages/admin/`

| File | Responsibility |
|------|---------------|
| `package.json` | Package config, scripts (dev/build/preview) |
| `vite.config.ts` | Vite config: base `/admin/`, proxy to server in dev |
| `tsconfig.json` | TypeScript config extending root |
| `tsconfig.app.json` | App-specific TS config for Vite |
| `tailwind.config.ts` | Tailwind theme with Dune desert oklch palette |
| `components.json` | shadcn/ui config |
| `postcss.config.js` | PostCSS for Tailwind |
| `index.html` | Vite HTML entry |
| `src/main.tsx` | React root mount |
| `src/App.tsx` | Top-level layout, renders all sections |
| `src/lib/api.ts` | Typed fetch wrappers for all server endpoints |
| `src/lib/utils.ts` | `cn()` helper for shadcn class merging |
| `src/hooks/use-auth.ts` | Admin key state + localStorage sync |
| `src/hooks/use-metrics.ts` | Poll `GET /metrics` every 3s |
| `src/hooks/use-tokens.ts` | Token CRUD state + auto-refresh |
| `src/hooks/use-nodes.ts` | Poll `GET /api/nodes` every 5s |
| `src/hooks/use-logs.ts` | Poll `GET /api/logs` every 3s |
| `src/components/auth-gate.tsx` | Password input + status badge |
| `src/components/metrics-strip.tsx` | 6-metric responsive grid |
| `src/components/token-create-form.tsx` | Create credential form |
| `src/components/token-list.tsx` | Credential list with revoke |
| `src/components/connected-nodes.tsx` | Connected WebSocket nodes table |
| `src/components/server-logs.tsx` | Scrollable log viewer |
| `src/styles/globals.css` | Tailwind base + Dune theme CSS vars + animations |
| `src/components/ui/*` | shadcn/ui generated components (card, input, button, badge, table, alert-dialog, scroll-area) |

### New files — `packages/server/src/`

| File | Responsibility |
|------|---------------|
| `log-buffer.ts` | In-memory ring buffer for server events |

### Modified files — `packages/server/`

| File | Changes |
|------|---------|
| `src/hub.ts` | Add `listConnections()` method returning connected node metadata |
| `src/index.ts` | Add `/api/nodes`, `/api/logs` endpoints; replace admin.html with static file serving; integrate LogBuffer |

### Modified files — root

| File | Changes |
|------|---------|
| `package.json` | Add `build:admin` script |

### Deleted files

| File | Reason |
|------|--------|
| `packages/server/src/admin.html` | Replaced by React app |

---

## Task 1: Scaffold `packages/admin/` with Vite + React + TypeScript

**Files:**
- Create: `packages/admin/package.json`
- Create: `packages/admin/vite.config.ts`
- Create: `packages/admin/tsconfig.json`
- Create: `packages/admin/tsconfig.app.json`
- Create: `packages/admin/index.html`
- Create: `packages/admin/src/main.tsx`
- Create: `packages/admin/src/App.tsx`
- Create: `packages/admin/src/vite-env.d.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@inv/admin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@types/react": "^19.1.2",
    "@types/react-dom": "^19.1.2",
    "@vitejs/plugin-react": "^4.4.1",
    "typescript": "~5.7.2",
    "vite": "^6.3.1"
  }
}
```

- [ ] **Step 2: Create vite.config.ts**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  base: "/admin/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/metrics": "http://localhost:4400",
      "/api": "http://localhost:4400",
    },
  },
});
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" }
  ]
}
```

- [ ] **Step 4: Create tsconfig.app.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>inv-server // command post</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create src/vite-env.d.ts**

```typescript
/// <reference types="vite/client" />
```

- [ ] **Step 7: Create src/main.tsx**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 8: Create src/App.tsx (placeholder)**

```tsx
export default function App() {
  return <div>admin loaded</div>;
}
```

- [ ] **Step 9: Install dependencies**

Run: `cd packages/admin && pnpm install`

- [ ] **Step 10: Verify dev server starts**

Run: `cd packages/admin && pnpm dev`
Expected: Vite dev server starts on port 5173, page shows "admin loaded"

- [ ] **Step 11: Commit**

```bash
git add packages/admin/
git commit -m "feat(admin): scaffold Vite + React + TypeScript package"
```

---

## Task 2: Add Tailwind CSS + shadcn/ui with Dune Desert Theme

**Files:**
- Create: `packages/admin/postcss.config.js`
- Create: `packages/admin/tailwind.config.ts`
- Create: `packages/admin/components.json`
- Create: `packages/admin/src/styles/globals.css`
- Create: `packages/admin/src/lib/utils.ts`
- Modify: `packages/admin/package.json` (add tailwind + shadcn deps)
- Modify: `packages/admin/src/main.tsx` (import globals.css)
- Modify: `packages/admin/index.html` (add dark class to html)

- [ ] **Step 1: Install Tailwind + shadcn dependencies**

Run: `cd packages/admin && pnpm add tailwindcss @tailwindcss/vite clsx tailwind-merge class-variance-authority lucide-react`

- [ ] **Step 2: Update vite.config.ts to add Tailwind plugin**

Replace `packages/admin/vite.config.ts` with:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/admin/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/metrics": "http://localhost:4400",
      "/api": "http://localhost:4400",
    },
  },
});
```

- [ ] **Step 3: Create src/styles/globals.css**

```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: oklch(0.12 0.02 65);
  --color-foreground: oklch(0.82 0.04 70);

  --color-card: oklch(0.16 0.025 65);
  --color-card-foreground: oklch(0.82 0.04 70);

  --color-popover: oklch(0.16 0.025 65);
  --color-popover-foreground: oklch(0.82 0.04 70);

  --color-primary: oklch(0.72 0.16 55);
  --color-primary-foreground: oklch(0.12 0.02 65);

  --color-secondary: oklch(0.38 0.05 65);
  --color-secondary-foreground: oklch(0.82 0.04 70);

  --color-muted: oklch(0.22 0.03 65);
  --color-muted-foreground: oklch(0.55 0.03 65);

  --color-accent: oklch(0.78 0.14 85);
  --color-accent-foreground: oklch(0.55 0.08 85);

  --color-destructive: oklch(0.60 0.18 25);
  --color-destructive-foreground: oklch(0.12 0.02 65);

  --color-success: oklch(0.65 0.14 145);
  --color-success-foreground: oklch(0.12 0.02 65);

  --color-border: oklch(0.28 0.04 65);
  --color-input: oklch(0.28 0.04 65);
  --color-ring: oklch(0.62 0.12 250);

  --color-spice-bright: oklch(0.82 0.18 55);
  --color-spice-dim: oklch(0.50 0.10 55);
  --color-sand-dim: oklch(0.22 0.03 65);
  --color-deep: oklch(0.16 0.025 65);

  --radius: 0.25rem;

  --font-sans: "Space Grotesk", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", monospace;
}

body {
  @apply bg-background text-foreground antialiased;
  min-height: 100vh;
  background:
    radial-gradient(ellipse 80% 50% at 20% 0%, oklch(0.18 0.04 55 / 0.4), transparent),
    radial-gradient(ellipse 60% 40% at 80% 100%, oklch(0.15 0.03 45 / 0.3), transparent),
    oklch(0.12 0.02 65);
}

@keyframes pulse-metric {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.animate-pulse-metric {
  animation: pulse-metric 2s ease-in-out infinite;
}
```

- [ ] **Step 4: Create src/lib/utils.ts**

```typescript
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 5: Create components.json**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

- [ ] **Step 6: Update index.html — add dark class**

Change the `<html>` tag to:
```html
<html lang="en" class="dark">
```

- [ ] **Step 7: Update src/main.tsx — import globals.css**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 8: Install shadcn/ui components**

Run:
```bash
cd packages/admin
pnpm dlx shadcn@latest add card input button badge table alert-dialog scroll-area
```

If the CLI prompts for config, select: New York style, no RSC, aliases as defined in components.json.

- [ ] **Step 9: Update App.tsx to verify theme**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function App() {
  return (
    <div className="mx-auto max-w-[860px] p-8">
      <h1 className="text-2xl font-bold">
        inv-server <span className="text-primary">command post</span>
      </h1>
      <Card className="mt-4 border-border bg-card">
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-widest text-muted-foreground">
            Theme Check
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button>Spice Button</Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 10: Verify theme renders correctly**

Run: `cd packages/admin && pnpm dev`
Expected: Dark background with oklch desert palette, spice-colored button, Space Grotesk font

- [ ] **Step 11: Commit**

```bash
git add packages/admin/
git commit -m "feat(admin): add Tailwind + shadcn/ui with Dune desert theme"
```

---

## Task 3: API Layer + Auth Hook

**Files:**
- Create: `packages/admin/src/lib/api.ts`
- Create: `packages/admin/src/hooks/use-auth.ts`

- [ ] **Step 1: Create src/lib/api.ts**

```typescript
export interface Metrics {
  connections_active: number;
  messages_routed: number;
  messages_enqueued: number;
  messages_cross_instance: number;
  drains_total: number;
  drain_messages_total: number;
}

export interface TokenInfo {
  nodeId: string;
  createdAt: string;
}

export interface CreateTokenResponse {
  token: string;
  project: string;
  nodeId: string;
}

export interface ConnectedNode {
  nodeId: string;
  project: string;
  connectedAt: string;
  lastMessageAt: string | null;
}

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  meta?: Record<string, string>;
}

function authHeaders(adminKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${adminKey}`,
    "Content-Type": "application/json",
  };
}

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export async function fetchMetrics(): Promise<Metrics> {
  const res = await fetch("/metrics");
  return handleResponse<Metrics>(res);
}

export async function createToken(
  adminKey: string,
  project: string,
  nodeId: string,
): Promise<CreateTokenResponse> {
  const res = await fetch("/api/token/create", {
    method: "POST",
    headers: authHeaders(adminKey),
    body: JSON.stringify({ project, nodeId }),
  });
  return handleResponse<CreateTokenResponse>(res);
}

export async function listTokens(
  adminKey: string,
  project: string,
): Promise<TokenInfo[]> {
  const res = await fetch(
    `/api/token/list?project=${encodeURIComponent(project)}`,
    { headers: authHeaders(adminKey) },
  );
  const data = await handleResponse<{ project: string; tokens: TokenInfo[] }>(res);
  return data.tokens;
}

export async function revokeToken(
  adminKey: string,
  token: string,
): Promise<void> {
  const res = await fetch("/api/token/revoke", {
    method: "POST",
    headers: authHeaders(adminKey),
    body: JSON.stringify({ token }),
  });
  await handleResponse<{ revoked: boolean }>(res);
}

export async function fetchNodes(
  adminKey: string,
): Promise<ConnectedNode[]> {
  const res = await fetch("/api/nodes", {
    headers: authHeaders(adminKey),
  });
  const data = await handleResponse<{ nodes: ConnectedNode[] }>(res);
  return data.nodes;
}

export async function fetchLogs(
  adminKey: string,
): Promise<LogEntry[]> {
  const res = await fetch("/api/logs", {
    headers: authHeaders(adminKey),
  });
  const data = await handleResponse<{ logs: LogEntry[] }>(res);
  return data.logs;
}
```

- [ ] **Step 2: Create src/hooks/use-auth.ts**

```typescript
import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "inv_admin_key";

export function useAuth() {
  const [adminKey, setAdminKeyState] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) ?? "",
  );

  const setAdminKey = useCallback((key: string) => {
    const trimmed = key.trim();
    setAdminKeyState(trimmed);
    if (trimmed) {
      localStorage.setItem(STORAGE_KEY, trimmed);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const isAuthed = adminKey.length > 0;

  return { adminKey, setAdminKey, isAuthed } as const;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/admin/src/lib/api.ts packages/admin/src/hooks/use-auth.ts
git commit -m "feat(admin): add typed API layer and auth hook"
```

---

## Task 4: AuthGate + Metrics Components

**Files:**
- Create: `packages/admin/src/components/auth-gate.tsx`
- Create: `packages/admin/src/components/metrics-strip.tsx`
- Create: `packages/admin/src/hooks/use-metrics.ts`
- Modify: `packages/admin/src/App.tsx`

- [ ] **Step 1: Create src/hooks/use-metrics.ts**

```typescript
import { useState, useEffect, useRef } from "react";
import { fetchMetrics, type Metrics } from "@/lib/api";

export function useMetrics(enabled: boolean) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prevRef = useRef<Metrics | null>(null);
  const [changed, setChanged] = useState<Set<keyof Metrics>>(new Set());

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    async function poll() {
      try {
        const m = await fetchMetrics();
        if (cancelled) return;

        const prev = prevRef.current;
        if (prev) {
          const diff = new Set<keyof Metrics>();
          for (const key of Object.keys(m) as (keyof Metrics)[]) {
            if (m[key] !== prev[key]) diff.add(key);
          }
          setChanged(diff);
        }

        prevRef.current = m;
        setMetrics(m);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Fetch failed");
      }
    }

    poll();
    const id = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled]);

  return { metrics, error, changed };
}
```

- [ ] **Step 2: Create src/components/auth-gate.tsx**

```tsx
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface AuthGateProps {
  adminKey: string;
  onKeyChange: (key: string) => void;
  isAuthed: boolean;
}

export function AuthGate({ adminKey, onKeyChange, isAuthed }: AuthGateProps) {
  return (
    <div
      className={`mb-10 flex items-end gap-3 border-l-2 bg-card p-5 ${
        isAuthed ? "border-success" : "border-border"
      }`}
    >
      <div className="flex-1">
        <label className="mb-1 block text-[0.7rem] font-semibold uppercase tracking-widest text-muted-foreground">
          Admin Key
        </label>
        <Input
          type="password"
          placeholder="Enter ADMIN_KEY to authenticate"
          value={adminKey}
          onChange={(e) => onKeyChange(e.target.value)}
          className="border-border bg-background font-mono text-sm"
          autoComplete="off"
        />
      </div>
      <Badge
        variant={isAuthed ? "default" : "secondary"}
        className={`mb-1 ${isAuthed ? "bg-success text-success-foreground" : ""}`}
      >
        {isAuthed ? "ready" : "not authenticated"}
      </Badge>
    </div>
  );
}
```

- [ ] **Step 3: Create src/components/metrics-strip.tsx**

```tsx
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Metrics } from "@/lib/api";

interface MetricsStripProps {
  metrics: Metrics | null;
  changed: Set<keyof Metrics>;
}

const METRIC_CONFIG: { key: keyof Metrics; label: string }[] = [
  { key: "connections_active", label: "Active" },
  { key: "messages_routed", label: "Routed" },
  { key: "messages_enqueued", label: "Enqueued" },
  { key: "messages_cross_instance", label: "Cross-Instance" },
  { key: "drains_total", label: "Drains" },
  { key: "drain_messages_total", label: "Drained Msgs" },
];

export function MetricsStrip({ metrics, changed }: MetricsStripProps) {
  return (
    <div className="mb-12 grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-px bg-sand-dim">
      {METRIC_CONFIG.map(({ key, label }) => {
        const value = metrics ? metrics[key] : null;
        const isZero = value === 0;
        const isPulsing = changed.has(key);

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
```

- [ ] **Step 4: Update App.tsx to wire AuthGate + Metrics**

```tsx
import { useAuth } from "@/hooks/use-auth";
import { useMetrics } from "@/hooks/use-metrics";
import { AuthGate } from "@/components/auth-gate";
import { MetricsStrip } from "@/components/metrics-strip";

export default function App() {
  const { adminKey, setAdminKey, isAuthed } = useAuth();
  const { metrics, changed } = useMetrics(true);

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
    </div>
  );
}
```

- [ ] **Step 5: Verify in browser**

Run: `cd packages/admin && pnpm dev`
Expected: Header with "Spacing Guild Console", auth gate with password input and status badge, metrics strip with 6 cards showing "--" (or live values if server is running)

- [ ] **Step 6: Commit**

```bash
git add packages/admin/src/
git commit -m "feat(admin): add auth gate and metrics strip components"
```

---

## Task 5: Token Management Components (with auto-show fix)

**Files:**
- Create: `packages/admin/src/hooks/use-tokens.ts`
- Create: `packages/admin/src/components/token-create-form.tsx`
- Create: `packages/admin/src/components/token-list.tsx`
- Modify: `packages/admin/src/App.tsx`

- [ ] **Step 1: Create src/hooks/use-tokens.ts**

```typescript
import { useState, useCallback } from "react";
import {
  createToken,
  listTokens,
  revokeToken,
  type TokenInfo,
  type CreateTokenResponse,
} from "@/lib/api";

interface CreateResult {
  type: "success" | "error";
  message: string;
  token?: string;
  nodeId?: string;
}

export function useTokens(adminKey: string) {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [currentProject, setCurrentProject] = useState("");
  const [loading, setLoading] = useState(false);
  const [createResult, setCreateResult] = useState<CreateResult | null>(null);

  const loadTokens = useCallback(
    async (project: string) => {
      if (!adminKey || !project) return;
      setLoading(true);
      try {
        const list = await listTokens(adminKey, project);
        setTokens(list);
        setCurrentProject(project);
      } catch (err) {
        setTokens([]);
      } finally {
        setLoading(false);
      }
    },
    [adminKey],
  );

  const create = useCallback(
    async (project: string, nodeId: string) => {
      if (!adminKey) return;
      try {
        const res = await createToken(adminKey, project, nodeId);
        setCreateResult({
          type: "success",
          message: `Token created for ${res.nodeId}`,
          token: res.token,
          nodeId: res.nodeId,
        });
        // Auto-refresh: load the token list for this project immediately
        await loadTokens(project);
      } catch (err) {
        setCreateResult({
          type: "error",
          message: err instanceof Error ? err.message : "Failed",
        });
      }
    },
    [adminKey, loadTokens],
  );

  const revoke = useCallback(
    async (token: string) => {
      if (!adminKey) return;
      await revokeToken(adminKey, token);
      // Refresh list after revoke
      if (currentProject) {
        await loadTokens(currentProject);
      }
    },
    [adminKey, currentProject, loadTokens],
  );

  return {
    tokens,
    currentProject,
    loading,
    createResult,
    loadTokens,
    create,
    revoke,
    clearResult: () => setCreateResult(null),
  } as const;
}
```

- [ ] **Step 2: Create src/components/token-create-form.tsx**

```tsx
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
            "animate-in fade-in border-l-2 bg-card p-3 font-mono text-[0.78rem]",
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
```

- [ ] **Step 3: Create src/components/token-list.tsx**

```tsx
import { useState } from "react";
import { Input } from "@/components/ui/input";
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
import type { TokenInfo } from "@/lib/api";

interface TokenListProps {
  disabled: boolean;
  tokens: TokenInfo[];
  currentProject: string;
  loading: boolean;
  onLoad: (project: string) => Promise<void>;
  onRevoke: (token: string) => Promise<void>;
}

export function TokenList({
  disabled,
  tokens,
  currentProject,
  loading,
  onLoad,
  onRevoke,
}: TokenListProps) {
  const [project, setProject] = useState(currentProject);
  const [revokeToken, setRevokeToken] = useState("");

  // Sync external project changes (from auto-refresh after create)
  if (currentProject && currentProject !== project) {
    setProject(currentProject);
  }

  async function handleLoad(e: React.FormEvent) {
    e.preventDefault();
    if (!project.trim()) return;
    await onLoad(project.trim());
  }

  async function handleRevoke() {
    if (!revokeToken) return;
    await onRevoke(revokeToken);
    setRevokeToken("");
  }

  return (
    <section className="mb-12">
      <div className="mb-5 border-b border-sand-dim pb-2 text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-accent">
        Active Credentials
      </div>
      <form onSubmit={handleLoad} className="mb-4 flex items-end gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
            Project
          </label>
          <Input
            placeholder="Project to list"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            disabled={disabled}
            className="border-border bg-background"
          />
        </div>
        <Button
          type="submit"
          disabled={disabled || loading}
          className="bg-primary text-primary-foreground hover:bg-spice-bright"
        >
          Load
        </Button>
      </form>

      {currentProject && tokens.length === 0 && !loading && (
        <div className="bg-card p-8 text-sm text-muted-foreground">
          No credentials issued for this project yet.
        </div>
      )}

      {tokens.length > 0 && (
        <div className="flex flex-col gap-px bg-sand-dim">
          {tokens.map((t, i) => (
            <div
              key={`${t.nodeId}-${i}`}
              className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-4 bg-card px-4 py-3"
            >
              <div className="font-semibold">{t.nodeId}</div>
              <div className="font-mono text-xs text-muted-foreground">
                {new Date(t.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
              <div className="max-w-[160px] truncate font-mono text-xs text-border">
                token:hidden
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                    onClick={() => {
                      const token = prompt(
                        `Enter the token for ${t.nodeId} to revoke it:`,
                      );
                      if (token) setRevokeToken(token);
                    }}
                    disabled={disabled}
                  >
                    Revoke
                  </Button>
                </AlertDialogTrigger>
                {revokeToken && (
                  <AlertDialogContent className="border-border bg-card">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Revoke credential?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This disconnects the node immediately and cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel onClick={() => setRevokeToken("")}>
                        Cancel
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleRevoke}
                        className="bg-destructive text-destructive-foreground"
                      >
                        Revoke
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                )}
              </AlertDialog>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Update App.tsx — add token section**

```tsx
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
```

- [ ] **Step 5: Verify token create auto-shows in list**

Run: `cd packages/admin && pnpm dev` (with server running on 4400)
Test: Enter admin key → create a token → verify the Active Credentials list auto-populates with the new token's project, showing the new entry immediately.

- [ ] **Step 6: Commit**

```bash
git add packages/admin/src/
git commit -m "feat(admin): add token create/list/revoke with auto-show on create"
```

---

## Task 6: Server — LogBuffer + Hub listConnections

**Files:**
- Create: `packages/server/src/log-buffer.ts`
- Modify: `packages/server/src/hub.ts`

- [ ] **Step 1: Create src/log-buffer.ts**

```typescript
export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  meta?: Record<string, string>;
}

export class LogBuffer {
  private buffer: LogEntry[] = [];
  private maxSize: number;

  constructor(maxSize = 200) {
    this.maxSize = maxSize;
  }

  push(level: LogEntry["level"], message: string, meta?: Record<string, string>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      meta,
    };
    this.buffer.push(entry);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  info(message: string, meta?: Record<string, string>): void {
    this.push("info", message, meta);
  }

  warn(message: string, meta?: Record<string, string>): void {
    this.push("warn", message, meta);
  }

  error(message: string, meta?: Record<string, string>): void {
    this.push("error", message, meta);
  }

  entries(): LogEntry[] {
    return [...this.buffer];
  }
}
```

- [ ] **Step 2: Add connection metadata tracking to hub.ts**

Add a `ConnectedNode` interface and `connMeta` map to `RedisHub`. Add `listConnections()` method.

At the top of `packages/server/src/hub.ts`, after the existing `HubMetrics` interface, add:

```typescript
export interface ConnectedNode {
  nodeId: string;
  project: string;
  connectedAt: string;
  lastMessageAt: string | null;
}
```

Inside the `RedisHub` class, after the `private counters` field, add:

```typescript
  private connMeta = new Map<string, { project: string; nodeId: string; connectedAt: string; lastMessageAt: string | null }>();
```

Modify the `register` method — after `this.localConns.set(connKey, ws);` add:

```typescript
    this.connMeta.set(connKey, {
      project: projectId,
      nodeId,
      connectedAt: new Date().toISOString(),
      lastMessageAt: null,
    });
```

Modify the `unregister` method — after `this.localConns.delete(connKey);` add:

```typescript
    this.connMeta.delete(connKey);
```

Add a new public method after `getMetrics()`:

```typescript
  /** Returns metadata for all locally connected nodes. */
  listConnections(): ConnectedNode[] {
    return Array.from(this.connMeta.values());
  }
```

Modify the `shutdown` method — after `this.localConns.clear();` add:

```typescript
    this.connMeta.clear();
```

- [ ] **Step 3: Track lastMessageAt in deliverTo**

In the `deliverTo` method, after `this.counters.messages_routed++;`, add logic to update `lastMessageAt` for the sender. We need to accept the sender info. Instead, update `lastMessageAt` in a new spot.

Actually, update `lastMessageAt` in the `route` method. At the top of `route()`, before the `if (envelope.toNode)` check, add:

```typescript
    // Update lastMessageAt for the sender
    const senderKey = `${envelope.projectId}:${envelope.fromNode}`;
    const senderMeta = this.connMeta.get(senderKey);
    if (senderMeta) {
      senderMeta.lastMessageAt = new Date().toISOString();
    }
```

- [ ] **Step 4: Run existing server tests to confirm nothing is broken**

Run: `bun test packages/server`
Expected: All existing tests pass (RedisAuth, RedisOutbox, RedisHub)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/log-buffer.ts packages/server/src/hub.ts
git commit -m "feat(server): add LogBuffer and hub connection tracking"
```

---

## Task 7: Server — New API Endpoints + Static File Serving

**Files:**
- Modify: `packages/server/src/index.ts`
- Modify: `packages/admin/package.json` (root)

- [ ] **Step 1: Update imports in index.ts**

At the top of `packages/server/src/index.ts`, replace:

```typescript
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
```

with:

```typescript
import { readFileSync, existsSync, statSync } from "fs";
import { resolve, dirname, join, extname } from "path";
import { fileURLToPath } from "url";
```

Remove the line:
```typescript
const adminHtml = readFileSync(resolve(__dirname, "admin.html"), "utf-8");
```

Add after `const __dirname = ...`:

```typescript
const adminDistDir = resolve(__dirname, "../../admin/dist");
```

Add the `LogBuffer` import after the existing imports:

```typescript
import { LogBuffer } from "./log-buffer";
```

Add the `ConnectedNode` export:

```typescript
export type { ConnectedNode } from "./hub";
```

- [ ] **Step 2: Add LogBuffer instance + log integration inside startServer()**

After `const hub = new RedisHub(...)`, add:

```typescript
  const log = new LogBuffer(200);
  log.info("Server started", { instanceId, port: String(options.port) });
```

- [ ] **Step 3: Add /api/nodes endpoint**

After the `/api/token/revoke` handler block, add:

```typescript
      if (url.pathname === "/api/nodes" && req.method === "GET") {
        const denied = requireAdmin(req);
        if (denied) return denied;
        return Response.json({ nodes: hub.listConnections() });
      }
```

- [ ] **Step 4: Add /api/logs endpoint**

After the `/api/nodes` handler, add:

```typescript
      if (url.pathname === "/api/logs" && req.method === "GET") {
        const denied = requireAdmin(req);
        if (denied) return denied;
        return Response.json({ logs: log.entries() });
      }
```

- [ ] **Step 5: Replace admin.html serving with static file serving**

Replace the `/admin` handler block:

```typescript
      if (url.pathname === "/admin") {
        return new Response(adminHtml, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
```

with:

```typescript
      if (url.pathname === "/admin" || url.pathname === "/admin/") {
        const indexPath = join(adminDistDir, "index.html");
        if (existsSync(indexPath)) {
          return new Response(readFileSync(indexPath, "utf-8"), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
        return new Response("Admin UI not built. Run: pnpm build:admin", { status: 404 });
      }

      if (url.pathname.startsWith("/admin/")) {
        const filePath = join(adminDistDir, url.pathname.replace("/admin/", ""));
        if (existsSync(filePath) && statSync(filePath).isFile()) {
          const mimeTypes: Record<string, string> = {
            ".js": "application/javascript",
            ".css": "text/css",
            ".html": "text/html",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".json": "application/json",
          };
          const ext = extname(filePath);
          const contentType = mimeTypes[ext] ?? "application/octet-stream";
          return new Response(Bun.file(filePath), {
            headers: { "Content-Type": contentType },
          });
        }
      }
```

- [ ] **Step 6: Add log calls for WebSocket lifecycle events**

In the `websocket.open` handler, after `await hub.drainOutbox(...)`, add:

```typescript
        log.info(`Node connected: ${nodeId}`, { projectId, nodeId });
```

In the `websocket.message` handler, in the catch block, before `ws.send(...)`, add:

```typescript
          log.error(`Parse error from ${ws.data.nodeId}: ${errorMsg}`, {
            projectId: ws.data.projectId,
            nodeId: ws.data.nodeId,
          });
```

In the `websocket.close` handler, after `await hub.unregister(...)`, add:

```typescript
        log.info(`Node disconnected: ${nodeId}`, { projectId, nodeId });
```

- [ ] **Step 7: Add build:admin script to root package.json**

In the root `package.json`, add to the `"scripts"` object:

```json
"build:admin": "cd packages/admin && pnpm build"
```

- [ ] **Step 8: Run existing server tests**

Run: `bun test packages/server`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/index.ts package.json
git commit -m "feat(server): add /api/nodes, /api/logs endpoints and static admin serving"
```

---

## Task 8: Connected Nodes Component

**Files:**
- Create: `packages/admin/src/hooks/use-nodes.ts`
- Create: `packages/admin/src/components/connected-nodes.tsx`
- Modify: `packages/admin/src/App.tsx`

- [ ] **Step 1: Create src/hooks/use-nodes.ts**

```typescript
import { useState, useEffect } from "react";
import { fetchNodes, type ConnectedNode } from "@/lib/api";

export function useNodes(adminKey: string) {
  const [nodes, setNodes] = useState<ConnectedNode[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!adminKey) {
      setNodes([]);
      return;
    }

    let cancelled = false;

    async function poll() {
      try {
        const list = await fetchNodes(adminKey);
        if (!cancelled) {
          setNodes(list);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Fetch failed");
      }
    }

    poll();
    const id = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [adminKey]);

  return { nodes, error };
}
```

- [ ] **Step 2: Create src/components/connected-nodes.tsx**

```tsx
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ConnectedNode } from "@/lib/api";

interface ConnectedNodesProps {
  nodes: ConnectedNode[];
  disabled: boolean;
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

export function ConnectedNodes({ nodes, disabled }: ConnectedNodesProps) {
  return (
    <section className="mb-12">
      <div className="mb-5 border-b border-sand-dim pb-2 text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-accent">
        Connected Nodes
      </div>

      {disabled ? (
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
              <TableHead className="text-muted-foreground">Project</TableHead>
              <TableHead className="text-muted-foreground">Connected Since</TableHead>
              <TableHead className="text-muted-foreground">Last Message</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {nodes.map((node) => (
              <TableRow key={`${node.project}:${node.nodeId}`} className="border-sand-dim">
                <TableCell className="font-semibold">{node.nodeId}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {node.project}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {formatRelativeTime(node.connectedAt)}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {node.lastMessageAt
                    ? formatRelativeTime(node.lastMessageAt)
                    : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Update App.tsx — add connected nodes**

Add imports:

```typescript
import { useNodes } from "@/hooks/use-nodes";
import { ConnectedNodes } from "@/components/connected-nodes";
```

In the component body, after `useTokens`:

```typescript
  const { nodes } = useNodes(adminKey);
```

In the JSX, after `<TokenList ... />`:

```tsx
      <ConnectedNodes nodes={nodes} disabled={!isAuthed} />
```

- [ ] **Step 4: Verify in browser**

Run: `cd packages/admin && pnpm dev`
Expected: Connected Nodes section shows "Authenticate to view" or "No nodes currently connected" depending on auth state. With connected nodes, shows a table.

- [ ] **Step 5: Commit**

```bash
git add packages/admin/src/
git commit -m "feat(admin): add connected nodes table component"
```

---

## Task 9: Server Logs Component

**Files:**
- Create: `packages/admin/src/hooks/use-logs.ts`
- Create: `packages/admin/src/components/server-logs.tsx`
- Modify: `packages/admin/src/App.tsx`

- [ ] **Step 1: Create src/hooks/use-logs.ts**

```typescript
import { useState, useEffect } from "react";
import { fetchLogs, type LogEntry } from "@/lib/api";

export function useLogs(adminKey: string) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!adminKey) {
      setLogs([]);
      return;
    }

    let cancelled = false;

    async function poll() {
      try {
        const entries = await fetchLogs(adminKey);
        if (!cancelled) {
          setLogs(entries);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Fetch failed");
      }
    }

    poll();
    const id = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [adminKey]);

  return { logs, error };
}
```

- [ ] **Step 2: Create src/components/server-logs.tsx**

```tsx
import { useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { LogEntry } from "@/lib/api";

interface ServerLogsProps {
  logs: LogEntry[];
  disabled: boolean;
}

const LEVEL_STYLES: Record<string, string> = {
  info: "bg-primary/20 text-primary",
  warn: "bg-accent/20 text-accent",
  error: "bg-destructive/20 text-destructive",
};

export function ServerLogs({ logs, disabled }: ServerLogsProps) {
  const [paused, setPaused] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!paused && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, paused]);

  return (
    <section className="mb-12">
      <div className="mb-5 flex items-center justify-between border-b border-sand-dim pb-2">
        <div className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-accent">
          Server Logs
        </div>
        {!disabled && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPaused(!paused)}
            className="h-6 border-border px-2 text-[0.65rem] uppercase tracking-wider"
          >
            {paused ? "Resume" : "Pause"}
          </Button>
        )}
      </div>

      {disabled ? (
        <div className="bg-card p-8 text-sm text-muted-foreground">
          Authenticate to view server logs.
        </div>
      ) : logs.length === 0 ? (
        <div className="bg-card p-8 text-sm text-muted-foreground">
          No log entries yet.
        </div>
      ) : (
        <ScrollArea className="h-[300px] bg-card">
          <div className="p-4 font-mono text-xs">
            {logs.map((entry, i) => (
              <div key={i} className="flex gap-3 py-0.5">
                <span className="shrink-0 text-muted-foreground">
                  {new Date(entry.timestamp).toLocaleTimeString("en-US", {
                    hour12: false,
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
                <Badge
                  className={cn(
                    "h-4 shrink-0 rounded px-1.5 text-[0.6rem] font-medium uppercase",
                    LEVEL_STYLES[entry.level] ?? "",
                  )}
                >
                  {entry.level}
                </Badge>
                <span className="text-foreground">{entry.message}</span>
                {entry.meta && (
                  <span className="text-muted-foreground">
                    {Object.entries(entry.meta)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(" ")}
                  </span>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Update App.tsx — add server logs**

Add imports:

```typescript
import { useLogs } from "@/hooks/use-logs";
import { ServerLogs } from "@/components/server-logs";
```

In the component body, after `useNodes`:

```typescript
  const { logs } = useLogs(adminKey);
```

In the JSX, after `<ConnectedNodes ... />`:

```tsx
      <ServerLogs logs={logs} disabled={!isAuthed} />
```

- [ ] **Step 4: Verify in browser**

Run: `cd packages/admin && pnpm dev` (with server running)
Expected: Server Logs section shows log entries with timestamps, colored level badges, and messages. Pause button stops auto-scrolling.

- [ ] **Step 5: Commit**

```bash
git add packages/admin/src/
git commit -m "feat(admin): add server logs viewer component"
```

---

## Task 10: Build Integration + Cleanup

**Files:**
- Modify: `packages/admin/package.json` (verify build works)
- Delete: `packages/server/src/admin.html`

- [ ] **Step 1: Build the admin app**

Run: `cd packages/admin && pnpm build`
Expected: Build succeeds, creates `packages/admin/dist/` with `index.html` and `assets/` directory

- [ ] **Step 2: Verify build output structure**

Run: `ls packages/admin/dist/ && ls packages/admin/dist/assets/`
Expected: `index.html` in dist root, `.js` and `.css` files in `assets/`

- [ ] **Step 3: Test static serving with the server**

Run: `bun run server` (start the Bun server)
Open `http://localhost:4400/admin` in browser.
Expected: The React admin app loads and functions correctly from the built static files.

- [ ] **Step 4: Delete the old admin.html**

Run: `rm packages/server/src/admin.html`

- [ ] **Step 5: Verify server still compiles**

Run: `bun test packages/server`
Expected: All tests pass (admin.html was only read at runtime, not imported in tests)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(admin): complete React conversion, remove old admin.html"
```

---

## Task 11: Final Verification

- [ ] **Step 1: Full build from clean state**

Run:
```bash
pnpm build:admin
```
Expected: Build succeeds

- [ ] **Step 2: Start server and verify all features**

Run: `bun run server`

Verify at `http://localhost:4400/admin`:
1. Auth gate: enter admin key, badge turns to "ready"
2. Metrics: 6 cards update every 3 seconds
3. Token create: submit form → token appears → **Active Credentials list auto-loads**
4. Token list: shows tokens, revoke works with confirmation dialog
5. Connected nodes: shows table of connected WebSocket nodes (or empty state)
6. Server logs: scrollable log viewer with colored level badges, pause/resume works

- [ ] **Step 3: Commit any final fixes if needed**
