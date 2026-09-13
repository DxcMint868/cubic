"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
import { approvalSignMessage, getAuditEventsPaged, resolveApproval, useApi, type ResolveApprovalResult } from "@/lib/api";

// Approver-tab wallet signing (EIP-191 personal_sign over the canonical
// message). No wallet library: raw window.ethereum JSON-RPC. Absent provider
// → unsigned dev resolve, labeled as the stand-in.
async function walletSign(approvalId: string, outcome: "approved" | "rejected"): Promise<{ signature: string; signer: string } | null> {
  const eth = (window as unknown as { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
  if (!eth) return null;
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  const signer = accounts[0];
  if (!signer) throw new Error("wallet returned no accounts");
  const signature = (await eth.request({
    method: "personal_sign",
    params: [approvalSignMessage(approvalId, outcome), signer],
  })) as string;
  return { signature, signer };
}

export default function ConsoleApprovals() {
  const { data, error, loading, reload } = useApi("console-approvals", () =>
    getAuditEventsPaged({ maxPages: 3 }),
  );
  const { pending, resolved } = useMemo(() => deriveApprovals(data ?? []), [data]);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ResolveApprovalResult>>({});
  const [signedBy, setSignedBy] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  // Live queue: re-fetch every 2s so requests pushed from the executor tab
  // appear without a manual refresh. Pauses while a resolve is in flight.
  useEffect(() => {
    if (busy) return;
    const timer = setInterval(() => reload(), 2000);
    return () => clearInterval(timer);
  }, [busy, reload]);

  const resolve = async (id: string, outcome: "approved" | "rejected") => {
    setBusy(id);
    setActionError(null);
    try {
      const wallet = await walletSign(id, outcome);
      const result = await resolveApproval(id, outcome, wallet ?? undefined);
      setResults((prev) => ({ ...prev, [id]: result }));
      if (wallet) setSignedBy((prev) => ({ ...prev, [id]: wallet.signer }));
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
        sub="Everything the policy escalated. Live — new requests land here within seconds. Sign with your wallet and the signature is sealed into the approval event's fingerprint; without a wallet the dev stand-in resolves unsigned."
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
                    {approval.council ? (
                      <Tag>
                        COUNCIL {approval.council.toUpperCase()}
                        {result?.status === "collecting" && result.threshold != null
                          ? ` · ${result.collected ?? 0}/${result.threshold} SIGNED`
                          : ""}
                      </Tag>
                    ) : (
                      <Tag>SINGLE RESOLVER</Tag>
                    )}
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
                    result.status === "collecting" ? (
                      <div
                        className="mono"
                        style={{
                          borderTop: "1px solid rgba(255,255,255,0.1)",
                          paddingTop: 14,
                          fontSize: 11,
                          color: "#e8e8e8",
                        }}
                      >
                        COLLECTING — {result.collected ?? 0}/{result.threshold ?? "?"} SIGNED
                        {signedBy[approval.approvalId] ? ` · LAST ${shortId(signedBy[approval.approvalId], 10)}` : ""}
                        {" · STILL PENDING — ANOTHER MEMBER MUST SIGN"}
                      </div>
                    ) : (
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
                        {signedBy[approval.approvalId] || result.signer
                          ? ` · SIGNED ${shortId(signedBy[approval.approvalId] ?? result.signer ?? "", 10)}`
                          : " · UNSIGNED (DEV STAND-IN)"}
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
                    )
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
                        title="Sign with wallet, or unsigned dev resolve when no wallet is present"
                      >
                        {busy === approval.approvalId ? "RESOLVING…" : "SIGN & APPROVE"}
                      </button>
                      <button
                        onClick={() => resolve(approval.approvalId, "rejected")}
                        disabled={busy === approval.approvalId}
                        className="mono btn-outline"
                        style={{
                          cursor: busy === approval.approvalId ? "default" : "pointer",
                          background: "transparent",
                        }}
                        title="Sign with wallet, or unsigned dev resolve when no wallet is present"
                      >
                        SIGN & DENY
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
                    display: "grid",
                    gap: 8,
                    fontSize: 11,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      flexWrap: "wrap",
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
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 10, color: "#8a8a8a" }}>
                    <span>
                      BY {approval.signer ? `${shortId(approval.signer, 12)} (SIGNED)` : `${approval.resolvedBy ?? "unknown"} (UNSIGNED)`}
                    </span>
                    {approval.council && <span>COUNCIL {approval.council.toUpperCase()}</span>}
                    {approval.taskId && (
                      <>
                        <Link
                          href={`/console/tasks/${approval.taskId}`}
                          className="link"
                          style={{ fontSize: 10, letterSpacing: "0.12em" }}
                        >
                          TASK + TRACE →
                        </Link>
                        <Link
                          href={`/api/anchors/verify?task_id=${approval.taskId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="link"
                          style={{ fontSize: 10, letterSpacing: "0.12em" }}
                        >
                          VERIFY ON HCS →
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
