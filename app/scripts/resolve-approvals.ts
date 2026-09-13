// plan-06 demo hook: resolve every pending dev approval for the demo tenant
// by calling the plan-06 resolve route on a running gateway server.
//   pnpm --filter app exec tsx scripts/resolve-approvals.ts
//   BASE_URL=http://localhost:3000 pnpm --filter app exec tsx scripts/resolve-approvals.ts
// Live demos may also resolve approvals manually instead of using this.
import { and, eq } from "drizzle-orm";
import "../src/server/load-env";
import { db } from "../src/server/db/client";
import { approvals, decisions, intents, tasks, tenants } from "../src/server/db/schema";
import { config } from "../src/server/config";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

async function main(): Promise<void> {
  const [tenant] = await db()
    .select()
    .from(tenants)
    .where(eq(tenants.slug, config().DEMO_TENANT_SLUG));
  if (!tenant) throw new Error(`demo tenant missing: ${config().DEMO_TENANT_SLUG}`);

  const pending = await db()
    .select({ id: approvals.id, decisionId: approvals.decisionId })
    .from(approvals)
    .innerJoin(decisions, eq(decisions.id, approvals.decisionId))
    .innerJoin(intents, eq(intents.id, decisions.intentId))
    .innerJoin(tasks, eq(tasks.id, intents.taskId))
    .where(and(eq(tasks.tenantId, tenant.id), eq(approvals.status, "pending"), eq(approvals.provider, "dev")));

  if (pending.length === 0) {
    console.log("no pending approvals for the demo tenant");
    return;
  }

  for (const row of pending) {
    const res = await fetch(`${BASE_URL}/api/approvals/${row.id}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "approved" }),
    });
    const body = (await res.json()) as {
      ok: boolean;
      data?: { capability?: unknown; execution?: unknown };
      error?: { code: string; message: string };
    };
    if (body.ok) {
      console.log(`approved ${row.id}: capability=${body.data?.capability ? "issued" : "none"} execution=${body.data?.execution ? "ran" : "none"}`);
    } else {
      console.error(`failed ${row.id}: ${body.error?.code} ${body.error?.message}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
