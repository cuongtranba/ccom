# Admin Page: Vite + React + TypeScript + shadcn/ui Conversion

**Date**: 2026-03-28
**Status**: Approved

## Goal

Convert the server's inline `admin.html` (vanilla HTML/CSS/JS) into a proper Vite + React + TypeScript app with shadcn/ui components, keeping the Dune desert visual theme. Add two new features: connected nodes list and server logs view.

## Decisions

| Decision | Choice |
|----------|--------|
| Location | `packages/admin/` (new monorepo package) |
| Serving | Vite builds to static dist, Bun server serves at `/admin` |
| Framework | Vite + React + TypeScript + Tailwind + shadcn/ui |
| Design | Keep exact Dune/desert oklch palette, Space Grotesk + JetBrains Mono |
| Scope | Current features + connected nodes list + server logs view |

## Architecture

### Project Structure

```
packages/admin/
├── package.json
├── vite.config.ts        # base: '/admin/', output to dist/
├── tsconfig.json
├── tailwind.config.ts    # Dune desert theme
├── components.json       # shadcn/ui config
├── index.html            # Vite entry
├── src/
│   ├── main.tsx
│   ├── App.tsx           # layout + auth gate wrapper
│   ├── lib/
│   │   ├── api.ts        # typed fetch wrappers for all endpoints
│   │   └── utils.ts      # cn() helper
│   ├── hooks/
│   │   ├── use-auth.ts       # admin key + localStorage
│   │   ├── use-metrics.ts    # poll GET /metrics (3s)
│   │   ├── use-tokens.ts     # token CRUD state
│   │   ├── use-nodes.ts      # poll GET /api/nodes (5s)
│   │   └── use-logs.ts       # poll GET /api/logs (3s)
│   ├── components/
│   │   ├── auth-gate.tsx
│   │   ├── metrics-strip.tsx
│   │   ├── token-create-form.tsx
│   │   ├── token-list.tsx
│   │   ├── connected-nodes.tsx
│   │   ├── server-logs.tsx
│   │   └── ui/              # shadcn/ui generated
│   └── styles/
│       └── globals.css       # Tailwind base + Dune theme CSS vars
```

### Component Tree & Data Flow

```
App (provides auth state to all children)
 ├── AuthGate              ← password input, localStorage persistence
 ├── MetricsStrip          ← useMetrics polls /metrics every 3s
 │    └── 6x MetricCard    ← pulse animation on value change
 ├── TokenSection
 │    ├── TokenCreateForm   → POST /api/token/create
 │    │    └── on success: auto-sets project filter, triggers list refresh
 │    └── TokenList         ← GET /api/token/list?project=X
 │         └── TokenRow     → revoke via POST /api/token/revoke
 ├── ConnectedNodes        ← useNodes polls /api/nodes every 5s
 │    └── shadcn Table
 └── ServerLogs            ← useLogs polls /api/logs every 3s
      └── scrollable monospace log viewer, auto-scroll + pause
```

## Components Detail

### AuthGate
- `useAuth` hook: `adminKey` state synced with `localStorage('inv_admin_key')`
- When key present: all API wrappers include `Authorization: Bearer ${adminKey}`
- shadcn `Input` (type=password) + `Badge` for status
- Disabled state propagates to all action buttons

### MetricsStrip
- `useMetrics(adminKey)` polls `GET /metrics` every 3 seconds
- 6 shadcn `Card` components in responsive CSS grid
- Metric values: tabular-nums, large font, spice color
- Pulse CSS animation when value changes (compare prev vs current)
- Shows "--" when loading, dim style when value is 0

### TokenCreateForm
- Inputs: project (text), node ID (text)
- On submit: `POST /api/token/create { project, nodeId }`
- On success: displays token with copy-to-clipboard, **auto-refreshes token list for that project**
- shadcn `Input`, `Button`, toast for result

### TokenList
- Project filter input + Load button
- Auto-populated when TokenCreateForm succeeds
- `GET /api/token/list?project=X` returns `{ tokens: TokenInfo[] }`
- Each row: node ID, created date, masked token (click to copy), revoke button
- Revoke: shadcn `AlertDialog` confirmation, then `POST /api/token/revoke { token }`

