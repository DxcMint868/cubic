# MEMORY.md

## Purpose

This is the project's hot-memory layer: the actively maintained working fact store for agents. It records implementation state, decisions, current tasks, constraints, discoveries, unresolved questions, and project nuances that should survive across agent sessions.

## Agent Instructions

- **MUST read MEMORY.md at the start of every substantive task.**
- **MUST update MEMORY.md when implementation state, architecture, decisions, tasks, constraints, or important technical facts change.**
- Prefer concise, factual entries over prose.
- Record decisions with enough context to prevent later agents from accidentally reversing them.
- Mark stale or superseded facts clearly rather than silently deleting useful history.
- Do not use MEMORY.md as a dump for transient chatter. Keep it useful as working memory.
- When uncertain whether a fact is current, verify it before treating it as authoritative.

## Current State

Update this section as implementation progresses.

### Active Work
- [ ] Define the first end-to-end MVP implementation.
- [ ] Implement the authorization gateway and capability model.
- [ ] Integrate MCP as the tool boundary.
- [ ] Integrate ERC-8004 / The Graph context.
- [ ] Integrate Ledger Key Ring / Agent Stack path.
- [ ] Integrate a live Hedera x402 payment flow.
- [ ] Build tenant control-plane surfaces.
- [ ] Build the global agent-network visualization.

### Decisions
- Monorepo managed with **pnpm workspaces** (root `pnpm-workspace.yaml`).
- `app/` is a Next.js 15 App Router project (React 19, TypeScript 5).
- `contracts/` is a Foundry/Solidity project (forge 1.5.1, solc 0.8.24).
- `pnpm dev` / `pnpm build` / `pnpm typecheck` run app commands from root.
- `pnpm forge:build` / `pnpm forge:test` run contract commands from root.

### Recent Changes
- Git init, monorepo structure, pnpm workspaces, Next.js App Router scaffold, Foundry project scaffold — all verified building clean.
- Landing page (`app/src/app/page.tsx`) replaced with a pure black full-screen canvas; user is iterating on a logo concept from there. First `pnpm install` run at app level (node_modules was missing).
- Logo concept (network squares forming a "C") shelved by user — instead built split landing page: left = product name + one-liner, right = live square-network canvas (`app/src/components/NetworkCanvas.tsx`, 2D canvas: jittered grid nodes, connective lines, traveling light pulses). Added `app/src/app/globals.css` (reset, black bg, blink keyframe). Layout is inline-styled for now, no design system yet.
- Project name confirmed: **Cubic**. Logo direction chosen: wireframe isometric cube with the front face open ("the gate"). Isolated work-in-progress at `/playground` (`app/src/app/playground/page.tsx`) — SVG + tiny 3D projection, pointer-tilt to inspect, edge opacities tunable (front face currently alpha 0.14, back/connectors 0.9).
- User rejected v1 (plain wireframe cube = "a diagram, not a mark"; wants 3D depth but no interactivity). v2 now at `/playground`: "the nest" — outer wireframe cube with the front-top edge removed (the gap), solid shaded inner cube (per-face lighting) inside nudged toward the gap. Static.
- User rejected v2 as well — logo exploration shelved for now, `/playground` deleted. Open question: brand mark still unresolved; current landing page has no logo.
- **Logo resolved**: wordmark "Cubic" in Darker Grotesque (loaded via `next/font/google` in `layout.tsx`, applied on `<body>`), weight 800, white on black. The period is an **outlined square dot** (echoes the network-node squares), not a filled mustard dot as in the user's reference — monochrome flip. Slogan on page: "Cloudflare for agent actions." + subline "Every agent tool call checked against identity, intent, policy, and trust." Page metadata updated to match.
- Landing page completed with header + footer. New `app/src/components/Logo.tsx` (reusable wordmark, square-dot uses `currentColor`). globals.css gained `.mono`, `.link`, `.btn-outline` helpers. Header: logo / nav (PRODUCT, NETWORK, DOCS — placeholder `#` links) / GET ACCESS outlined button. Footer: © 2026 CUBIC / GITHUB·DOCS·CONTACT / "AGENT AUTHORIZATION GATEWAY". User wants to review and correct styling choices.
- **UI convention locked in** (recorded in DESIGN.md): monochrome only; floating panels/dialogs use macOS-style window chrome (rectangle + 34px title bar + three monochrome circles ✕ − ⤢) via `app/src/components/MacWindow.tsx` — reuse it, don't recreate chrome.
- Landing page is now scrollable: header made sticky, hero pinned to first viewport (`calc(100dvh - 64px)`), added manifesto statement section below (large Darker Grotesque 700, ~46px, two-tone — final clause dimmed gray), footer at page end.
- Header restyled to a floating pill bar (per user reference): sticky, `width: min(1040px, 86vw)`, margin 14px auto, bg #0d0d0d, 1px #232323 border, 12px radius, height 54 — logo left, nav + GET ACCESS right. Hero height now `calc(100dvh - 82px)`. Header logo later bumped to 24px.
- Added team section (MacWindow with two dithered portraits left, quote-style copy right). New `app/src/components/DitherImage.tsx`: grayscale+contrast filter with dot-matrix overlay (newsprint/halftone effect). User to drop photos at `app/public/founder-1.jpg` + `founder-2.jpg` (placeholder frames show until then); names/roles still placeholders.
- MacWindow redesigned per user reference: rounded 10px rect, 44px bar, three PLAIN circles right (○ ○ ●, no glyphs), optional browser-style tabs left via `tabs`/`activeTab`/`onTabChange`. Team section extracted to `app/src/components/TeamSection.tsx` (client) — single image area with tabs `tron.jpeg` (live, `/dev_imgs/tron.jpeg`) and `duo.jpeg` (waiting on `/dev_imgs/duo.jpeg`). DESIGN.md convention updated to match.

### Important Constraints
- Authorization decisions must be deterministic; LLMs may classify/summarize but must not be the final ALLOW/DENY oracle.
- The gateway should authorize normalized tool operations and must not become an API-adapter zoo.
- Detailed private tenant audit data stays off-chain; blockchain is used selectively for trust, identity, reputation, attestations, payments, and verifiability.
- Ledger hardware security must not be represented as equivalent to a mock/dev implementation.

### Decisions
Record architectural decisions here as they are made.

### Known Issues / Open Questions
Record unresolved implementation questions here.

### Recent Changes
Record the most recent meaningful implementation changes here.
