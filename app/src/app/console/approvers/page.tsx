"use client";

import Link from "next/link";
import { useMemo } from "react";
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
import { deriveApprovers, fmtAge, shortId } from "@/components/console/derive";
import { getAuditEvents, useApi } from "@/lib/api";

export default function ConsoleApprovers() {
  const { data, error, loading, reload } = useApi("console-approvers", () =>
    getAuditEvents({ limit: 200 }),
  );
  const approvers = useMemo(() => deriveApprovers(data ?? []), [data]);

  return (
    <div>
      <PageHead
        eyebrow="CONSOLE — APPROVERS"
        title="Humans who decide."
        sub="No registry — approvers are whoever resolved approvals. A wallet signature is the authentication: signed resolutions verified on resolve and sealed into the event fingerprint; unsigned ones are the labeled dev stand-in."
      />

      {loading && !data ? (
        <div style={{ marginTop: 28 }}>
          <Skeleton height={220} />
        </div>
      ) : error && !data ? (
        <div style={{ marginTop: 28 }}>
          <ErrorWindow code={error.code} message={error.message} title="APPROVERS — ERROR" />
          <button
            onClick={reload}
            className="mono btn-outline"
            style={{ marginTop: 18, background: "transparent", cursor: "pointer" }}
          >
            RETRY
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 28 }}>
          <Panel title={`${approvers.length} APPROVERS — FROM APPROVAL EVENTS`}>
            {approvers.length === 0 ? (
              <EmptyState>No resolved approvals yet — escalate something and sign it.</EmptyState>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th style={th}>APPROVER</th>
                      <th style={th}>RESOLVED</th>
                      <th style={th}>APPROVED / DENIED</th>
                      <th style={th}>SIGNED</th>
                      <th style={th}>LAST SEEN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {approvers.map((approver) => (
                      <tr key={approver.id}>
                        <td style={{ ...td, fontSize: 11 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#f4f4f4" }}>
                            {approver.address ? shortId(approver.address, 12) : approver.id}
                          </div>
                          <div className="mono" style={{ marginTop: 4, fontSize: 10, color: "#5a5a5a" }}>
                            {approver.address ? (
                              <Tag>SIGNED WALLET</Tag>
                            ) : (
                              <Tag>ATTRIBUTION STRING</Tag>
                            )}
                          </div>
                        </td>
                        <td style={td}>{approver.resolved}</td>
                        <td style={td}>
                          {approver.approved} / {approver.rejected}
                        </td>
                        <td style={td}>
                          {approver.signed} / {approver.resolved}
                        </td>
                        <td style={{ ...td, fontSize: 11 }}>
                          {approver.lastAt ? `${fmtAge(approver.lastAt)} ago` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mono" style={{ marginTop: 16, fontSize: 10.5, color: "#5a5a5a" }}>
              <Link href="/console/approvals" className="link">
                RESOLVE IN THE APPROVAL QUEUE →
              </Link>
            </p>
          </Panel>
        </div>
      )}
    </div>
  );
}
