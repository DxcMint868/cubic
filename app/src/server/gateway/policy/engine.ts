import type {
  DecisionResult, DecisionType, Facts, NormalizedIntent, ReasonCode, RiskClass,
} from "../../domain";

export type RuleType =
  | "resource_class"
  | "tool_allowlist"
  | "service_allowlist"
  | "budget"
  | "min_reputation"
  | "risk_class"
  | "default";

export interface Rule {
  id: string;
  type: RuleType;
  match?: string[];
  tools?: string[];
  services?: string[];
  min?: number;
  decision: DecisionType;
  reason: ReasonCode;
}

const RISK_SCORE: Record<RiskClass, 10 | 40 | 70 | 90> = {
  low: 10, medium: 40, high: 70, critical: 90,
};

export function serviceFor(intent: NormalizedIntent): string | null {
  return intent.action === "purchase_security_scan" ? "scanner" : null;
}

export function selectPolicy(intent: NormalizedIntent): string {
  if (intent.amount_usd_cents != null) return "payment-v1";
  if (intent.action === "merge_pull_request") return "production-merge-v1";
  return "default-v1";
}

function ruleApplies(rule: Rule, intent: NormalizedIntent, facts: Facts): boolean {
  switch (rule.type) {
    case "resource_class":
      return (rule.match ?? []).includes(intent.resource_class);
    case "tool_allowlist":
      return !(rule.tools ?? []).includes(intent.tool);
    case "service_allowlist": {
      const service = serviceFor(intent);
      return service !== null && !(rule.services ?? []).includes(service);
    }
    case "budget": {
      const amount = intent.amount_usd_cents;
      if (facts.task_budget_usd_cents == null) return true;
      if (amount == null) return false;
      return amount > facts.task_budget_usd_cents - facts.budget_spent_usd_cents;
    }
    case "min_reputation":
      return facts.agent_reputation < (rule.min ?? 0);
    case "risk_class":
      return (rule.match ?? []).includes(intent.risk_class);
    case "default":
      return true;
  }
}

// Pure: no DB, no clock, no randomness. Rules evaluated in array order, first match wins.
export function evaluate(
  intent: NormalizedIntent,
  facts: Facts,
  policyRules: Rule[],
  policyName = "",
): DecisionResult {
  for (const rule of policyRules) {
    if (ruleApplies(rule, intent, facts)) {
      return {
        decision: rule.decision,
        matched_policy: policyName,
        matched_rule_id: rule.id,
        reasons: [{ code: rule.reason }],
        risk_score: RISK_SCORE[intent.risk_class],
      };
    }
  }
  return {
    decision: "deny",
    matched_policy: policyName,
    matched_rule_id: "no_default_rule",
    reasons: [{ code: "no_default_rule" }],
    risk_score: RISK_SCORE[intent.risk_class],
  };
}
