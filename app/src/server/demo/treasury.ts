// plan-11 treasury demo — the capital-management branch.
//
// A CIO-flavored run over HTTP against the live gateway (needs `pnpm dev` +
// DATABASE_URL in this shell; no Hedera env — nothing here settles, the
// treasury executor is dev-mode and says so on every receipt):
//
//   pnpm --filter app demo:treasury
//
// Beats: $240k swap → escalate → approve → capability → execution; payroll
// transfer on the same path; the stake pair split (0.5 ETH allows, 50 ETH
// escalates — same action, different outcome, zero new machinery); a $450k
// oversized swap the approver rejects (no capability, no execution, the
// rejection on the record); then the treasury task closes so later runs of
// the main demo keep resolving their own task. Prints trace + console URLs.
//
// Fixture reference rate: $100/ETH — deterministic, not a market quote.
import "../load-env";
import { and, eq } from "drizzle-orm";
import { config } from "../config";
import { db } from "../db/client";
import { agents, policies, tasks, tenants, tools } from "../db/schema";
import type { Rule } from "../gateway/policy/engine";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const AGENT_KEY = "agent:8472";

const TREASURY_TOOLS = [
  { name: "treasury.swap", category: "treasury", defaultRiskClass: "high", executor: "treasury", executorConfig: {} },
  { name: "treasury.transfer", category: "treasury", defaultRiskClass: "high", executor: "treasury", executorConfig: {} },
  { name: "treasury.stake", category: "treasury", defaultRiskClass: "medium", executor: "treasury", executorConfig: {} },
];

function abort(step: string, message: string): never {
  throw new Error(`TREASURY DEMO ABORT [${step}]: ${message}`);
}

function check(step: string, cond: boolean, message: string): void {
  if (!cond) abort(step, message);
}

function say(line: string): void {
  console.log(line);
}

interface ToolCallData {
  intent_id: string;
  decision: "allow" | "deny" | "escalate";
  matched_policy: string;
  matched_rule_id: string;
  reasons: Array<{ code: string; detail?: string }>;
  risk_score: number;
  approval_id: string | null;
  capability: { capability_id: string; action: string; resource: string; nonce: string } | null;
  execution: { execution_id: string; status: "succeeded" | "failed"; result_summary: string | null } | null;
}

interface Envelope {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

async function req(path: string, init?: RequestInit): Promise<{ status: number; json: Envelope }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  return { status: res.status, json: (await res.json()) as Envelope };
}

const get = (path: string) => req(path);
const post = (path: string, body: unknown) =>
  req(path, { method: "POST", body: JSON.stringify(body) });

async function toolCall(tool: string, args: Record<string, unknown>, taskId: string): Promise<ToolCallData> {
  const { status, json } = await post("/api/gateway/tool-call", {
    task_id: taskId,
    agent_key: AGENT_KEY,
    tool,
    arguments: args,
  });
  check(tool, json.ok === true, `tool-call failed (HTTP ${status}): ${JSON.stringify(json)}`);
  return (json.data as unknown) as ToolCallData;
}

async function main(): Promise<void> {
  // Best-effort abort hygiene: if the run dies before [6/7], close the
  // treasury task so its newer open row can't hijack the main demo's
  // latest-open-task lookup. Skipped when the happy path already closed it.
  let taskId: string | null = null;
  let closed = false;
  try {
    await run(taskIdRef => { taskId = taskIdRef; }, () => { closed = true; });
  } finally {
    if (taskId && !closed) {
      try {
        await toolCall("task.complete", {}, taskId);
        say("(abort cleanup: treasury task closed)");
      } catch {
        // Gateway unreachable or task already gone — the next seed clears it.
      }
    }
  }
}