### ConnectedNodes (new feature)
- `useNodes(adminKey)` polls `GET /api/nodes` every 5 seconds
- shadcn `Table` with columns: Node ID, Project, Connected Since, Last Message
- Empty state when no nodes connected

### ServerLogs (new feature)
- `useLogs(adminKey)` polls `GET /api/logs` every 3 seconds
- Scrollable container with JetBrains Mono font
- Each log line: timestamp, colored level badge (info/warn/error), message
- Auto-scrolls to bottom; pause button stops auto-scroll
- Ring buffer on server side (~200 entries max)

## Server-Side Changes

### New Endpoints

#### `GET /api/nodes` (auth required)
```typescript
Response: {
  nodes: Array<{
    nodeId: string;
    project: string;
    connectedAt: string;      // ISO timestamp
    lastMessageAt: string | null;
  }>
}
```
Source: expose Hub's tracked WebSocket connections.

#### `GET /api/logs` (auth required)
```typescript
Response: {
  logs: Array<{
    timestamp: string;        // ISO timestamp
    level: 'info' | 'warn' | 'error';
    message: string;
    meta?: Record<string, string>;
  }>
}
```
Source: new `LogBuffer` class — in-memory ring buffer (~200 entries). Server code emits events at key points: connect, disconnect, route, enqueue, drain, error.

### Static File Serving

Replace inline HTML serving with static file serving:

```typescript
// Current
if (url.pathname === "/admin") {
  return new Response(adminHtml, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// New — no client-side routing, so no SPA fallback needed
if (url.pathname === "/admin" || url.pathname === "/admin/") {
  // Serve dist/index.html
}
if (url.pathname.startsWith("/admin/assets/")) {
  // Serve static assets (.js, .css) from dist/assets/ with correct MIME types
}
```

### Build Integration

Root `package.json` scripts:
- `"build:admin": "cd packages/admin && pnpm build"` — builds the React app
- Server reads from `packages/admin/dist/` at startup

## Tailwind Theme — Dune Desert Palette

Map oklch CSS variables to shadcn/ui's theme system:

| Token | oklch Value | Maps To |
|-------|-------------|---------|
| void | `oklch(0.12 0.02 65)` | `--background` |
| deep | `oklch(0.16 0.025 65)` | `--card`, `--popover` |
| sand | `oklch(0.28 0.04 65)` | `--border`, `--input` |
| sand-dim | `oklch(0.22 0.03 65)` | `--muted` |
| ridge | `oklch(0.38 0.05 65)` | `--secondary` |
| text | `oklch(0.82 0.04 70)` | `--foreground`, `--card-foreground` |
| text-dim | `oklch(0.55 0.03 65)` | `--muted-foreground` |
| spice | `oklch(0.72 0.16 55)` | `--primary` |
| spice-bright | `oklch(0.82 0.18 55)` | `--primary` hover states |
| gold | `oklch(0.78 0.14 85)` | `--accent` |
| gold-dim | `oklch(0.55 0.08 85)` | `--accent-foreground` |
| fremen | `oklch(0.62 0.12 250)` | `--ring`, info color |
| reject | `oklch(0.60 0.18 25)` | `--destructive` |
| approve | `oklch(0.65 0.14 145)` | success color (custom) |

Fonts:
- `--font-sans`: Space Grotesk (Google Fonts)
- `--font-mono`: JetBrains Mono (Google Fonts)

Background: radial gradient overlay on body (same as current admin.html).

## Dev Workflow

- `pnpm dev` in `packages/admin/` starts Vite dev server
- Vite proxies `/metrics`, `/api/*`, `/ws` to the Bun server (e.g. `localhost:4400`)
- `pnpm build` outputs to `dist/` with `base: '/admin/'`
- Bun server serves the dist at `/admin/*` in production

## Testing Strategy

- Component unit tests with Vitest + React Testing Library
- API hook tests with MSW (Mock Service Worker) for endpoint mocking
- Manual verification of theme fidelity against current admin.html

## Migration

1. Build the new React admin app in `packages/admin/`
2. Add new server endpoints (`/api/nodes`, `/api/logs`)
3. Add `LogBuffer` class to server
4. Replace inline `admin.html` serving with static file serving from dist
5. Remove `packages/server/src/admin.html`
6. Update root package.json with `build:admin` script
