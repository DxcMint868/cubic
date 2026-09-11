import { config } from "../config";
import type { NormalizedIntent, RiskClass } from "../domain";

export interface NormalizeInput {
  tool: string;
  args: Record<string, unknown>;
  taskId: string;
}

// plan-02 EXACT mapping — pure; unknown tools fall through to the last row.
export function normalize({ tool, args, taskId }: NormalizeInput): NormalizedIntent {
  const repo = args.repo;
  let action: string;
  let resource: string;
  let risk: RiskClass;
  let amount: number | undefined;

  switch (tool) {
    case "github.get_pull_request":
      action = "get_pull_request";
      resource = `${String(repo)}#${String(args.pr)}`;
      risk = "low";
      break;
    case "github.read_file":
      action = "read_file";
      resource = `${String(repo)}/${String(args.path)}`;
      risk = "low";
      break;
    case "github.merge_pull_request":
      action = "merge_pull_request";
      resource = `${String(repo)}#${String(args.pr)}`;
      risk = "high";
      break;
    case "deploy.production":
      action = "deploy_production";
      resource = `${String(repo)}`;
      risk = "critical";
      break;
    case "scanner.scan":
      if (args.purchase === true) {
        action = "purchase_security_scan";
        resource = `${String(args.target)}`;
        risk = "medium";
        amount = Number(args.price_usd_cents);
        if (!Number.isFinite(amount)) amount = undefined;
      } else {
        action = "scan";
        resource = `${String(args.target)}`;
        risk = "medium";
      }
      break;
    case "task.complete":
      action = "task_complete";
      resource = taskId;
      risk = "low";
      break;
    default:
      action = tool;
      resource = tool;
      risk = "medium";
      break;
  }

  let resource_class: NormalizedIntent["resource_class"] = "normal";
  if (tool === "github.read_file" && String(args.path).startsWith(".env")) {
    resource_class = "secret";
  } else if (repo !== undefined && repo !== "acme/backend") {
    resource_class = "cross_task";
  }

  const intent: NormalizedIntent = { tool, action, resource, risk_class: risk, resource_class };
  if (amount !== undefined) intent.amount_usd_cents = amount;
  return intent;
}

// Optional LLM assist: only behind LLM_INTENT_PROVIDER; any error (or unset env)
// → the deterministic rules above are the output. With the env unset, zero LLM code executes.
export async function normalizeIntent(input: NormalizeInput): Promise<NormalizedIntent> {
  const base = normalize(input);
  const provider = config().LLM_INTENT_PROVIDER;
  if (!provider) return base;
  try {
    return await llmAssist(provider, input, base);
  } catch {
    return base;
  }
}

async function llmAssist(provider: string, input: NormalizeInput, base: NormalizedIntent): Promise<NormalizedIntent> {
  void input;
  void base;
  throw new Error(`LLM intent provider "${provider}" is not wired in plan-02; deterministic rules apply`);
}
