"use client";

import { useMemo } from "react";
import {
  EmptyState,
  ErrorWindow,
  PageHead,
  Panel,
  Skeleton,
  td,
  th,
} from "@/components/ConsoleBits";
import { derivePolicies, fmtDateTime } from "@/components/console/derive";
import { getAuditEvents, useApi } from "@/lib/api";

function Counts({ allow, deny, escalate }: { allow: number; deny: number; escalate: number }) {
  return (
    <span>
      <span style={{ color: "#e8e8e8" }}>{allow}</span> ALLOW ·{" "}
      <span style={{ color: "#e8e8e8" }}>{escalate}</span> ESC ·{" "}
      <span style={{ color: deny > 0 ? "#f4f4f4" : "#8a8a8a" }}>{deny}</span> DENY
    </span>
  );
}

export default function ConsolePolicies() {
  const { data, error, loading, reload } = useApi("console-policies", () =>
    getAuditEvents({ limit: 200 }),
  );
  const policies = useMemo(() => derivePolicies(data ?? []), [data]);
  const policyNames = useMemo(
    () => [...new Set(policies.map((item) => item.policy))],
    [policies],
  );

  if (loading && !data) {
    return (
      <div>
        <PageHead eyebrow="CONSOLE — POLICIES" title="Deterministic rules." />
        <div style={{ marginTop: 28, display: "grid", gap: 12 }}>
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} height={54} />
          ))}
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div>
        <PageHead eyebrow="CONSOLE — POLICIES" title="Deterministic rules." />
        <div style={{ marginTop: 28 }}>
          <ErrorWindow code={error.code} message={error.message} title="POLICIES — ERROR" />
          <button
            onClick={reload}
            className="mono btn-outline"
            style={{ marginTop: 18, background: "transparent", cursor: "pointer" }}
          >
            RETRY
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHead
        eyebrow="CONSOLE — POLICIES"
        title="Deterministic rules."
        sub="The final ALLOW / DENY authority is the policy engine — LLMs may summarize intent, only these rules decide. Rule documents are server-owned; this view lists the policy versions and rules the audit log actually observed."
      />

      <div style={{ marginTop: 28, display: "grid", gap: 16 }}>
        <Panel title={`OBSERVED POLICIES — ${policyNames.length}`}>
          {policies.length === 0 ? (
            <EmptyState />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="mono" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>POLICY</th>
                    <th style={th}>RULE</th>
                    <th style={th}>EVALUATIONS</th>
                    <th style={th}>LAST EVALUATED</th>
                  </tr>
                </thead>
                <tbody>
                  {policies.map((policy) => (
                    <tr key={`${policy.policy}|${policy.ruleId}`}>
                      <td style={{ ...td, fontSize: 11.5, color: "#e8e8e8" }}>{policy.policy}</td>
                      <td style={{ ...td, fontSize: 11.5 }}>{policy.ruleId}</td>
                      <td style={td}>
                        <Counts allow={policy.allow} deny={policy.deny} escalate={policy.escalate} />
                      </td>
                      <td style={{ ...td, fontSize: 11 }}>
                        {fmtDateTime(policy.lastSeen)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="RULE SEMANTICS">
          <div
            className="mono"
            style={{ display: "grid", gap: 12, fontSize: 11, lineHeight: 1.9, color: "#8a8a8a" }}
          >
            <span>
              FIRST MATCH WINS — the engine evaluates the rule document in order and the first
              match decides. `matched_rule_id` in every decision is the rule that fired.
            </span>
            <span>
              ESCALATE requests an approval before a capability is issued; DENY records no
              capability at all. Both are visible per intent in the action trace.
            </span>
            <span>
              POLICY EDITS — rule documents live in the gateway database and are out of scope for
              this surface; every decision they produce is auditable here.
            </span>
          </div>
        </Panel>
      </div>
    </div>
  );
}
