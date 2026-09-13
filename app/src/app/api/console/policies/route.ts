// Policy documents (full rule JSON) + per-rule council assignment. The
// policies console lists observed rules from the audit log; this endpoint
// serves the source documents so a rule can name its required council
// (or null for a single resolver). Demo config surface, versioned in place.
import { eq } from "drizzle-orm";
import { config } from "@/server/config";
import { db } from "@/server/db/client";
import { policies, tenants } from "@/server/db/schema";
import type { Rule } from "@/server/gateway/policy/engine";

export const dynamic = "force-dynamic";

async function demoTenantId(): Promise<string | null> {
  const [tenant] = await db().select().from(tenants).where(eq(tenants.slug, config().DEMO_TENANT_SLUG));
  return tenant?.id ?? null;
}

export async function GET() {
  try {
    const tenantId = await demoTenantId();
    if (!tenantId) {
      return Response.json({ ok: false, error: { code: "TASK_NOT_FOUND", message: "demo tenant missing" } }, { status: 404 });
    }
    const rows = await db().select().from(policies).where(eq(policies.tenantId, tenantId));
    return Response.json({
      ok: true,
      data: rows.map((p) => ({
        name: p.name,
        version: p.version,
        rules: (p.rules as Rule[]).map((r) => ({
          id: r.id,
          type: r.type,
          decision: r.decision,
          reason: r.reason,
          council: r.council ?? null,
        })),
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: { code: "INTERNAL", message } }, { status: 500 });
  }
}
