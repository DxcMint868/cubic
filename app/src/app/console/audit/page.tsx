"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  EmptyState,
  ErrorWindow,
  PageHead,
  Panel,
  Skeleton,
  td,
  th,
} from "@/components/ConsoleBits";
import { eventSummary, fmtDateTime, shortId } from "@/components/console/derive";
import { getAuditEvents, useApi } from "@/lib/api";

const EVENT_TYPES = [
  "intent.created",
  "policy.evaluated",
  "capability.issued",
  "capability.denied",
  "capability.escalated",
  "capability.consumed",
  "capability.rejected",
  "capability.revoked",
  "ledger.approval.requested",
  "ledger.approval.completed",
  "payment.requested",
  "payment.completed",
  "payment.failed",
  "service.discovered",
  "tool.execution.started",
  "tool.execution.completed",
  "tool.execution.failed",
  "task.completed",
];

export default function ConsoleAudit() {
  const { data, error, loading, reload } = useApi("console-audit", () =>
    getAuditEvents({ limit: 200 }),
  );
  const [filter, setFilter] = useState("ALL");

  const events = useMemo(() => {
    const all = data ?? [];
    return filter === "ALL" ? all : all.filter((event) => event.event_type === filter);
  }, [data, filter]);

  if (loading && !data) {
    return (
      <div>
        <PageHead eyebrow="CONSOLE — AUDIT" title="Intent to result." />
        <div style={{ marginTop: 28, display: "grid", gap: 10 }}>
          {[0, 1, 2, 3, 4].map((row) => (
            <Skeleton key={row} height={40} />
          ))}
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div>
        <PageHead eyebrow="CONSOLE — AUDIT" title="Intent to result." />
        <div style={{ marginTop: 28 }}>
          <ErrorWindow code={error.code} message={error.message} title="AUDIT — ERROR" />
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
        eyebrow="CONSOLE — AUDIT"
        title="Intent to result."
        sub="The durable chain: intent → decision → capability → payment/approval → execution → result. Tenant-private — the network page only ever sees anonymized projections."
      />

      <div
        style={{
          marginTop: 24,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <p className="mono" style={{ fontSize: 10.5, letterSpacing: "0.14em", color: "#5a5a5a" }}>
          {events.length} OF {data?.length ?? 0} EVENTS — NEWEST FIRST
        </p>
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="mono"
          aria-label="Filter audit events by type"
          style={{
            background: "#000",
            border: "1px solid #2e2e2e",
            borderRadius: 8,
            padding: "9px 12px",
            color: "#e8e8e8",
            fontSize: 10.5,
            letterSpacing: "0.1em",
            fontFamily: "inherit",
            outline: "none",
          }}
        >
          <option value="ALL">ALL EVENT TYPES</option>
          {EVENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginTop: 20 }}>
        <Panel title={`AUDIT LOG${filter === "ALL" ? "" : ` — ${filter}`}`}>
          {events.length === 0 ? (
            <EmptyState />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="mono" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>TIME</th>
                    <th style={th}>EVENT</th>
                    <th style={th}>TASK</th>
                    <th style={th}>AGENT</th>
                    <th style={th}>DETAIL</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td style={{ ...td, fontSize: 11, whiteSpace: "nowrap" }}>
                        {fmtDateTime(event.created_at)}
                      </td>
                      <td style={{ ...td, fontSize: 11, color: "#e8e8e8" }}>
                        {event.event_type}
                      </td>
                      <td style={{ ...td, fontSize: 11 }}>
                        {event.task_id ? (
                          <Link href={`/console/tasks/${event.task_id}`} className="link">
                            {shortId(event.task_id, 10)}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={{ ...td, fontSize: 11 }}>
                        {shortId(event.agent_id, 10)}
                      </td>
                      <td style={{ ...td, fontSize: 11, minWidth: 260 }}>
                        {eventSummary(event)}
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
