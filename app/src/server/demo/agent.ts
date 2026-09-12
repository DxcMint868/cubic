// plan-10 scripted demo agent — the 2–4 minute end-to-end run.
//
// Happy path (default): drives the LIVE gateway over HTTP, narrating each
// step, asserting the deterministic outcome, aborting loudly on mismatch.
// Adversarial fixtures (`--adversarial`): six scripted attack/edge sequences
// run IN-PROCESS against the same pipeline (no HTTP server needed), each
// asserting its exact reason code.
//
//   pnpm --filter app demo                    # happy path (needs `pnpm dev` + Hedera env)
//   pnpm --filter app demo:adversarial        # six fixtures (needs DATABASE_URL only)
//   BASE_URL=https://cubic.example pnpm --filter app demo
import "../load-env";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { config } from "../config";
import { db } from "../db/client";
import { agents, auditEvents, capabilities, tasks, tenants, tools } from "../db/schema";
import { consumeCapability } from "../capability/verify";
import { runToolCall } from "../gateway/orchestrator";
import { setContextProvider } from "../gateway/context/provider";
import { GraphContextProvider } from "../gateway/context/graphProvider";
import { seed } from "./seed";
import { POST as scannerPOST } from "../../app/api/services/scanner/scan/route";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const AGENT_KEY = "agent:8472";

function abort(step: string, message: string): never {
  // Throw (don't process.exit): main()'s catch prints + exits 1, and a throw
  // inside the adversarial block still runs its finally (DB restore).
  throw new Error(`DEMO ABORT [${step}]: ${message}`);
}

function check(step: string, cond: boolean, message: string): void {
  if (!cond) abort(step, message);
}

function say(line: string): void {
  console.log(line);
}

// ---------------------------------------------------------------------------
// HTTP helpers (happy path)
// ---------------------------------------------------------------------------

interface ToolCallData {
  intent_id: string;
  decision: "allow" | "deny" | "escalate";
  matched_policy: string;
  matched_rule_id: string;
  reasons: Array<{ code: string; detail?: string }>;
  risk_score: number;
  approval_id: string | null;
  payment_required: { price_usd_cents: number; challenge: unknown } | null;
  capability: {
    capability_id: string;
    subject: string;
    action: string;
    resource: string;
    constraints: Record<string, unknown>;
    budget_usd_cents: number | null;
    expires_at: string;
    nonce: string;
    policy_hash: string;
  } | null;
  payment: {
    payment_id: string;
    status: "completed" | "failed";
    settlement_ref: string | null;
    error_code: string | null;
  } | null;
  execution: { execution_id: string; status: "succeeded" | "failed"; result_summary: string | null } | null;
}

interface Envelope {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

async function post(path: string, body: unknown): Promise<{ status: number; json: Envelope }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Envelope;
  return { status: res.status, json };
}

async function get(path: string): Promise<{ status: number; json: Envelope }> {
  const res = await fetch(`${BASE_URL}${path}`);
  const json = (await res.json()) as Envelope;
  return { status: res.status, json };
}

async function toolCall(tool: string, args: Record<string, unknown>, taskId: string, origin?: string): Promise<ToolCallData> {
  const { status, json } = await post("/api/gateway/tool-call", {
    task_id: taskId,
    agent_key: AGENT_KEY,
    tool,
    arguments: args,
    ...(origin ? { origin } : {}),
  });
  if (!json.ok) {
    const err = json.error as { code: string; message: string };
    abort(`tool-call ${tool}`, `HTTP ${status} ${err?.code}: ${err?.message}`);
  }
  return (json.data as unknown) as ToolCallData;
}

