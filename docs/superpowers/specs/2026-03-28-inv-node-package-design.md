# Design: Publish `@inv/node` as an Installable Package

**Date:** 2026-03-28
**Status:** Approved

## Goal

Allow users to set up an inventory node via `bunx @inv/node init` instead of cloning the monorepo. Publish to GitHub Packages.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Package name | `@inv/node` | Matches existing workspace name, scoped under `@inv` |
| Runtime | Bun only | Project already uses `bun:sqlite` and Bun's native WebSocket; avoids `better-sqlite3` dependency |
| Registry | GitHub Packages | Team-controlled, private-capable, no npm scope ownership needed |
| Packaging | Bundle `@inv/shared` inline | Single package to publish, no multi-package coordination |
| Install UX | `bunx @inv/node init` | Zero-install experience, no global install required |

## User Experience

### Setup flow

```bash
# 1. In any project directory
bunx @inv/node init
# → Interactive wizard: name, vertical, project, owner, server URL, token, db path
# → Writes ./inv-config.json and ./.mcp.json

# 2. Start Claude Code
claude
# → Auto-discovers .mcp.json, connects to inventory MCP server
```

### Generated `.mcp.json`

```json
{
  "mcpServers": {
    "inventory": {
      "command": "bunx",
      "args": ["@inv/node", "serve", "./inv-config.json"]
    }
  }
}
```

## CLI Commands

| Command | Purpose |
|---------|---------|
| `bunx @inv/node init` | Interactive setup wizard |
| `bunx @inv/node serve [config-path]` | Start MCP server on stdio (called by `.mcp.json`) |

`serve` defaults config path to `./inv-config.json` if not provided.

## Architecture

### Build

`bun build` compiles all TypeScript into JavaScript:
- **Bundled internally**: `@inv/shared` (types + message envelope)
- **External dependency**: `@modelcontextprotocol/sdk` (kept in `dependencies`)
- **Target**: `bun` (preserves `bun:sqlite` imports)
- **Entry points**: Single entry `dist/cli.js` that handles both `init` and `serve` subcommands

### Published package structure

```
@inv/node/
├── package.json
└── dist/
    └── cli.js          # Bundled entry point (init + serve)
```

### `package.json` changes

```json
{
  "name": "@inv/node",
  "version": "0.1.0",
  "bin": {
    "@inv/node": "./dist/cli.js"
  },
  "files": ["dist"],
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.28.0"
  }
}
```

Remove `"private": true`. Remove `"@inv/shared": "workspace:*"` from dependencies (bundled inline).

## Source Changes

### 1. `packages/node/src/index.ts` — CLI router

Replace current content with a subcommand router:

```
argv[2] === "init"  → runWizard()
argv[2] === "serve" → startChannelServer(argv[3] ?? "./inv-config.json")
default (no arg)    → startChannelServer("./inv-config.json")  // backwards compat
```

### 2. `packages/node/src/cli.ts` — Update wizard output

`generateMcpConfig()` currently generates:
```json
{ "command": "bun", "args": ["run", "packages/node/src/channel.ts", configPath] }
```

Change to:
```json
{ "command": "bunx", "args": ["@inv/node", "serve", configPath] }
```

### 3. `packages/node/package.json` — Package metadata

- Remove `"private": true`
- Add `"bin"`, `"files"`, `"publishConfig"`
- Add `"scripts": { "build": "bun build ..." }`
- Remove `"@inv/shared"` from dependencies (bundled)

### 4. Root build/publish scripts

Add to root `package.json`:
```json
{
  "scripts": {
    "build:node": "cd packages/node && bun run build",
    "publish:node": "cd packages/node && bun publish"
  }
}
```

### 5. GitHub Packages auth

Users need to configure their Bun/npm to resolve `@inv` from GitHub Packages:

```ini
# ~/.bunfig.toml or project bunfig.toml
[install.scopes]
"@inv" = { token = "$GH_TOKEN", url = "https://npm.pkg.github.com" }
```

Or via `.npmrc`:
```
@inv:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GH_TOKEN}
```

This must be documented in the README.

## Testing

1. Run existing `bun test packages/node` — all tests should pass unchanged
2. Build locally: `bun run build:node`
3. Test CLI locally: `bun ./packages/node/dist/cli.js init` and `bun ./packages/node/dist/cli.js serve`
4. Dry-run publish: `cd packages/node && bun publish --dry-run`

## README Updates

Add an "Install" section to the root README covering:
1. Prerequisites (Bun, access to GitHub Packages)
2. Configure `@inv` scope auth
3. `bunx @inv/node init`
4. Start Claude Code

## Out of Scope

- Node.js / npx support (would require replacing `bun:sqlite`)
- Auto-update mechanism
- CI/CD publish pipeline (can be added later)
- Dashboard packaging (separate concern)
