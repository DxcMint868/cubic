"use client";

import Link from "next/link";
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
import { derivePayments, fmtDateTime, shortId, usd } from "@/components/console/derive";
import { getAuditEventsPaged, useApi } from "@/lib/api";

function StatusTag({ status }: { status: string }) {
  const filled = status === "completed";
  const failed = status === "failed";
  return (
    <span
      className="mono"
      style={{
        display: "inline-block",
        fontSize: 9.5,
        letterSpacing: "0.12em",
        padding: "3px 8px",
        border: `1px ${failed ? "dashed" : "solid"} #3a3a3a`,
        background: filled ? "#e8e8e8" : "transparent",
        color: filled ? "#000" : "#c9c9c9",
        whiteSpace: "nowrap",
      }}
    >
      {status.toUpperCase()}
    </span>
  );
}

export default function ConsolePayments() {
  const { data, error, loading, reload } = useApi("console-payments", () =>
    getAuditEventsPaged({ maxPages: 3 }),
  );
  const payments = useMemo(() => derivePayments(data ?? []), [data]);
  const settled = payments.filter((payment) => payment.status === "completed");
  const settledCents = settled.reduce((sum, payment) => sum + (payment.amountUsdCents ?? 0), 0);

  if (loading && !data) {
    return (
      <div>
        <PageHead eyebrow="CONSOLE — PAYMENTS" title="Machine spend." />
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
        <PageHead eyebrow="CONSOLE — PAYMENTS" title="Machine spend." />
        <div style={{ marginTop: 28 }}>
          <ErrorWindow code={error.code} message={error.message} title="PAYMENTS — ERROR" />
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
        eyebrow="CONSOLE — PAYMENTS"
        title="Machine spend."
        sub="x402 invoices treated as intents: allowlisted service, per-task budget, reputation bar. Settled over Hedera via Blocky402. Every row below is projected from real payment audit events."
      />

      <div
        className="mono"
        style={{
          marginTop: 26,
          paddingTop: 22,
          borderTop: "1px solid rgba(255,255,255,0.1)",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "20px 28px",
        }}
      >
        <div>
          <div style={{ fontSize: 19, color: "#e8e8e8" }}>{usd(settledCents)}</div>
          <div style={{ marginTop: 6, fontSize: 9.5, letterSpacing: "0.16em", color: "#5a5a5a" }}>
            SETTLED TOTAL
          </div>
        </div>
        <div>
          <div style={{ fontSize: 19, color: "#e8e8e8" }}>{settled.length}</div>
          <div style={{ marginTop: 6, fontSize: 9.5, letterSpacing: "0.16em", color: "#5a5a5a" }}>
            COMPLETED PAYMENTS
          </div>
        </div>
        <div>
          <div style={{ fontSize: 19, color: "#e8e8e8" }}>
            {payments.filter((payment) => payment.status === "requested").length}
          </div>
          <div style={{ marginTop: 6, fontSize: 9.5, letterSpacing: "0.16em", color: "#5a5a5a" }}>
            REQUESTED
          </div>
        </div>
        <div>
          <div style={{ fontSize: 19, color: "#e8e8e8" }}>
            {payments.filter((payment) => payment.status === "failed").length}
          </div>
          <div style={{ marginTop: 6, fontSize: 9.5, letterSpacing: "0.16em", color: "#5a5a5a" }}>
            FAILED
          </div>
        </div>
      </div>

      <div style={{ marginTop: 28 }}>
        <Panel title={`INVOICES — ${payments.length} FROM AUDIT EVENTS`}>
          {payments.length === 0 ? (
            <EmptyState />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="mono" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>PAYMENT</th>
                    <th style={th}>SERVICE</th>
                    <th style={th}>NETWORK</th>
                    <th style={th}>AMOUNT</th>
                    <th style={th}>TASK</th>
                    <th style={th}>SETTLEMENT REF</th>
                    <th style={th}>STATUS</th>
                    <th style={th}>TIME</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.paymentId}>
                      <td style={{ ...td, fontSize: 11 }}>
                        {shortId(payment.paymentId, 10)}
                      </td>
                      <td style={td}>{payment.service}</td>
                      <td style={{ ...td, fontSize: 11 }}>{payment.network.toUpperCase()}</td>
                      <td style={td}>{usd(payment.amountUsdCents)}</td>
                      <td style={{ ...td, fontSize: 11 }}>
                        {payment.taskId ? (
                          <Link href={`/console/tasks/${payment.taskId}`} className="link">
                            {shortId(payment.taskId, 10)}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={{ ...td, fontSize: 11, maxWidth: 220, wordBreak: "break-word" }}>
                        {payment.settlementRef ?? payment.errorCode ?? "—"}
                      </td>
                      <td style={td}>
                        <StatusTag status={payment.status} />
                      </td>
                      <td style={{ ...td, fontSize: 11 }}>
                        {fmtDateTime(payment.settledAt ?? payment.requestedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
