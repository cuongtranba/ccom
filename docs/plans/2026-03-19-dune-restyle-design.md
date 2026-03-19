# Dune Movie Restyle — Design Document

**Date:** 2026-03-19
**Status:** Approved

## Overview

Transform the Inventory Network landing page from the current neural/bioluminescent aesthetic to a Dune (Villeneuve) movie-inspired desert theme. The sand becomes the ambient world; the protocol lives within it.

## Decisions

### 1. Sand Flow Background (replaces particle network)

Replace `background-network.ts` with `sand-flow.ts`. Three parallax layers of sand particles flowing left-to-right, simulating desert wind.

**Layer structure:**
- **Back layer (30%)** — Large, slow particles. Speed ~0.15px/frame. Opacity ~0.12. Distant dune ridges.
- **Mid layer (45%)** — Medium particles. Speed ~0.4px/frame. Opacity ~0.20. Main sand body.
- **Front layer (25%)** — Small, fast particles. Speed ~0.8px/frame. Opacity ~0.30. Close grains with short horizontal trails (2-4px).

All layers flow left-to-right with wrap-around. Each particle has slight vertical sine-wave drift (amplitude 0.5-2px) for natural undulation. Canvas at `opacity: 0.5` on fixed background.

Particle count: `(width * height) / 20000`, split 30/45/25 across layers.

### 2. Color System — Full OKLCH Palette Swap

Everything moves from blue hue range (260) to warm desert range (65-80).

**Backgrounds:**
- `--bg-deep`: `oklch(0.12 0.02 65)` — deep warm dark
- `--bg-surface`: `oklch(0.17 0.02 65)`
- `--bg-elevated`: `oklch(0.22 0.025 65)`

**Borders:**
- `--border-subtle`: `oklch(0.28 0.02 65)`
- `--border-hover`: `oklch(0.40 0.03 70)`

**Text:**
- `--text-primary`: `oklch(0.90 0.02 75)` — sand-tinted off-white
- `--text-secondary`: `oklch(0.60 0.03 70)`
- `--text-muted`: `oklch(0.42 0.02 65)`

**Status colors:**
- `--proven`: `oklch(0.75 0.14 80)` — spice gold
- `--proven-glow`: `oklch(0.65 0.17 80)`
- `--suspect`: `oklch(0.62 0.16 45)` — burnt sienna
- `--suspect-glow`: `oklch(0.52 0.20 45)`
- `--broke`: `oklch(0.55 0.20 25)` — deep rust
- `--unverified`: `oklch(0.55 0.04 70)` — desert stone grey
- `--unverified-glow`: `oklch(0.45 0.06 70)`

**Signal/trace:**
- `--signal-pulse`: `oklch(0.78 0.16 65)` — bright spice orange
- `--trace-line`: `oklch(0.30 0.03 65)` — dark sand
- `--trace-active`: `oklch(0.55 0.10 70)` — warm amber

### 3. Demo Re-skinning — Sand Particle Signals

**Propagation demo signals:**
- Replace single green dot with stream of 8-12 sand particles per signal
- Each particle: 2-3px radius, slight random perpendicular offset (+-3px), varied speeds (+-15%)
- Color: `--signal-pulse` (spice orange) with `shadowBlur: 8`
- Particles fade out in last 20% of journey
- Multiple simultaneous signals show as distinct diverging sand streams

**Node styling:**
- Read CSS custom properties via `getComputedStyle()` instead of hard-coded hex
- Slight radius variation on node circles (+-1px per segment) for organic, sand-worn feel
- Proven nodes glow warm spice amber

**State machine SVG:**
- Same color token swap to Dune palette
- Active arrows glow spice orange
- No structural changes

### 4. Typography Tuning

Keep Space Grotesk (display) and JetBrains Mono (code). Subtle adjustments:
- Hero title weight: 700 → 600 (more restraint)
- Hero title letter-spacing: -0.03em → -0.01em (more monumental)
- Section label letter-spacing: 0.2em → 0.3em (more architectural)

No font changes. The palette and sand animation carry the Dune identity.

## Files to Modify

1. `web/src/styles/global.css` — Full palette swap
2. `web/src/scripts/background-network.ts` → rename to `sand-flow.ts` — New sand flow system
3. `web/src/scripts/propagation-demo.ts` — Sand particle signals + CSS variable reads
4. `web/src/layouts/Base.astro` — Update script import
5. `web/src/pages/index.astro` — Typography tuning
6. `web/src/components/StateMachine.astro` — Color token alignment (if needed)
7. `web/src/components/VotingCard.astro` — Fix hard-coded OKLCH value
8. `.impeccable.md` — Update design context for Dune aesthetic

## Out of Scope

- New feature sections (P2P, Claude Code integration, etc.) — separate effort
- Accessibility fixes — separate effort per audit
- Responsive canvas fixes — separate effort
- Font changes — keeping current fonts
