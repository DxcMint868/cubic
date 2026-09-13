// One-shot demo-data restorer: seeds the demo tenant, then fires one gateway
// turn per agent so Overview/Agents (audit-event-derived surfaces) have data.
// Run while the dev server is up: pnpm --filter app demo:populate
import "../src/server/load-env";

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3000";

async function json(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(120_000),
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: { message?: string } } | null;
  if (!res.ok || !body?.ok) {
    throw new Error(`${path} → ${res.status} ${body?.error?.message ?? res.statusText}`);
  }
  return body;
}

async function main(): Promise<void> {
  console.log("seeding…");
  await json("/api/demo/seed", { method: "POST" });
  const turns: Array<{ label: string; body: Record<string, unknown> }> = [
    { label: "deploy: read PR", body: { template_id: "deploy-read" } },
    { label: "deploy: scan discovery (free)", body: { template_id: "deploy-scan" } },
    { label: "lab-1: low-rep read", body: { template_id: "branch-low-rep" } },
    { label: "treasury: small stake", body: { template_id: "treasury-stake-small" } },
    { label: "reader: read PR", body: { message: "Read PR #421", agent_key: "agent:reader" } },
  ];
  for (const turn of turns) {
    process.stdout.write(`${turn.label}… `);
    await json("/api/demo/chat", { method: "POST", body: JSON.stringify(turn.body) });
    console.log("ok");
  }
  console.log(`demo data restored — ${BASE}/console should be fully populated`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
