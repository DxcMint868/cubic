"use client";

import { useMemo, useState } from "react";
import {
  EmptyState,
  ErrorWindow,
  PageHead,
  Panel,
  Skeleton,
  Tag,
  td,
  th,
} from "@/components/ConsoleBits";
import { derivePolicies, fmtDateTime, shortId } from "@/components/console/derive";
import {
  assignRuleCouncil,
  createCouncil,
  getAuditEvents,
  getCouncils,
  getPolicyDocs,
  useApi,
} from "@/lib/api";

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
  const { data: councils, reload: reloadCouncils } = useApi("console-councils", () => getCouncils());
  const { data: docs, reload: reloadDocs } = useApi("console-policy-docs", () => getPolicyDocs());
  const [assigning, setAssigning] = useState<string | null>(null);
  const [councilError, setCouncilError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newMembers, setNewMembers] = useState("");
  const [newThreshold, setNewThreshold] = useState("2");
  const [creating, setCreating] = useState(false);

  async function assign(policy: string, ruleId: string, council: string | null) {
    const key = `${policy}|${ruleId}`;
    setAssigning(key);
    setCouncilError(null);
    try {
      await assignRuleCouncil(policy, ruleId, council);
      reloadDocs();
    } catch (err) {
      setCouncilError(err instanceof Error ? err.message : String(err));
    } finally {
      setAssigning(null);
    }
  }

  async function create() {
    setCreating(true);
    setCouncilError(null);
    try {
      await createCouncil({
        name: newName.trim(),
        members: newMembers.split(/[\s,]+/).map((m) => m.trim()).filter(Boolean),
        threshold: Number(newThreshold),
      });
      setNewName("");
      setNewMembers("");
      setNewThreshold("2");
      reloadCouncils();
    } catch (err) {
      setCouncilError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  const councilOf = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const doc of docs ?? []) {
      for (const rule of doc.rules) map.set(`${doc.name}|${rule.id}`, rule.council);
    }
    return map;
  }, [docs]);

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
        sub="The final ALLOW / DENY authority is the policy engine — LLMs may summarize intent, only these rules decide. Escalating rules name the council that must sign (or nobody, for a single resolver)."
      />

      <div style={{ marginTop: 28, display: "grid", gap: 16 }}>
        <Panel title={`OBSERVED POLICIES — ${policyNames.length}`}>
          {policies.length === 0 ? (
            <EmptyState />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="mono" style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                <thead>
                  <tr>
                    <th style={th}>POLICY</th>
                    <th style={th}>RULE</th>
                    <th style={th}>EVALUATIONS</th>
                    <th style={th}>COUNCIL</th>
                    <th style={th}>LAST EVALUATED</th>
                  </tr>
                </thead>
                <tbody>
                  {policies.map((policy) => {
                    const key = `${policy.policy}|${policy.ruleId}`;
                    const council = councilOf.get(key) ?? null;
                    return (
                      <tr key={key}>
                        <td style={{ ...td, fontSize: 11.5, color: "#e8e8e8" }}>{policy.policy}</td>
                        <td style={{ ...td, fontSize: 11.5 }}>{policy.ruleId}</td>
                        <td style={td}>
                          <Counts allow={policy.allow} deny={policy.deny} escalate={policy.escalate} />
                        </td>
                        <td style={td}>
                          <select
                            value={council ?? ""}
                            disabled={assigning === key}
                            onChange={(e) => assign(policy.policy, policy.ruleId, e.target.value === "" ? null : e.target.value)}
                            className="mono"
                            aria-label={`Council for rule ${policy.ruleId}`}
                            style={{
                              background: "#000",
                              border: "1px solid #2e2e2e",
                              borderRadius: 6,
                              padding: "6px 8px",
                              color: "#e8e8e8",
                              fontSize: 10.5,
                              outline: "none",
                            }}
                          >
                            <option value="">SINGLE RESOLVER</option>
                            {(councils ?? []).map((c) => (
                              <option key={c.id} value={c.name}>
                                {c.name.toUpperCase()} ({c.threshold}-OF-{c.members.length})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{ ...td, fontSize: 11 }}>
                          {fmtDateTime(policy.lastSeen)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {councilError && (
            <p className="mono" style={{ marginTop: 12, fontSize: 11, color: "#e8e8e8" }}>
              {`COUNCIL UPDATE FAILED — ${councilError}`}
            </p>
          )}
        </Panel>

        <Panel title={`COUNCILS — ${(councils ?? []).length} (OFF-CHAIN MULTISIG)`}>
          <div style={{ display: "grid", gap: 12 }}>
            {(councils ?? []).map((c) => (
              <div key={c.id} className="mono" style={{ fontSize: 11, color: "#c9c9c9", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ color: "#f4f4f4", fontWeight: 700 }}>{c.name}</span>
                <Tag>{c.threshold}-OF-{c.members.length}</Tag>
                <span style={{ color: "#5a5a5a" }}>{c.members.map((m) => shortId(m, 10)).join(" · ")}</span>
                {c.safe_address ? (
                  <span style={{ color: "#5a5a5a" }}>SAFE {shortId(c.safe_address, 10)}</span>
                ) : (
                  <span style={{ color: "#3a3a3a" }}>NO SAFE LINKED (OFF-CHAIN ONLY)</span>
                )}
              </div>
            ))}
            {(councils ?? []).length === 0 && (
              <p className="mono" style={{ fontSize: 11, color: "#5a5a5a" }}>No councils yet.</p>
            )}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="council-name"
                className="mono"
                aria-label="New council name"
                style={{ background: "#0b0b0b", border: "1px solid #2e2e2e", borderRadius: 6, padding: "9px 12px", color: "#e8e8e8", fontSize: 11, outline: "none" }}
              />
              <input
                value={newMembers}
                onChange={(e) => setNewMembers(e.target.value)}
                placeholder="0xmember1, 0xmember2"
                className="mono"
                aria-label="New council member addresses"
                style={{ background: "#0b0b0b", border: "1px solid #2e2e2e", borderRadius: 6, padding: "9px 12px", color: "#e8e8e8", fontSize: 11, outline: "none", minWidth: 280 }}
              />
              <input
                value={newThreshold}
                onChange={(e) => setNewThreshold(e.target.value)}
                placeholder="2"
                className="mono"
                aria-label="New council threshold"
                style={{ background: "#0b0b0b", border: "1px solid #2e2e2e", borderRadius: 6, padding: "9px 12px", color: "#e8e8e8", fontSize: 11, outline: "none", width: 70 }}
              />
              <button onClick={create} disabled={creating} className="mono btn-outline" style={{ background: "transparent", cursor: "pointer" }}>
                {creating ? "CREATING…" : "CREATE COUNCIL"}
              </button>
            </div>
          </div>
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
              COUNCIL ROUTING — an escalating rule names the council that must
              sign (threshold M-of-N, collected across resolve calls; any member
              reject vetoes at once). Unsigned dev resolves bypass councils as
              the labeled stand-in. Gnosis Safe is a display hook only — no
              contract is linked until one is.
            </span>
            <span>
              POLICY EDITS — rule logic itself lives in the gateway database
              and is out of scope here; council assignment is the editable
              exception, and every decision stays auditable above.
            </span>
          </div>
        </Panel>
      </div>
    </div>
  );
}
