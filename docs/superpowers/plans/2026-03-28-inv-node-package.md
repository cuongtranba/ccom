# `@inv/node` Package Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish `@inv/node` as an installable package on GitHub Packages so users can run `bunx @inv/node init` instead of cloning the monorepo.

**Architecture:** Bundle `packages/node` + `packages/shared` into a single distributable JS file using `bun build`. The CLI entry point routes `init` (wizard) and `serve` (MCP channel server) subcommands. A GitHub Actions workflow on self-hosted runner runs tests on push, and publishes to GitHub Packages on `node-v*` tags.

**Tech Stack:** Bun (build + runtime), TypeScript, GitHub Actions, GitHub Packages (npm registry)

**Spec:** `docs/superpowers/specs/2026-03-28-inv-node-package-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `packages/node/src/index.ts` | CLI router: parse subcommand → dispatch to init or serve |
| Modify | `packages/node/src/cli.ts` | Update `generateMcpConfig()` to emit `bunx @inv/node serve` |
| Modify | `packages/node/package.json` | Add `bin`, `files`, `publishConfig`, build script; remove `private` |
| Modify | `packages/node/test/cli.test.ts` | Update tests for new `generateMcpConfig` output |
| Modify | `root package.json` | Add `build:node` and `publish:node` scripts |
| Modify | `.gitignore` | Ensure `dist/` under packages is ignored |
| Create | `.github/workflows/release-node.yml` | CI: test + build + publish on tag |
| Modify | `README.md` | Add install instructions for published package |

---

### Task 1: Update `generateMcpConfig()` to emit `bunx` command

The wizard currently generates `.mcp.json` pointing to local source files. Change it to use the published package command.

**Files:**
- Modify: `packages/node/src/cli.ts:50-59`
- Test: `packages/node/test/cli.test.ts`

- [ ] **Step 1: Update the test for `generateMcpConfig`**

Open `packages/node/test/cli.test.ts` and find the existing test for `generateMcpConfig`. Change the expected output to match the new `bunx` command:

```typescript
// In the test for generateMcpConfig, update the expected value:
expect(config).toEqual({
  mcpServers: {
    inventory: {
      command: "bunx",
      args: ["@inv/node", "serve", "./inv-config.json"],
    },
  },
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/node/test/cli.test.ts`
Expected: FAIL — the current implementation returns `"bun"` with `["run", "packages/node/src/channel.ts", ...]`

- [ ] **Step 3: Update `generateMcpConfig` in `cli.ts`**

In `packages/node/src/cli.ts`, replace the `generateMcpConfig` function:

```typescript
export function generateMcpConfig(configPath: string): McpConfig {
  return {
    mcpServers: {
      inventory: {
        command: "bunx",
        args: ["@inv/node", "serve", configPath],
      },
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/node/test/cli.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/node/src/cli.ts packages/node/test/cli.test.ts
git commit -m "feat(node): update MCP config to use bunx @inv/node serve"
```

---

### Task 2: Refactor CLI entry point with subcommand routing

Currently `index.ts` checks for `"init"` and defaults to starting the channel server. Add explicit `"serve"` subcommand and print usage for unknown commands.

**Files:**
- Modify: `packages/node/src/index.ts`

- [ ] **Step 1: Rewrite `index.ts` with subcommand routing**

Replace the contents of `packages/node/src/index.ts`:

```typescript
import { runWizard } from "./cli";
import { startChannelServer } from "./channel";

async function main(): Promise<void> {
  const command = process.argv[2];

  switch (command) {
    case "init":
      await runWizard();
      break;
    case "serve":
      await startChannelServer(process.argv[3] ?? "./inv-config.json");
      break;
    case undefined:
      // Backwards compat: no subcommand starts serve
      await startChannelServer(process.argv[3] ?? "./inv-config.json");
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Usage:");
      console.error("  @inv/node init              Set up a new node");
      console.error("  @inv/node serve [config]    Start MCP server");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `bun test packages/node`
Expected: All tests pass (this change is backwards-compatible)

- [ ] **Step 3: Commit**

```bash
git add packages/node/src/index.ts
git commit -m "feat(node): add explicit serve subcommand with usage help"
```

---

### Task 3: Configure `package.json` for publishing

Update `packages/node/package.json` to be publishable: add `bin`, `files`, `publishConfig`, build script. Remove `private: true` and the workspace dependency on `@inv/shared`.

**Files:**
- Modify: `packages/node/package.json`

- [ ] **Step 1: Rewrite `packages/node/package.json`**

Replace the contents of `packages/node/package.json`:

```json
{
  "name": "@inv/node",
  "version": "0.1.0",
  "bin": {
    "inv-node": "./dist/cli.js"
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "bun build src/index.ts --target=bun --outdir=dist --entry-naming=cli.js --packages=external"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.28.0"
  },
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/tini-works/my-inventory.git",
    "directory": "packages/node"
  }
}
```

Notes:
- `bin.inv-node` is the CLI executable name. `bunx @inv/node` will resolve to this.
- `--packages=external` tells bun build to leave all `node_modules` imports as external (including `@modelcontextprotocol/sdk`), but `@inv/shared` is a workspace source import and gets bundled inline.
- `--entry-naming=cli.js` ensures the output is named `dist/cli.js`.

- [ ] **Step 2: Verify workspace dependencies still resolve**

Run: `bun install`
Expected: Resolves without errors (workspace link still works for dev)

- [ ] **Step 3: Commit**

```bash
git add packages/node/package.json
git commit -m "feat(node): configure package.json for GitHub Packages publishing"
```

---

### Task 4: Build and verify the bundle

Run the build and verify the bundled output works correctly.

**Files:**
- Modify: `packages/node/package.json` (already done in Task 3)
- Build output: `packages/node/dist/cli.js`

- [ ] **Step 1: Run the build**

```bash
cd packages/node && bun run build
```

Expected: Creates `packages/node/dist/cli.js`. Check it exists and contains bundled code:

```bash
ls -la packages/node/dist/cli.js
head -5 packages/node/dist/cli.js
```

- [ ] **Step 2: Verify `@inv/shared` is bundled inline**

```bash
grep -c "bun:sqlite" packages/node/dist/cli.js
```

Expected: Should find `bun:sqlite` imports (preserved as external). Should NOT find `@inv/shared` as an import — it's bundled inline.

```bash
grep "@inv/shared" packages/node/dist/cli.js || echo "Good: @inv/shared is bundled inline"
```

- [ ] **Step 3: Test the built CLI — `serve` with no config**

```bash
bun packages/node/dist/cli.js serve nonexistent.json 2>&1 || true
```

Expected: Should error about missing config file (not a module resolution error). This confirms the bundle is self-contained.

- [ ] **Step 4: Test the built CLI — unknown command**

```bash
bun packages/node/dist/cli.js bogus 2>&1
```

Expected: Should print "Unknown command: bogus" and usage help.

- [ ] **Step 5: Add `dist/` to `.gitignore` if not already**

Check if `dist/` is already in `.gitignore` (it is — line 18 says `dist/`). No action needed.

- [ ] **Step 6: Commit build script verification**

No files to commit — build output is gitignored. But add root scripts:

Add to root `package.json` scripts:

```json
{
  "scripts": {
    "test": "bun test",
    "server": "bun run packages/server/src/index.ts",
    "node": "bun run packages/node/src/index.ts",
    "init": "bun run packages/node/src/index.ts init",
    "build:node": "cd packages/node && bun run build",
    "publish:node": "cd packages/node && npm publish"
  }
}
```

```bash
git add package.json
git commit -m "feat: add build:node and publish:node root scripts"
```

---

### Task 5: Create GitHub Actions workflow for test + publish

Create the CI workflow that runs tests on every push/PR and publishes to GitHub Packages when a `node-v*` tag is pushed. Uses self-hosted runner.

**Files:**
- Create: `.github/workflows/release-node.yml`

- [ ] **Step 1: Create the workflow file**

```bash
mkdir -p .github/workflows
```

Create `.github/workflows/release-node.yml`:

```yaml
name: Release @inv/node

on:
  push:
    branches: [main]
    tags: ["node-v*"]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Run tests
        run: bun test

      - name: Build @inv/node
        run: bun run build:node

      - name: Verify build output
        run: |
          test -f packages/node/dist/cli.js || (echo "Build output missing" && exit 1)
          bun packages/node/dist/cli.js bogus 2>&1 | grep -q "Unknown command" || (echo "CLI routing broken" && exit 1)

  publish:
    needs: test
    if: startsWith(github.ref, 'refs/tags/node-v')
    runs-on: self-hosted
    permissions:
      contents: write
      packages: write
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build @inv/node
        run: bun run build:node

      - name: Extract version from tag
        id: version
        run: echo "version=${GITHUB_REF_NAME#node-v}" >> "$GITHUB_OUTPUT"

      - name: Set package version
        run: |
          cd packages/node
          jq --arg v "${{ steps.version.outputs.version }}" '.version = $v' package.json > package.json.tmp
          mv package.json.tmp package.json

      - name: Publish to GitHub Packages
        run: |
          cd packages/node
          echo "//npm.pkg.github.com/:_authToken=${{ secrets.GITHUB_TOKEN }}" > .npmrc
          echo "@inv:registry=https://npm.pkg.github.com" >> .npmrc
          npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ github.ref_name }}
          name: "@inv/node ${{ steps.version.outputs.version }}"
          body: |
            ## Install

            ```bash
            bunx @inv/node init
            ```

            See [README](https://github.com/tini-works/my-inventory#install) for setup instructions.
          generate_release_notes: true
```

- [ ] **Step 2: Verify the workflow YAML is valid**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release-node.yml'))" 2>/dev/null || bun -e "console.log('YAML check: manual review needed')"
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release-node.yml
git commit -m "ci: add GitHub Actions workflow for @inv/node test and publish"
```

---

### Task 6: Update README with install instructions

Add a section to the README explaining how to install the published package.

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add install section to README**

After the "## Prerequisites" section and before "## Quick Start", add a new section. Also update Quick Start to show the `bunx` flow as the primary option.

Add after the Prerequisites section:

```markdown
## Install

### Option A: Published package (recommended)

Configure the `@inv` scope to resolve from GitHub Packages:

```toml
# ~/.bunfig.toml
[install.scopes]
"@inv" = { token = "$GH_TOKEN", url = "https://npm.pkg.github.com" }
```

Or via `.npmrc`:

```ini
@inv:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
```

Then set up your node:

```bash
bunx @inv/node init
# Follow the wizard — writes inv-config.json + .mcp.json

claude
# Claude auto-discovers .mcp.json and connects
```

### Option B: From source

Clone the repo and follow Quick Start below.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add install instructions for published @inv/node package"
```

---

### Task 7: End-to-end verification

Verify the entire flow works: build, package contents, CLI commands.

**Files:** None (verification only)

- [ ] **Step 1: Clean build**

```bash
rm -rf packages/node/dist
bun run build:node
```

- [ ] **Step 2: Check package contents**

```bash
cd packages/node && npm pack --dry-run 2>&1
```

Expected: Should list only `dist/cli.js` and `package.json`. No source files, no test files.

- [ ] **Step 3: Run full test suite**

```bash
bun test
```

Expected: All tests pass.

- [ ] **Step 4: Verify CLI routing from built bundle**

```bash
bun packages/node/dist/cli.js bogus 2>&1 | grep "Unknown command"
```

Expected: Prints "Unknown command: bogus"

- [ ] **Step 5: Final commit (if any fixups needed)**

```bash
git status
# If clean, no commit needed
```
