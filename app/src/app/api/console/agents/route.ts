// Agent registry: every agent row in the demo tenant with its human-readable
// name + key. The console agents list merges this with audit-derived stats
// so humans see names, never raw UUIDs.
import { eq } from "drizzle-orm";
import { config } from "@/server/config";
import { db } from "@/server/db/client";
import { agents, tenants } from "@/server/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [tenant] = await db().select().from(tenants).where(eq(tenants.slug, config().DEMO_TENANT_SLUG));
    if (!tenant) {
      return Response.json(
        { ok: false, error: { code: "TASK_NOT_FOUND", message: "demo tenant missing" } },
        { status: 404 },
      );
    }
    const rows = await db().select().from(agents).where(eq(agents.tenantId, tenant.id));
    return Response.json({
      ok: true,
      data: rows.map((a) => ({
        id: a.id,
        agent_key: a.agentKey,
        name: a.name,
        environment: a.environment,
        status: a.status,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: { code: "INTERNAL", message } }, { status: 500 });
  }
}
