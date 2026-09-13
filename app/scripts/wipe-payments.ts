// Wipe payments surfaces (payments rows + payment audit events) for the demo
// tenant — everything else stays. For re-shooting the x402 beat with a clean
// console. Dev server must be up: pnpm --filter app demo:wipe-payments
import "../src/server/load-env";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/server/db/client";
import { auditEvents, capabilities, decisions, intents, payments, tasks, tenants } from "../src/server/db/schema";

const DEMO_SLUG = process.env.DEMO_TENANT_SLUG ?? "demo";

async function main(): Promise<void> {
  const [tenant] = await db().select().from(tenants).where(eq(tenants.slug, DEMO_SLUG));
  if (!tenant) throw new Error(`tenant missing: ${DEMO_SLUG}`);

  // Payments hang off capabilities → decisions → intents → tasks; scope by tenant.
  const rows = await db()
    .select({ paymentId: payments.id })
    .from(payments)
    .innerJoin(capabilities, eq(capabilities.id, payments.capabilityId))
    .innerJoin(decisions, eq(decisions.id, capabilities.decisionId))
    .innerJoin(intents, eq(intents.id, decisions.intentId))
    .innerJoin(tasks, eq(tasks.id, intents.taskId))
    .where(eq(tasks.tenantId, tenant.id));
  if (rows.length) {
    await db().delete(payments).where(inArray(payments.id, rows.map((r) => r.paymentId)));
  }

  const deleted = await db()
    .delete(auditEvents)
    .where(
      and(
        eq(auditEvents.tenantId, tenant.id),
        inArray(auditEvents.eventType, ["payment.requested", "payment.completed", "payment.failed"]),
      ),
    )
    .returning({ id: auditEvents.id });

  console.log(`wiped: ${rows.length} payment rows, ${deleted.length} payment events`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
