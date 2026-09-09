---
guide: .agents/guides/guide-01-bootstrap.md
status: ready
depends-on: [plan-03-capabilities]
---

# Plan 04 — Real execution: executor registry, scanner service (dev), MCP facade

**HOW TO USE:** **EXACT** blocks are verbatim contracts — copy them as written. If an EXACT block fails, STOP and report; never silently redesign. Steps are ordered.

## Objective

Authorized operations execute behind the capability check with full lifecycle events, and the same pipeline becomes reachable from any MCP client.

## Preconditions

plan-03 merged; plan-00 §G (envelope) and §H (MCP boundary) read.

## Steps

1. **EXACT — `executors/registry.ts`** (union return — the second arm is the seam plan-05's 402 discovery uses):

```ts
export type ExecutorResult =
  | { summary: string; result: Record<string, unknown>; mode: "real" | "mock" | "dev" }
  | { status: "payment_required"; price_usd_cents: number; challenge: unknown };

export interface Executor {
  execute(input: {
    capability: { id: string; action: string; resource: string; budgetUsdCents: number | null };
    args: Record<string, unknown>;
  }): Promise<ExecutorResult>;
}
// registry: tool name → Executor instance. Unknown tool = { ok:false, error:{code:"TOOL_NOT_FOUND"} }.
```

   Pin `@modelcontextprotocol/sdk` to the latest stable at implementation time and record the version in your report.

2. **EXACT — `executors/github.ts`**: with `GITHUB_TOKEN` set, call the real API (`mode:"real"`). Without it, canned deterministic responses (`mode:"mock"`):

```text
get_pull_request   → result {repo, pr, title:"Fix auth flow", ci:"passing", approved:true}
                     summary "PR #421 'Fix auth flow' — CI passing, approved (mock)"
read_file          → result {path, content:"mock file content"}
                     summary "Read <path> (mock)"
merge_pull_request → result {merged:true}
                     summary "Merged PR #<pr> (mock)"
```

3. **EXACT — scanner service route** `POST /api/services/scanner/scan` (dev mode, no payment yet). Request `{target: string}`. `price_usd_cents` comes from `config().X402_SCANNER_PRICE_CENTS` (never a hardcoded 25). Response:

```json
{ "ok": true, "data": {
  "report_id": "rpt_",            // + randomBytes(4).toString("hex") — 8 hex chars
  "target": "<target>",
  "verdict": "clean",
  "findings": [],
  "mode": "dev",
  "price_usd_cents": 25
} }
```

4. **`executors/securityScan.ts`**: POST to the `endpoint` from `tools.executor_config` over real HTTP (loopback is fine — the point is a service boundary, not a function call). `summary` = `"Security scan of <target>: clean (dev mode)"`.

5. **EXACT — execution phase in `orchestrator.ts`** (surgical addition after issuance): `consumeCapability(capabilityId, {action, resource, amount: budget ?? undefined})` — field mapping is explicit: `budgetUsdCents = <capabilities row>.budget_usd_cents`. Then:
   - if the executor returns `{status:"payment_required", …}`: insert NO `executions` row, do NOT consume further — return `{payment_required: {price_usd_cents, challenge}}` in the response `data` (leaving the initial scan capability issued-but-unconsumed; it expires harmlessly). This is the ONLY non-executing path.
   - else: insert `executions` row (`status:"running"`, `executor` from tool row) → emit `tool.execution.started` → executor runs (already returned) → update row (`succeeded` + `result_summary`, or `failed` + `error`) → emit `tool.execution.completed|failed`. Chain linkage `consumed → execution` runs through `capability_id` (present in every execution payload) — no other id threading needed.
   - A failed execution still consumes the capability (no retry with the same capability). Response `data.execution` = `{execution_id, status, result_summary}`.
   - `task.complete` tool: marks the task `completed`, emits `task.completed` `{task_id, status:"completed", summary}`, returns summary "Task completed".

6. **EXACT — MCP facade** (`server/mcp/server.ts` + `POST /api/mcp`, streamable HTTP via `@modelcontextprotocol/sdk`). Tool list — name → underlying gateway tool, all funneling into `runToolCall` (agent from `x-cubic-agent` header):

```text
scanner_scan              → scanner.scan
github_get_pull_request   → github.get_pull_request
github_read_file          → github.read_file
github_merge_pull_request → github.merge_pull_request
task_complete             → task.complete
```

   Each tool returns the full tool-call `data` JSON as its content. Use the SDK's `McpServer` + `StreamableHTTPServerTransport`; no custom auth.

## Acceptance criteria

- [ ] One allowed `github.get_pull_request` call produces the complete chain in `/api/audit/trace/[taskId]`: intent → decision → capability → execution, with `tool.execution.started` + `tool.execution.completed` and `mode:"mock"` visible.
- [ ] Scanner executor returns a deterministic report over a real HTTP hop with `report_id` matching `^rpt_[0-9a-f]{8}$`; execution consumes the capability exactly once.
- [ ] A forced-402 stub executor returns `{status:"payment_required"}` → response `data.payment_required` is set, NO `executions` row, NO `capability.consumed` event, capability still `issued`.
- [ ] In-process MCP client lists the 5 tools; `scanner_scan` produces the identical event chain shape as HTTP ingest.
- [ ] Failing executor → `tool.execution.failed`, `executions.status = 'failed'`, capability not reusable.
- [ ] `task.complete` → task row `completed`, `task.completed` event.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green.

## Out of scope

Real 402 settlement (plan-05), Ledger approvals (plan-06), frontend (plan-09).
