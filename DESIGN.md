# DESIGN.md

## Purpose

This document is the canonical project-wide design language and system-design reference. Any agent making UI, UX, product-surface, naming, or interaction-design changes MUST read this file before editing.

## Design Principles

- Make the security model legible. Users should understand why an action was allowed, denied, or escalated.
- Prefer dense, operational information over decorative dashboards.
- The global network view is the product's visual "wow" layer, but it must represent real or clearly simulated events rather than fake scale.
- Tenant controls should feel like developer/security infrastructure, not generic enterprise CRUD.
- Keep the distinction visible between intent, authorization, capability, execution, and result.
- Use consistent terminology across UI, APIs, docs, and code. Do not invent synonyms for core concepts without updating PROJECT.md and MEMORY.md.

## System Language

Core nouns: Agent, Identity, Intent, Tool, Action, Policy, Context, Capability, Approval, Execution, Result, Audit Event, Reputation, Tenant, Network.

Core flow:

Agent -> Intent -> Policy/Context Evaluation -> Allow | Deny | Escalate -> Capability -> Tool Execution -> Result -> Audit Event

## Visual / Interaction Direction

- The tenant control plane is the practical operational surface.
- The global network is the observational/network-effect surface.
- Network visualizations should emphasize relationships, activity, trust, and flow rather than decorative maps.
- Risk states must be immediately distinguishable and consistently represented.
- Destructive/high-risk actions should expose the reason for escalation and the approval state.

## UI Conventions

- Monochrome only: black surfaces, white/gray type, outlined squares as the recurring motif. No color accents.
- Wordmark: "Cubic" in Darker Grotesque 800 with an outlined square as the period.
- Floating panels, dialogs, and content surfaces use macOS-application-style chrome: a rounded rectangle (10px radius) with a 44px title bar — three plain circles on the right (two outlined, one filled, no glyphs) and optional browser-style tabs on the left — implemented in `app/src/components/MacWindow.tsx` (tabs API: `tabs` / `activeTab` / `onTabChange`). Reuse that component rather than recreating window chrome.
- Mono font (`ui-monospace` stack, see `.mono` in globals.css) for labels, metadata, and technical text; Darker Grotesque for display and body.

## Alignment Rule

When a proposed implementation conflicts with this document, stop and reconcile the design before proceeding. Update this document only when the project intentionally changes its canonical design language.
