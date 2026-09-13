import { GithubExecutor } from "./github";
import { ScannerExecutor } from "./securityScan";
import { TaskCompleteExecutor } from "./taskComplete";
import { TreasuryExecutor } from "./treasury";

// plan-04 EXACT — union return; the second arm is the seam plan-05's 402
// discovery uses.
export type ExecutorResult =
  | { summary: string; result: Record<string, unknown>; mode: "real" | "mock" | "dev" }
  | { status: "payment_required"; price_usd_cents: number; challenge: unknown };

export interface Executor {
  execute(input: {
    capability: { id: string; action: string; resource: string; budgetUsdCents: number | null };
    args: Record<string, unknown>;
  }): Promise<ExecutorResult>;
}

export type ExecutorLookup =
  | { ok: true; executor: Executor }
  | { ok: false; error: { code: "TOOL_NOT_FOUND" } };

export interface ExecutorToolRow {
  executor: string;
  executorConfig: Record<string, unknown>;
}

// Test/extension hook: forces an executor for an `tools.executor` name
// (e.g. plan-04's forced-402 stub). Overrides take precedence over built-ins.
export function registerExecutor(executorName: string, executor: Executor): void {
  overrides.set(executorName, executor);
}

export function clearRegisteredExecutors(): void {
  overrides.clear();
}

const overrides = new Map<string, Executor>();

// Registry: tool name → Executor instance, resolved through the tools row's
// `executor` column (the per-tenant tool registry); `executor_config` carries
// per-tool configuration. Unknown tool/executor = { ok:false, error:{code:"TOOL_NOT_FOUND"} }.
export function getExecutor(toolRow: ExecutorToolRow | null): ExecutorLookup {
  if (!toolRow) return { ok: false, error: { code: "TOOL_NOT_FOUND" } };
  const override = overrides.get(toolRow.executor);
  if (override) return { ok: true, executor: override };
  if (toolRow.executor === "github") return { ok: true, executor: new GithubExecutor() };
  if (toolRow.executor === "task") return { ok: true, executor: new TaskCompleteExecutor() };
  // plan-11: treasury demo branch (dev-mode, explicitly labeled — no funds move).
  if (toolRow.executor === "treasury") return { ok: true, executor: new TreasuryExecutor() };
  if (toolRow.executor === "scanner") {
    const endpoint =
      typeof toolRow.executorConfig?.endpoint === "string" ? toolRow.executorConfig.endpoint : null;
    return { ok: true, executor: new ScannerExecutor(endpoint) };
  }
  return { ok: false, error: { code: "TOOL_NOT_FOUND" } };
}
