import { db } from "../../db/client";
import { approvals } from "../../db/schema";
import type { RiskClass } from "../../domain";

export interface ApprovalRequestInput {
  decision_id: string;
  action: string;
  resource: string;
  risk_class: RiskClass;
  reason_codes: string[];
}

export interface ApprovalProvider {
  request(input: ApprovalRequestInput): Promise<{ approval_id: string }>;
}

// Canonical dev provider — plan-06 adds the Ledger implementation of this same interface.
// Until the plan-06 resolution endpoint exists, escalation's terminal state is "pending".
export class DevApprovalProvider implements ApprovalProvider {
  async request(input: ApprovalRequestInput): Promise<{ approval_id: string }> {
    const [row] = await db()
      .insert(approvals)
      .values({
        decisionId: input.decision_id,
        type: "ledger",
        provider: "dev",
        status: "pending",
      })
      .returning();
    return { approval_id: row.id };
  }
}

let active: ApprovalProvider = new DevApprovalProvider();

export function setApprovalProvider(provider: ApprovalProvider): void {
  active = provider;
}

export function getApprovalProvider(): ApprovalProvider {
  return active;
}
