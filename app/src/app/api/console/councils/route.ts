// Council registry: off-chain M-of-N approver sets (Safe-compatible
// semantics, no contract). Members are wallet addresses; threshold counts
// distinct member signatures on the canonical approval message.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { isAddress } from "viem";
import { config } from "@/server/config";
import { db } from "@/server/db/client";
import { councils, tenants } from "@/server/db/schema";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, "lowercase letters, digits, dashes"),
  members: z.array(z.string()).min(1).max(10),
  threshold: z.number().int().min(1),
  safe_address: z.string().nullable().optional(),
});

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
    const rows = await db().select().from(councils).where(eq(councils.tenantId, tenantId));
    return Response.json({
      ok: true,
      data: rows.map((c) => ({
        id: c.id,
        name: c.name,
        members: c.members as string[],
        threshold: c.threshold,
        safe_address: c.safeAddress,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: { code: "INTERNAL", message } }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const tenantId = await demoTenantId();
    if (!tenantId) {
      return Response.json({ ok: false, error: { code: "TASK_NOT_FOUND", message: "demo tenant missing" } }, { status: 404 });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ ok: false, error: { code: "INVALID_REQUEST", message: "invalid JSON body" } }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ ok: false, error: { code: "INVALID_REQUEST", message: "body must be {name, members[], threshold, safe_address?}" } }, { status: 400 });
    }
    const { name, members, threshold } = parsed.data;
    if (!members.every((m) => isAddress(m))) {
      return Response.json({ ok: false, error: { code: "INVALID_REQUEST", message: "every member must be a wallet address" } }, { status: 400 });
    }
    if (threshold > members.length) {
      return Response.json({ ok: false, error: { code: "INVALID_REQUEST", message: "threshold cannot exceed member count" } }, { status: 400 });
    }
    const [existing] = await db()
      .select()
      .from(councils)
      .where(and(eq(councils.tenantId, tenantId), eq(councils.name, name)));
    if (existing) {
      return Response.json({ ok: false, error: { code: "INVALID_REQUEST", message: `council exists: ${name}` } }, { status: 409 });
    }
    const [row] = await db()
      .insert(councils)
      .values({ tenantId, name, members, threshold, safeAddress: parsed.data.safe_address ?? null })
      .returning();
    return Response.json({
      ok: true,
      data: { id: row.id, name: row.name, members: row.members, threshold: row.threshold, safe_address: row.safeAddress },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: { code: "INTERNAL", message } }, { status: 500 });
  }
}
