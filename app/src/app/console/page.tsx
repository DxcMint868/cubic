"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  DecisionTag,
  EmptyState,
  ErrorWindow,
  PageHead,
  Panel,
  ProviderBadge,
  Skeleton,
  StatRow,
} from "@/components/ConsoleBits";
import {
  deriveApprovals,
  deriveCounters,
  deriveTasks,
  fmtAge,
  shortId,
} from "@/components/console/derive";
import { getAuditEvents, useApi } from "@/lib/api";

export default function ConsoleOverview() {
  const { data, error, loading, reload } = useApi("console-overview", () =>
    getAuditEvents({ limit: 100 }),
  );

  const events = useMemo(() => data ?? [], [data]);
  const counters = useMemo(() => deriveCounters(events), [events]);
  const tasks = useMemo(() => deriveTasks(events), [events]);
  const approvals = useMemo(() => deriveApprovals(events), [events]);
  const decisions = useMemo(
    () =>
      events
        .filter((event) => event.event_type === "policy.evaluated")
        .slice(0, 6),
    [events],
  );

  if (loading && !data) {
    return (
      <div>
        <PageHead eyebrow="CONSOLE — OVERVIEW" title="Overview." />
        <div style={{ marginTop: 28, display: "grid", gap: 16 }}>
          <Skeleton height={40} />
          <Skeleton height={140} />
          <Skeleton height={180} />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div>
        <PageHead eyebrow="CONSOLE — OVERVIEW" title="Overview." />
        <div style={{ marginTop: 28 }}>
          <ErrorWindow code={error.code} message={error.message} title="CONSOLE — ERROR" />
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
        eyebrow="CONSOLE — OVERVIEW"
        title="Overview."
        sub="Live from the tenant audit log: intents, deterministic decisions, capabilities, payments, approvals, and executions. Tenant-private — the network page only ever sees anonymized projections."
      />

      <StatRow
        stats={[
          { value: String(counters.agents), label: "AGENTS OBSERVED" },
          { value: String(counters.intents), label: "INTENTS" },
          { value: String(counters.allowed), label: "ALLOWED" },
          { value: String(counters.denied), label: "DENIED" },
          { value: String(counters.escalated), label: "ESCALATED" },
          { value: String(counters.pendingApprovals), label: "PENDING APPROVALS" },
          { value: `$${(counters.settledCents / 100).toFixed(2)}`, label: "SETTLED SPEND" },
        ]}
      />

      <div className="console-cards">
        <Panel title={`PENDING APPROVALS — ${counters.pendingApprovals}`}>
          {approvals.pending.length === 0 ? (
            <EmptyState />
          ) : (
            <div style={{ display: "grid", gap: 16 }}>
              {approvals.pending.slice(0, 3).map((approval) => (
                <div
                  key={approval.approvalId}
                  style={{ display: "grid", gap: 8, fontSize: 13, color: "#c9c9c9" }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <span>
                      <span className="mono" style={{ color: "#5a5a5a", fontSize: 10.5 }}>
                        {shortId(approval.approvalId, 10)} ·{" "}
                      </span>
                      {approval.action} — {approval.resource}
                    </span>
                    <ProviderBadge provider={approval.provider} />
                  </div>
                  <div
                    className="mono"
                    style={{ fontSize: 10, letterSpacing: "0.08em", color: "#5a5a5a" }}
                  >
                    {approval.reasons.join(" · ") || "—"} ·{" "}
                    {fmtAge(approval.requestedAt).toUpperCase()} AGO
                  </div>
                </div>
              ))}
              <Link
                href="/console/approvals"
                className="mono link"
                style={{ fontSize: 10.5, letterSpacing: "0.14em" }}
              >
                OPEN APPROVAL QUEUE →
              </Link>
            </div>
          )}
        </Panel>

        <Panel title="RECENT DECISIONS">
          {decisions.length === 0 ? (
            <EmptyState />
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              {decisions.map((event) => {
                const decision = String(event.payload.decision ?? "").toUpperCase();
                const reasonCodes = Array.isArray(event.payload.reason_codes)
                  ? (event.payload.reason_codes as string[]).join(", ")
                  : "";
                return (
                  <div
                    key={event.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div className="mono" style={{ fontSize: 11, color: "#c9c9c9" }}>
                        {String(event.payload.matched_rule_id ?? "—")}
                      </div>
                      <div
                        className="mono"
                        style={{ marginTop: 5, fontSize: 9.5, color: "#5a5a5a" }}
                      >
                        {reasonCodes || "—"}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <DecisionTag d={decision} />
                      {event.task_id && (
                        <Link
                          href={`/console/tasks/${event.task_id}`}
                          className="mono link"
                          style={{ fontSize: 10, letterSpacing: "0.12em" }}
                        >
                          TRACE →
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>

      <div style={{ marginTop: 24 }}>
        <Panel title={`TRACE LINKS — ${tasks.length} TASKS`}>
          {tasks.length === 0 ? (
            <EmptyState />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table
                className="mono"
                style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
              >
                <tbody>
                  {tasks.slice(0, 8).map((task) => (
                    <tr key={task.id}>
                      <td style={{ padding: "12px 12px 12px 0", color: "#8a8a8a", fontSize: 10.5 }}>
                        {shortId(task.id, 10)}
                      </td>
                      <td style={{ padding: "12px 12px 12px 0", color: "#c9c9c9" }}>
                        {task.descriptor}
                      </td>
                      <td
                        style={{
                          padding: "12px 12px 12px 0",
                          color: task.denied > 0 ? "#f4f4f4" : "#8a8a8a",
                          fontSize: 10.5,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {task.allowed} ALLOW · {task.escalated} ESC · {task.denied} DENY
                      </td>
                      <td
                        style={{
                          padding: "12px 12px 12px 0",
                          color: "#8a8a8a",
                          fontSize: 10.5,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {task.status}
                      </td>
                      <td style={{ padding: "12px 0", textAlign: "right" }}>
                        <Link
                          href={`/console/tasks/${task.id}`}
                          className="link"
                          style={{ fontSize: 10.5, letterSpacing: "0.12em" }}
                        >
                          TRACE →
                        </Link>
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