async function run(setTaskId: (id: string) => void, markClosed: () => void): Promise<void> {
  // 1. Preflight — gateway only. No Hedera env needed: nothing settles.
  say("[preflight] GET /api/health …");
  let health: { status: number; json: Envelope };
  try {
    health = await get("/api/health");
  } catch (err) {
    abort("preflight", `gateway unreachable at ${BASE_URL} (is \`pnpm dev\` running?): ${err instanceof Error ? err.message : String(err)}`);
  }
  const healthData = health.json.data as { db?: string } | undefined;
  check("preflight", health.json.ok === true && healthData?.db === "up", `health check failed (HTTP ${health.status}): ${JSON.stringify(health.json)}`);
  say(`[preflight] gateway healthy (db: up) at ${BASE_URL} — no payment leg, no Hedera env needed.`);

  // 2. Fresh demo state, then graft the treasury fixtures (tools, allowlist,
  // capabilities, treasury task) onto the demo tenant.
  say('\n[1/7] POST /api/demo/seed — "Fresh demo state."');
  const seeded = await post("/api/demo/seed", {});
  check("seed", seeded.json.ok === true, `seed failed: ${JSON.stringify(seeded.json)}`);

  const [tenant] = await db().select().from(tenants).where(eq(tenants.slug, config().DEMO_TENANT_SLUG));
  check("fixtures", !!tenant, "demo tenant missing after seed");
  await db().insert(tools).values(TREASURY_TOOLS.map((t) => ({ tenantId: tenant!.id, ...t })));
  const [policy] = await db()
    .select()
    .from(policies)
    .where(and(eq(policies.tenantId, tenant!.id), eq(policies.name, "default-v1")));
  check("fixtures", !!policy, "default-v1 missing after seed");
  const rules = [...(policy!.rules as Rule[])];
  const at = rules.findIndex((r) => r.id === "tool-allowlist");
  check("fixtures", at >= 0, "tool-allowlist rule missing in default-v1");
  rules[at] = { ...rules[at], tools: [...(rules[at].tools ?? []), ...TREASURY_TOOLS.map((t) => t.name)] };
  await db().update(policies).set({ rules }).where(eq(policies.id, policy!.id));
  const [agent] = await db()
    .select()
    .from(agents)
    .where(and(eq(agents.tenantId, tenant!.id), eq(agents.agentKey, AGENT_KEY)));
  check("fixtures", !!agent, `${AGENT_KEY} missing after seed`);
  await db()
    .update(agents)
    .set({ declaredCapabilities: [...((agent!.declaredCapabilities ?? []) as string[]), ...TREASURY_TOOLS.map((t) => t.name)] })
    .where(eq(agents.id, agent!.id));
  const [task] = await db()
    .insert(tasks)
    .values({
      tenantId: tenant!.id,
      agentId: agent!.id,
      title: "Rebalance the $3M treasury: $240k USDC/ETH swap + payroll + staking review (budget $500)",
      budgetUsdCents: 50000,
      status: "open",
    })
    .returning();
  const taskId = task.id;
  setTaskId(taskId);
  say(`        treasury fixtures grafted — task: "${task.title}"`);

  // 3. The $240k rebalance swap — high risk → ESCALATE → approve → execute.
  say('\n[2/7] treasury.swap {asset_pair:"USDC/ETH", $240,000} — the CIO rebalance');
  const swap = await toolCall("treasury.swap", { asset_pair: "USDC/ETH", amount_usd_cents: 24_000_000 }, taskId);
  check("swap", swap.decision === "escalate", `expected escalate, got ${swap.decision} (${swap.matched_rule_id})`);
  check("swap", swap.reasons.some((r) => r.code === "risk_requires_approval"), `expected risk_requires_approval, got ${JSON.stringify(swap.reasons)}`);
  say(`        decision=escalate rule=${swap.matched_policy}/${swap.matched_rule_id} approval=${swap.approval_id}`);
  const swapResolved = await post(`/api/approvals/${swap.approval_id}/resolve`, { outcome: "approved" });
  check("resolve-swap", swapResolved.json.ok === true, `resolve failed: ${JSON.stringify(swapResolved.json)}`);
  const sdata = swapResolved.json.data as unknown as ToolCallData;
  check("resolve-swap", !!sdata.capability && sdata.execution?.status === "succeeded", `expected capability + execution, got ${JSON.stringify(sdata)}`);
  say(`        approved → ${sdata.execution!.result_summary}`);

  // 4. Payroll — same high-risk path.
  say('\n[3/7] treasury.transfer {destination:"payroll/ops-multisig", $85,000} — payroll Friday');
  const payroll = await toolCall("treasury.transfer", { destination: "payroll/ops-multisig", amount_usd_cents: 8_500_000 }, taskId);
  check("payroll", payroll.decision === "escalate", `expected escalate, got ${payroll.decision}`);
  check("payroll", payroll.reasons.some((r) => r.code === "risk_requires_approval"), `expected risk_requires_approval, got ${JSON.stringify(payroll.reasons)}`);
  say(`        decision=escalate rule=${payroll.matched_policy}/${payroll.matched_rule_id} approval=${payroll.approval_id}`);
  const payrollResolved = await post(`/api/approvals/${payroll.approval_id}/resolve`, { outcome: "approved" });
  check("resolve-payroll", payrollResolved.json.ok === true, `resolve failed: ${JSON.stringify(payrollResolved.json)}`);
  const pdata = payrollResolved.json.data as unknown as ToolCallData;
  check("resolve-payroll", pdata.execution?.status === "succeeded", `expected execution succeeded, got ${JSON.stringify(pdata.execution)}`);
  say(`        approved → ${pdata.execution!.result_summary}`);

  // 5. The killer pair: same action, different outcome — 0.5 ETH allows,
  // 50 ETH escalates. Zero new machinery: the existing risk rule splits them.
  say("\n[4/7] treasury.stake pair — same action, different outcome (fixture rate $100/ETH)");
  const small = await toolCall("treasury.stake", { protocol: "lido", amount_usd_cents: 5_000 }, taskId);
  check("stake-small", small.decision === "allow", `expected allow, got ${small.decision} (${small.matched_rule_id})`);
  check("stake-small", small.execution?.status === "succeeded", `expected execution succeeded, got ${JSON.stringify(small.execution)}`);
  say(`        0.5 ETH (≈$50) → ALLOW (${small.matched_rule_id}) → ${small.execution!.result_summary}`);
  const large = await toolCall("treasury.stake", { protocol: "lido", amount_usd_cents: 500_000 }, taskId);
  check("stake-large", large.decision === "escalate", `expected escalate, got ${large.decision}`);
  say(`        50 ETH (≈$5,000) → ESCALATE (${large.matched_rule_id}) — same action, risk did the talking`);
  const largeResolved = await post(`/api/approvals/${large.approval_id}/resolve`, { outcome: "approved" });
  check("resolve-stake", largeResolved.json.ok === true, `resolve failed: ${JSON.stringify(largeResolved.json)}`);

  // 6. The $450k drain — the approver rejects. No capability, no execution,
  // and the rejection is on the record.
  say('\n[5/7] treasury.swap {asset_pair:"USDC/ETH", $450,000} — oversized, CIO rejects');
  const drain = await toolCall("treasury.swap", { asset_pair: "USDC/ETH", amount_usd_cents: 45_000_000 }, taskId);
  check("drain", drain.decision === "escalate", `expected escalate, got ${drain.decision}`);
  const drainResolved = await post(`/api/approvals/${drain.approval_id}/resolve`, { outcome: "rejected" });
  check("reject-drain", drainResolved.json.ok === true, `resolve failed: ${JSON.stringify(drainResolved.json)}`);
  const ddata = drainResolved.json.data as { approval_outcome: string; capability: unknown; execution: unknown };
  check("reject-drain", ddata.approval_outcome === "rejected", `expected rejected, got ${JSON.stringify(ddata)}`);
  check("reject-drain", ddata.capability === null && ddata.execution === null, `rejected swap must leave no capability/execution, got ${JSON.stringify(ddata)}`);
  say("        REJECTED — no capability, no execution (ledger.approval.completed outcome=rejected)");

  // 7. Close the treasury task so the main demo keeps resolving its own task.
  say("\n[6/7] tool-call task.complete — closing the treasury books");
  const done = await toolCall("task.complete", {}, taskId);
  check("complete", done.decision === "allow", `expected allow, got ${done.decision}`);
  check("complete", done.execution?.status === "succeeded", `expected execution succeeded, got ${JSON.stringify(done.execution)}`);
  markClosed();

  // 8. Trace + console URLs, beat table.
  say("\n[7/7] Trace + beat summary (same events stream to /network live):");
  say(`        trace: ${BASE_URL}/api/audit/trace/${taskId}, ${BASE_URL}/console/tasks/${taskId}`);
  say("        +-------+-----------------------------------------------+----------+");
  say("        | beat  | step                                          | outcome  |");
  say("        +-------+-----------------------------------------------+----------+");
  say("        | treas | $240k swap via approval (dev stand-in)        | APPROVED |");
  say("        | treas | $85k payroll via approval                     | APPROVED |");
  say("        | treas | 0.5 ETH stake auto-allows, 50 ETH escalates   | SPLIT    |");
  say("        | treas | $450k oversized swap rejected by approver     | REJECTED |");
  say("        +-------+-----------------------------------------------+----------+");
  say("\nTREASURY GREEN — every assertion passed (dev mode: no funds moved).");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
