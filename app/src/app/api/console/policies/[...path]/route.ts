// Per-rule council assignment: PUT …/policies/<name>/rules/<ruleId>
// {council: string | null}. Names the council that must sign escalations
// from this rule (null = single resolver). Council must exist in-tenant.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { config } from "@/server/config";
import { db } from "@/server/db/client";
import { councils, policies, tenants } from "@/server/db/schema";
import type { Rule } from "@/server/gateway/policy/engine";

export const dynamic = "force-dynamic";

const assignSchema = z.object({ council: z.string().min(1).max(64).nullable() });

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await ctx.params;
    const [name, rules, ruleId] = path ?? [];
    if (!name || rules !== "rules" || !ruleId) {
      return Response.json({ ok: false, error: { code: "INVALID_REQUEST", message: "path must be /api/console/policies/<name>/rules/<ruleId>" } }, { status: 400 });
    }
    const [tenant] = await db().select().from(tenants).where(eq(tenants.slug, config().DEMO_TENANT_SLUG));
    if (!tenant) {
      return Response.json({ ok: false, error: { code: "TASK_NOT_FOUND", message: "demo tenant missing" } }, { status: 404 });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ ok: false, error: { code: "INVALID_REQUEST", message: "invalid JSON body" } }, { status: 400 });
    }
    const parsed = assignSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ ok: false, error: { code: "INVALID_REQUEST", message: "body must be {council: string | null}" } }, { status: 400 });
    }
    if (parsed.data.council) {
      const [council] = await db()
        .select()
        .from(councils)
        .where(and(eq(councils.tenantId, tenant.id), eq(councils.name, parsed.data.council)));
      if (!council) {
        return Response.json({ ok: false, error: { code: "INVALID_REQUEST", message: `unknown council: ${parsed.data.council}` } }, { status: 400 });
      }
    }
    const [policy] = await db()
      .select()
      .from(policies)
      .where(and(eq(policies.tenantId, tenant.id), eq(policies.name, name)));
    if (!policy) {
      return Response.json({ ok: false, error: { code: "INVALID_REQUEST", message: `unknown policy: ${name}` } }, { status: 404 });
    }
    const doc = [...(policy.rules as Rule[])];
    const at = doc.findIndex((r) => r.id === ruleId);
    if (at < 0) {
      return Response.json({ ok: false, error: { code: "INVALID_REQUEST", message: `unknown rule: ${ruleId}` } }, { status: 404 });
    }
    doc[at] = parsed.data.council ? { ...doc[at], council: parsed.data.council } : { ...doc[at], council: undefined };
    await db().update(policies).set({ rules: doc }).where(eq(policies.id, policy.id));
    return Response.json({ ok: true, data: { policy: name, rule: ruleId, council: parsed.data.council } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: { code: "INTERNAL", message } }, { status: 500 });
  }
}
