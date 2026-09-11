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
import { deriveTasks, fmtAge, shortId } from "@/components/console/derive";
import { getAuditEvents, useApi } from "@/lib/api";

export default function ConsoleTasks() {
  const { data, error, loading, reload } = useApi("console-tasks", () =>
    getAuditEvents({ limit: 200 }),
  );
  const tasks = useMemo(() => deriveTasks(data ?? []), [data]);

  if (loading && !data) {
    return (
      <div>
        <PageHead eyebrow="CONSOLE — TASKS" title="Tasks in flight." />
        <div style={{ marginTop: 28, display: "grid", gap: 12 }}>
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} height={54} />
          ))}
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div>
        <PageHead eyebrow="CONSOLE — TASKS" title="Tasks in flight." />
        <div style={{ marginTop: 28 }}>
          <ErrorWindow code={error.code} message={error.message} title="TASKS — ERROR" />
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
        eyebrow="CONSOLE — TASKS"
        title="Tasks in flight."
        sub="Each task groups the intents an agent emitted while doing one job — and what the gateway decided about each. Open a trace to see intent → decision → capability → payment → approval → execution."
      />
      <div style={{ marginTop: 28 }}>
        <Panel title={`${tasks.length} TASKS — FROM AUDIT EVENTS`}>
          {tasks.length === 0 ? (
            <EmptyState />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="mono" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>TASK</th>
                    <th style={th}>INTENT</th>
                    <th style={th}>AGENT</th>
                    <th style={th}>INTENTS</th>
                    <th style={th}>ALLOW / ESC / DENY</th>
                    <th style={th}>PAYMENTS</th>
                    <th style={th}>STATUS</th>
                    <th style={th}>UPDATED</th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => (
                    <tr key={task.id}>
                      <td style={{ ...td, fontSize: 11 }}>{shortId(task.id, 10)}</td>
                      <td style={{ ...td, minWidth: 220 }}>{task.descriptor}</td>
                      <td style={{ ...td, fontSize: 11 }}>
                        {task.agentIds.length > 0
                          ? task.agentIds.map((id) => shortId(id, 8)).join(", ")
                          : "—"}
                      </td>
                      <td style={td}>{task.intents}</td>
                      <td style={td}>
                        {task.allowed} / {task.escalated} / {task.denied}
                      </td>
                      <td style={td}>{task.payments}</td>
                      <td
                        style={{
                          ...td,
                          color: task.status === "AWAITING APPROVAL" ? "#f4f4f4" : "#c9c9c9",
                          fontSize: 11,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {task.status}
                      </td>
                      <td style={{ ...td, fontSize: 11 }}>{fmtAge(task.lastEventAt)} ago</td>
                      <td style={{ ...td, textAlign: "right" }}>
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
