---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-03-capabilities]
---

# Plan 04 — Real execution: executor registry, scanner service (dev), MCP facade

## Objective

Authorized operations actually execute behind the capability check with full lifecycle events, and the same pipeline becomes reachable from any MCP client.

## Preconditions

plan-03 merged; plan-00 §G/§H read.

## Tasks

1. **`executors/registry.ts`**: `Executor` interface `execute(capability, args) → {summary, result}`; tool name → executor map; unknown tool is a structured error.
2. **`executors/github.ts`**: GitHub-shaped executor — real API when `GITHUB_TOKEN` is present, otherwise canned deterministic responses explicitly marked `mode:"mock"` in the result summary (no equivalence claim). Tools: get_pull_request, read_file, merge_pull_request.
3. **Scanner as a real HTTP service**: `POST /api/services/scanner/scan` — dev mode returns a deterministic synthetic report (`mode:"dev"`, `price_usd_cents` echoed). plan-05 replaces this with the x402 gate.
4. **`executors/securityScan.ts`**: calls the scanner over HTTP (same-process loopback is fine) — proving the service boundary is a real hop, not a function call.
5. **Execution phase in `orchestrator.ts`**: after issuance — consume capability → `tool.execution.started` → executor → `tool.execution.completed` (result_summary) or `tool.execution.failed` (error) → `executions` row linked to capability/task. A failed execution still consumes the capability (no retry with the same capability).
6. **MCP facade**: `app/src/server/mcp/server.ts` + `POST /api/mcp` using `@modelcontextprotocol/sdk` (streamable HTTP). Tools mirror the gateway registry (`scanner_scan`, `github_get_pull_request`, `github_read_file`, `github_merge_pull_request`); every tool call funnels into `runToolCall` (agent identified via `x-cubic-agent` header). Same audit chain as HTTP ingest.
7. **Task completion**: when a task's outstanding work is done (demo agent signals via a `task.complete` tool, or the orchestrator detects a terminal state), emit `task.completed` and set the task status.
8. **Tests**: execution lifecycle events for success and failure; capability consumed exactly once per execution; MCP facade integration test — an in-process client lists tools, calls `scanner_scan`, and produces an audit chain identical in shape to HTTP ingest.

## Acceptance criteria

- [ ] One allowed tool-call produces the complete chain in `/api/audit/trace/[taskId]`: intent → decision → capability → execution → result.
- [ ] The scanner dev executor returns a deterministic report through a real HTTP hop; the execution consumes the capability exactly once.
- [ ] An MCP client (in-process test) can list tools and invoke `scanner_scan` through the gateway with the same events as HTTP ingest.
- [ ] A failing executor → `tool.execution.failed`; the capability is not reusable.
- [ ] Mock GitHub mode is visibly labeled mock everywhere it surfaces.
- [ ] `pnpm typecheck` / `lint` / `test` green.

## Out of scope

Payments (plan-05), Ledger approvals (plan-06), frontend (plan-09).
