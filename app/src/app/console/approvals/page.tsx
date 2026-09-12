"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  EmptyState,
  ErrorWindow,
  PageHead,
  Panel,
  ProviderBadge,
  Skeleton,
  Tag,
} from "@/components/ConsoleBits";
import { deriveApprovals, fmtAge, fmtDateTime, shortId } from "@/components/console/derive";
import { getAuditEventsPaged, resolveApproval, useApi, type ResolveApprovalResult } from "@/lib/api";

export default function ConsoleApprovals() {
  const { data, error, loading, reload } = useApi("console-approvals", () =>
    getAuditEventsPaged({ maxPages: 3 }),
  );
  const { pending, resolved } = useMemo(() => deriveApprovals(data ?? []), [data]);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ResolveApprovalResult>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  const resolve = async (id: string, outcome: "approved" | "rejected") => {
    setBusy(id);
    setActionError(null);
    try {
      const result = await resolveApproval(id, outcome);
      setResults((prev) => ({ ...prev, [id]: result }));
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  if (loading && !data) {
    return (
      <div>
        <PageHead eyebrow="CONSOLE — APPROVALS" title="High-risk queue." />
        <div style={{ marginTop: 28, display: "grid", gap: 16 }}>
          <Skeleton height={150} />
          <Skeleton height={150} />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div>
        <PageHead eyebrow="CONSOLE — APPROVALS" title="High-risk queue." />
        <div style={{ marginTop: 28 }}>
          <ErrorWindow code={error.code} message={error.message} title="APPROVALS — ERROR" />
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
        eyebrow="CONSOLE — APPROVALS"
        title="High-risk queue."
        sub="Everything the policy escalated. The provider badge is what actually handled it: dev is the in-app queue; ledger is the hardware-backed path. Approving continues the execution phase and issues the capability."
      />

      {actionError && (
        <div
          className="mono"
          style={{
            marginTop: 20,
            border: "1px dashed #8a8a8a",
            padding: "12px 14px",
            fontSize: 11,
            color: "#e8e8e8",
          }}
        >
          RESOLVE FAILED — {actionError}
        </div>
      )}

      <div style={{ marginTop: 28, display: "grid", gap: 16 }}>
        {pending.length === 0 ? (
          <Panel title="QUEUE — 0 PENDING">
            <EmptyState />
          </Panel>
        ) : (
          pending.map((approval) => {
            const result = results[approval.approvalId];
            return (
              <Panel
                key={approval.approvalId}
                title={`${shortId(approval.approvalId, 12).toUpperCase()} — ${
                  approval.riskScore != null ? `RISK ${approval.riskScore}` : "ESCALATED"
                }`}
              >
                <div style={{ display: "grid", gap: 12 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 16,
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "#f4f4f4" }}>
                        {approval.action}
                      </div>
                      <div className="mono" style={{ marginTop: 8, fontSize: 11, color: "#8a8a8a" }}>
                        {approval.resource}
                        {approval.agentId ? ` · AGENT ${shortId(approval.agentId, 10)}` : ""} ·{" "}
                        {fmtAge(approval.requestedAt).toUpperCase()} AGO
                      </div>
                    </div>
                    <ProviderBadge provider={approval.provider} />
                  </div>

                  <div
                    className="mono"
                    style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 10 }}
                  >
                    <Tag>RULE {approval.matchedRuleId ?? "—"}</Tag>
                    <Tag>POLICY {approval.matchedPolicy ?? "—"}</Tag>
                    {approval.reasons.map((reason) => (
                      <Tag key={reason}>{reason}</Tag>
                    ))}
                    {approval.taskId && (
                      <Link
                        href={`/console/tasks/${approval.taskId}`}
                        className="link"
                        style={{ fontSize: 10, letterSpacing: "0.12em", alignSelf: "center" }}
                      >
                        TRACE →
                      </Link>
                    )}
                  </div>

                  {result ? (
                    <div
                      className="mono"
                      style={{
                        borderTop: "1px solid rgba(255,255,255,0.1)",
                        paddingTop: 14,
                        display: "grid",
                        gap: 8,
                        fontSize: 11,
                        color: "#c9c9c9",
                      }}
                    >
                      <span>
                        RESOLVED — {String(result.approval_outcome ?? "").toUpperCase()}
                      </span>
                      {result.capability ? (
                        <span style={{ color: "#8a8a8a" }}>
                          CAPABILITY {shortId(result.capability.capability_id, 10)} ·{" "}
                          {result.capability.action} · {result.capability.resource}
                        </span>
                      ) : (
                        <span style={{ color: "#8a8a8a" }}>NO CAPABILITY ISSUED</span>
                      )}
                      {result.execution && (
                        <span style={{ color: "#8a8a8a" }}>
                          EXECUTION {result.execution.status.toUpperCase()}
                          {result.execution.result_summary
                            ? ` · ${result.execution.result_summary}`
                            : ""}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                      <button
                        onClick={() => resolve(approval.approvalId, "approved")}
                        disabled={busy === approval.approvalId}
                        className="mono"
                        style={{
                          cursor: busy === approval.approvalId ? "default" : "pointer",
                          fontSize: 10,
                          letterSpacing: "0.14em",
                          padding: "9px 18px",
                          background: "#e8e8e8",
                          border: "1px solid #e8e8e8",
                          color: "#000",
                        }}
                      >
                        {busy === approval.approvalId ? "RESOLVING…" : "APPROVE"}
                      </button>
                      <button
                        onClick={() => resolve(approval.approvalId, "rejected")}
                        disabled={busy === approval.approvalId}
                        className="mono btn-outline"
                        style={{
                          cursor: busy === approval.approvalId ? "default" : "pointer",
                          background: "transparent",
                        }}
                      >
                        DENY
                      </button>
                    </div>
                  )}
                </div>
              </Panel>
            );
          })
        )}
      </div>

      {resolved.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <Panel title={`RESOLVED — ${resolved.length}`}>
            <div style={{ display: "grid", gap: 14 }}>
              {resolved.map((approval) => (
                <div
                  key={approval.approvalId}
                  className="mono"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    fontSize: 11,
                  }}
                >
                  <span style={{ color: "#c9c9c9" }}>
                    {approval.action} — {approval.resource}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ color: "#5a5a5a" }}>{fmtDateTime(approval.completedAt)}</span>
                    <ProviderBadge provider={approval.provider} />
                    <Tag>{approval.status.toUpperCase()}</Tag>
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