async function happyPath(): Promise<void> {
  // Preflight FIRST: the demo must never limp through a wrong state.
  say("[preflight] GET /api/health …");
  let health: { status: number; json: Envelope };
  try {
    health = await get("/api/health");
  } catch (err) {
    abort("preflight", `gateway unreachable at ${BASE_URL} (is \`pnpm dev\` running?): ${err instanceof Error ? err.message : String(err)}`);
  }
  const healthData = health.json.data as { db?: string } | undefined;
  check("preflight", health.json.ok === true && healthData?.db === "up", `health check failed (HTTP ${health.status}): ${JSON.stringify(health.json)}`);
  say(`[preflight] gateway healthy (db: up) at ${BASE_URL}`);
  try {
    const baseHost = new URL(BASE_URL).hostname;
    if (baseHost !== "localhost" && baseHost !== "127.0.0.1") {
      say(`[preflight] WARNING: remote BASE_URL — the purchase leg still settles against the seeded loopback scanner endpoint unless the demo tenant's scanner.scan tool row was repointed.`);
    }
  } catch {
    abort("preflight", `BASE_URL is not a valid URL: ${BASE_URL}`);
  }
  for (const name of ["HEDERA_OPERATOR_ID", "HEDERA_OPERATOR_KEY"] as const) {
    check("preflight", !!process.env[name], `${name} is not set — the paid steps (Beat 4) cannot settle. Set it in app/.env.local (server) and in this shell, then re-run.`);
  }
  say("[preflight] HEDERA_OPERATOR_* present — paid steps can settle on testnet.");

  // 1. Fresh demo state.
  say('\n[1/11] POST /api/demo/seed — "Fresh demo state."');
  const seeded = await post("/api/demo/seed", {});
  check("seed", seeded.json.ok === true, `seed failed: ${JSON.stringify(seeded.json)}`);
  say(`        fresh demo state: ${JSON.stringify(seeded.json.data)}`);

  // 2. Seeded task for agent:8472 — queried by agent, no id literals.
  say("\n[2/11] Resolving the seeded task for agent:8472 (query tasks by agent) …");
  const [tenant] = await db().select().from(tenants).where(eq(tenants.slug, config().DEMO_TENANT_SLUG));
  check("task", !!tenant, "demo tenant missing after seed");
  const [agent] = await db().select().from(agents).where(and(eq(agents.tenantId, tenant!.id), eq(agents.agentKey, AGENT_KEY)));
  check("task", !!agent, `${AGENT_KEY} missing after seed`);
  const [task] = await db()
    .select()
    .from(tasks)
    .where(and(eq(tasks.tenantId, tenant!.id), eq(tasks.agentId, agent!.id), eq(tasks.status, "open")))
    .orderBy(desc(tasks.createdAt))
    .limit(1);
  check("task", !!task, `no open task for ${AGENT_KEY} after seed`);
  const taskId = task!.id;
  say(`        task: "${task!.title}" (budget $${((task!.budgetUsdCents ?? 0) / 100).toFixed(2)})`);

  // 3. Read the PR — low risk, reputable agent → ALLOW (Beat 2: the gateway path).
  say('\n[3/11] Beat 2 — tool-call github.get_pull_request {repo:"acme/backend",pr:421}');
  const read = await toolCall("github.get_pull_request", { repo: "acme/backend", pr: 421 }, taskId);
  check("get-pr", read.decision === "allow", `expected allow, got ${read.decision} (${read.matched_rule_id})`);
  say(`        decision=${read.decision} rule=${read.matched_policy}/${read.matched_rule_id} (risk ${read.risk_score})`);

  // 4. Undiscovered scan — the executor hits the live 402 (Beat 4 begins).
  say('\n[4/11] Beat 4 — tool-call scanner.scan {target:"acme/backend#421"} (no purchase yet)');
  const discovered = await toolCall("scanner.scan", { target: "acme/backend#421" }, taskId);
  check("discover", discovered.payment_required !== null, `expected payment_required, got decision=${discovered.decision}`);
  check("discover", discovered.payment_required!.price_usd_cents === 25, `expected price 25¢, got ${discovered.payment_required!.price_usd_cents}¢`);
  check("discover", discovered.execution === null, "discovery must not execute");
  say(`        402 → payment_required: ${discovered.payment_required!.price_usd_cents}¢ on hedera (service.discovered, no execution)`);

  // 5. Purchase the scan — bounded spend, real Blocky402 settlement.
  say('\n[5/11] Beat 4 — tool-call scanner.scan {purchase:true, price_usd_cents:25} (origin payment_discovery)');
  const purchased = await toolCall(
    "scanner.scan",
    { target: "acme/backend#421", purchase: true, price_usd_cents: 25 },
    taskId,
    "payment_discovery",
  );
  check("purchase", purchased.decision === "allow", `expected allow, got ${purchased.decision} (${purchased.matched_rule_id})`);
  check("purchase", purchased.matched_policy === "payment-v1", `expected payment-v1, got ${purchased.matched_policy}`);
  check("purchase", purchased.payment?.status === "completed", `expected payment completed, got ${JSON.stringify(purchased.payment)}`);
  check("purchase", purchased.execution?.status === "succeeded", `expected execution succeeded, got ${JSON.stringify(purchased.execution)}`);
  say(`        ALLOW (payment-v1) → payment completed → report`);
  say(`        settlement ref: ${purchased.payment!.settlement_ref}`);

  // 6. High-risk merge → ESCALATE (Beat 5 begins). The resolve below is the
  // dev stand-in: on hardware this is the Ledger approval; the event chain
  // (approval.requested → approval.completed → issued → executed) is identical.
  say('\n[6/11] Beat 5 — tool-call github.merge_pull_request {repo:"acme/backend",pr:421}');
  const merge = await toolCall("github.merge_pull_request", { repo: "acme/backend", pr: 421 }, taskId);
  check("merge", merge.decision === "escalate", `expected escalate, got ${merge.decision} (${merge.matched_rule_id})`);
  check("merge", merge.approval_id !== null, "escalate must carry an approval_id");
  say(`        decision=escalate rule=${merge.matched_policy}/${merge.matched_rule_id} approval=${merge.approval_id}`);

  // 7. Resolve the approval (dev stand-in for the Ledger device approval).
  say(`\n[7/11] Beat 5 — POST /api/approvals/${merge.approval_id}/resolve {approved} (dev stand-in for Ledger approval)`);
  const resolved = await post(`/api/approvals/${merge.approval_id}/resolve`, { outcome: "approved" });
  check("resolve-merge", resolved.json.ok === true, `resolve failed: ${JSON.stringify(resolved.json)}`);
  const rdata = resolved.json.data as unknown as ToolCallData;
  check("resolve-merge", !!rdata.capability && !!rdata.execution, `expected capability + execution, got ${JSON.stringify(rdata)}`);
  say(`        approved → capability nonce ${rdata.capability!.nonce.slice(0, 12)}… → execution ${rdata.execution!.status}`);

  // 8. Production deploy — critical risk → ESCALATE → approve → execute.
  say('\n[8/11] Beat 5 — tool-call deploy.production {repo:"acme/backend"} → escalate → resolve approved');
  const deploy = await toolCall("deploy.production", { repo: "acme/backend" }, taskId);
  check("deploy", deploy.decision === "escalate", `expected escalate, got ${deploy.decision} (${deploy.matched_rule_id})`);
  check("deploy", deploy.approval_id !== null, "escalate must carry an approval_id");
  const deployResolved = await post(`/api/approvals/${deploy.approval_id}/resolve`, { outcome: "approved" });
  check("resolve-deploy", deployResolved.json.ok === true, `resolve failed: ${JSON.stringify(deployResolved.json)}`);
  const ddata = deployResolved.json.data as unknown as ToolCallData;
  check("resolve-deploy", ddata.execution?.status === "succeeded", `expected execution succeeded, got ${JSON.stringify(ddata.execution)}`);
  say(`        approved → execution ${ddata.execution!.status}: ${ddata.execution!.result_summary}`);

  // 9. Prompt-injected forbidden read → deterministic DENY (Beat 6).
  say('\n[9/11] Beat 6 — ATTACK: tool-call github.read_file {path:".env.production"} (prompt-injected secret read)');
  const attack = await toolCall("github.read_file", { repo: "acme/backend", path: ".env.production" }, taskId);
  check("attack", attack.decision === "deny", `expected deny, got ${attack.decision}`);
  check("attack", attack.reasons.some((r) => r.code === "secret_resource"), `expected secret_resource, got ${JSON.stringify(attack.reasons)}`);
  say(`        DENY reason=secret_resource — the injected instruction died at the policy engine`);

  // 10. Close the task.
  say("\n[10/11] tool-call task.complete");
  const done = await toolCall("task.complete", {}, taskId);
  check("complete", done.decision === "allow", `expected allow, got ${done.decision}`);
  check("complete", done.execution?.status === "succeeded", `expected execution succeeded, got ${JSON.stringify(done.execution)}`);
  const trace = await get(`/api/audit/trace/${taskId}`);
  check("complete", trace.json.ok === true, `trace fetch failed: ${JSON.stringify(trace.json)}`);
  const events = ((trace.json.data as { events?: Array<{ event_type: string }> }).events ?? []).map((e) => e.event_type);
  check("complete", events.includes("task.completed"), `task.completed missing from trace: ${events.join(",")}`);
  say("        task.completed — full chain queryable.");

  // 11. Trace URL + beat summary (Beat 7: the same events feed /network live).
  say("\n[11/11] Trace + beat summary (Beat 7 — these events are live in /network):");
  say(`        trace: ${BASE_URL}/api/audit/trace/${taskId}`);
  say("        +-------+-----------------------------------------------+----------+");
  say("        | beat  | step                                          | outcome  |");
  say("        +-------+-----------------------------------------------+----------+");
  say("        |   2   | read PR through the gateway                   | ALLOW    |");
  say("        |   4   | paid scan: 402 → budget policy → settlement   | PAID 25¢ |");
  say("        |   5   | merge + deploy via approval (dev stand-in)    | APPROVED |");
  say("        |   6   | prompt-injected secret read                   | DENIED   |");
  say("        |   7   | trace above; same events stream to /network   | LIVE     |");
  say("        +-------+-----------------------------------------------+----------+");
  say("\nDEMO GREEN — every assertion passed.");
}

