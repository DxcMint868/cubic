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
import { deriveTasks, fmtAge, shortId } from "@/components/console/derive";
import { getAuditEvents, useApi } from "@/lib/api";

const OUTCOMES = ["RUNNING", "AWAITING APPROVAL", "DONE", "FAILED"] as const;

const selectStyle: React.CSSProperties = {
  background: "#000",
  border: "1px solid #2e2e2e",
  borderRadius: 8,
  padding: "9px 12px",
  color: "#e8e8e8",
  fontSize: 10.5,
  letterSpacing: "0.1em",
  fontFamily: "inherit",
  outline: "none",
};

export default function ConsoleTasks() {
  const { data, error, loading, reload } = useApi("console-tasks", () =>
    getAuditEvents({ limit: 200 }),
  );
  const tasks = useMemo(() => deriveTasks(data ?? []), [data]);
  const [outcome, setOutcome] = useState("ALL");
  const [agent, setAgent] = useState("ALL");

  const agentOptions = useMemo(() => {
    const ids = new Map<string, string>();
    for (const task of tasks) {
      for (const id of task.agentIds) {
        if (!ids.has(id)) ids.set(id, shortId(id, 8));
      }
    }
    return [...ids.entries()];
  }, [tasks]);

  const visible = useMemo(() => {
    return tasks.filter(
      (task) =>
        (outcome === "ALL" || task.status === outcome) &&
        (agent === "ALL" || task.agentIds.includes(agent)),
    );
  }, [tasks, outcome, agent]);

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
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
            marginBottom: 20,
          }}
        >
          <p className="mono" style={{ fontSize: 10.5, letterSpacing: "0.14em", color: "#5a5a5a" }}>
            {visible.length} OF {tasks.length} TASKS
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <select
              value={outcome}
              onChange={(event) => setOutcome(event.target.value)}
              className="mono"
              aria-label="Filter tasks by outcome"
              style={selectStyle}
            >
              <option value="ALL">ALL OUTCOMES</option>
              {OUTCOMES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <select
              value={agent}
              onChange={(event) => setAgent(event.target.value)}
              className="mono"
              aria-label="Filter tasks by agent"
              style={selectStyle}
            >
              <option value="ALL">ALL AGENTS</option>
              {agentOptions.map(([id, short]) => (
                <option key={id} value={id}>
                  {short}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Panel title={`${visible.length} TASKS — FROM AUDIT EVENTS`}>
          {visible.length === 0 ? (
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
                  {visible.map((task) => (
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