// ---------------------------------------------------------------------------
// Adversarial fixtures (in-process; needs DATABASE_URL only, no HTTP server)
// ---------------------------------------------------------------------------

type Origin = "agent" | "payment_discovery";

function startScannerServer(): Promise<{ url: string; close: () => void }> {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const webReq = new Request(`http://127.0.0.1${req.url ?? "/"}`, {
      method: req.method ?? "POST",
      headers: req.headers as Record<string, string>,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    let webRes: Response;
    try {
      webRes = await scannerPOST(webReq);
    } catch (err) {
      webRes = Response.json({ ok: false, error: { code: "INTERNAL", message: String(err) } }, { status: 500 });
    }
    res.statusCode = webRes.status;
    for (const [key, value] of webRes.headers) res.setHeader(key, value);
    res.end(Buffer.from(await webRes.arrayBuffer()));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ url: `http://127.0.0.1:${port}/api/services/scanner/scan`, close: () => server.close() });
    });
  });
}

async function adversarial(): Promise<void> {
  // Deterministic settlement failure for the failed-payment fixture: set
  // BEFORE any pipeline call — and drop the config singleton cache, because
  // route modules imported above may already have parsed the env (config() is
  // lazy but import-time calls happen before main() runs). Process-wide scope
  // is fine here: only the purchase path reads this flag, and no other
  // fixture settles.
  process.env.X402_SIMULATE_FAILURE = "1";
  delete (globalThis as Record<string, unknown>).__cubicConfig;
  // The low-reputation fixture needs the Graph trust path (the default auto
  // provider stays static without a subgraph URL); the demo fixture identity
  // short-circuits in-process, never networked.
  setContextProvider(new GraphContextProvider());

  say("[adversarial] seeding fresh demo state …");
  await seed();
  const [tenant] = await db().select().from(tenants).where(eq(tenants.slug, config().DEMO_TENANT_SLUG));
  if (!tenant) abort("seed", "demo tenant missing after seed");
  const agents8472 = await db().select().from(agents).where(and(eq(agents.tenantId, tenant!.id), eq(agents.agentKey, AGENT_KEY)));
  const agent8472 = agents8472[0]!;
  const lab1 = (await db().select().from(agents).where(and(eq(agents.tenantId, tenant!.id), eq(agents.agentKey, "agent:lab-1"))))[0];
  if (!lab1) abort("seed", "agent:lab-1 missing after seed");

  // Point the seeded scanner executor at a local loopback of the real scan
  // route (same handler the dev server serves); re-seed at the end restores
  // the fixture endpoint.
  const scanner = await startScannerServer();
  await db().update(tools).set({ executorConfig: { endpoint: scanner.url } }).where(eq(tools.tenantId, tenant!.id));

  const results: Array<[string, string]> = [];
  try {
    const call = (taskId: string, agentKey: string, tool: string, args: Record<string, unknown>, origin?: Origin) =>
      runToolCall({ task_id: taskId, agent_key: agentKey, tool, arguments: args, ...(origin ? { origin } : {}) } as never);

    const newTask = async (title: string, budget: number, agentId: string) => {
      const [row] = await db().insert(tasks).values({ tenantId: tenant!.id, agentId, title, budgetUsdCents: budget, status: "open" }).returning();
      return row.id;
    };

    // 1. Prompt injection → forbidden secret read → DENY secret_resource.
    {
      const taskId = await newTask("adversarial: prompt injection", 50, agent8472.id);
      const r = await call(taskId, AGENT_KEY, "github.read_file", { repo: "acme/backend", path: ".env.production" });
      check("prompt-injection", r.ok && r.data.decision === "deny", `expected deny, got ${JSON.stringify(r)}`);
      check("prompt-injection", r.ok && r.data.reasons[0]?.code === "secret_resource", `expected secret_resource, got ${JSON.stringify(r.ok && r.data.reasons)}`);
      results.push(["prompt injection → secret read", "DENY secret_resource"]);
    }

    // 2. Over budget → purchase denied before any money moves.
    {
      const taskId = await newTask("adversarial: over budget", 10, agent8472.id);
      const r = await call(taskId, AGENT_KEY, "scanner.scan", { target: "acme/backend#421", purchase: true, price_usd_cents: 25 }, "payment_discovery");
      check("over-budget", r.ok && r.data.decision === "deny", `expected deny, got ${JSON.stringify(r)}`);
      check("over-budget", r.ok && r.data.reasons[0]?.code === "budget_exceeded", `expected budget_exceeded, got ${JSON.stringify(r.ok && r.data.reasons)}`);
      check("over-budget", r.ok && r.data.payment === null && r.data.execution === null, "denied purchase must leave no payment/execution");
      results.push(["over budget (10¢ task, 25¢ scan)", "DENY budget_exceeded"]);
    }

    // 3. Expired capability → consume rejects with expired. The discovery
    // capability stays issued-but-unconsumed, so it is the live row to expire.
    {
      const taskId = await newTask("adversarial: expired capability", 50, agent8472.id);
      const d = await call(taskId, AGENT_KEY, "scanner.scan", { target: "acme/backend#421" });
      check("expired-setup", d.ok && !!d.data.capability, `discovery setup failed: ${JSON.stringify(d)}`);
      const capId = (d.ok && d.data.capability!.capability_id) as string;
      await db().update(capabilities).set({ expiresAt: new Date(Date.now() - 60_000).toISOString() }).where(eq(capabilities.id, capId));
      const consumed = await consumeCapability(capId, { action: "scan", resource: "acme/backend#421" });
      check("expired", consumed.status === "rejected" && consumed.reason === "expired", `expected rejected/expired, got ${JSON.stringify(consumed)}`);
      results.push(["expired capability", "rejected expired"]);
    }

    // 4. Tampered capability → unknown id rejects with not_found (no event:
    // nothing attributable exists — plan-03 exemption).
    {
      const consumed = await consumeCapability(randomUUID(), { action: "scan", resource: "acme/backend#421" });
      check("tampered", consumed.status === "rejected" && consumed.reason === "not_found", `expected rejected/not_found, got ${JSON.stringify(consumed)}`);
      results.push(["tampered capability (random uuid)", "rejected not_found"]);
    }

    // 5. Failed payment → payment.failed, capability revoked, zero executions.
    {
      const taskId = await newTask("adversarial: failed payment", 50, agent8472.id);
      const r = await call(taskId, AGENT_KEY, "scanner.scan", { target: "acme/backend#421", purchase: true, price_usd_cents: 25 }, "payment_discovery");
      check("failed-payment", r.ok && r.data.payment?.status === "failed", `expected payment failed, got ${JSON.stringify(r)}`);
      check("failed-payment", r.ok && r.data.payment?.error_code === "SIMULATED_SETTLEMENT_FAILURE", `expected SIMULATED_SETTLEMENT_FAILURE, got ${JSON.stringify(r.ok && r.data.payment)}`);
      check("failed-payment", r.ok && r.data.execution === null, "failed payment must not execute");
      const capRows = await db().select().from(capabilities).where(eq(capabilities.id, (r.ok && r.data.capability!.capability_id) as string));
      check("failed-payment", capRows[0]?.status === "revoked", `expected capability revoked, got ${capRows[0]?.status}`);
      const taskEvents = await db().select().from(auditEvents).where(eq(auditEvents.taskId, taskId));
      check("failed-payment", taskEvents.some((e) => e.eventType === "payment.failed"), "payment.failed missing");
      check("failed-payment", !taskEvents.some((e) => e.eventType.startsWith("tool.execution.")), "failed payment must emit zero tool.execution.* events");
      results.push(["failed payment (simulated)", "payment.failed + revoked, 0 executions"]);
    }

    // 6. Low reputation → ESCALATE reputation_below_threshold (Graph fixture).
    {
      const taskId = await newTask("adversarial: low reputation", 50, lab1!.id);
      const r = await call(taskId, "agent:lab-1", "github.get_pull_request", { repo: "acme/backend", pr: 421 });
      check("low-reputation", r.ok && r.data.decision === "escalate", `expected escalate, got ${JSON.stringify(r)}`);
      check("low-reputation", r.ok && r.data.reasons.some((x) => x.code === "reputation_below_threshold"), `expected reputation_below_threshold, got ${JSON.stringify(r.ok && r.data.reasons)}`);
      results.push(["low reputation (lab-1, 0.50)", "ESCALATE reputation_below_threshold"]);
    }
  } finally {
    scanner.close();
    await seed(); // restore fixture endpoint + clear adversarial rows (demo tenant only)
  }

  say("\nADVERSARIAL GREEN — all six fixtures produced their deterministic outcome:");
  for (const [name, outcome] of results) say(`  PASS  ${name} → ${outcome}`);
}

async function main(): Promise<void> {
  if (process.argv.includes("--adversarial")) {
    await adversarial();
  } else {
    await happyPath();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
