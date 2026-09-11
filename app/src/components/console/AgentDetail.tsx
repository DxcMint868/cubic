"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  DecisionTag,
  EmptyState,
  ErrorWindow,
  Skeleton,
  Tag,
} from "@/components/ConsoleBits";
import { fmtAge, fmtDateTime, shortId } from "@/components/console/derive";
import { getAuditEvents, getTrace, useApi, type Trace } from "@/lib/api";

interface AgentData {
  traces: Trace[];
  totalTasks: number;
  intents: number;
  allowed: number;
  denied: number;
  escalated: number;
  approvals: number;
  lastEventAt: string | null;
  firstEventAt: string | null;
}

const TASK_FETCH_LIMIT = 12;

export default function AgentDetail({ agentId }: { agentId: string }) {
  const { data, error, loading, reload } = useApi(`agent:${agentId}`, async (): Promise<AgentData> => {
    const events = await getAuditEvents({ limit: 200 });
    const mine = events.filter((event) => event.agent_id === agentId);
    const taskIds: string[] = [];
    for (const event of mine) {
      if (event.task_id && !taskIds.includes(event.task_id)) taskIds.push(event.task_id);
    }
    const settled = await Promise.allSettled(
      taskIds.slice(0, TASK_FETCH_LIMIT).map((taskId) => getTrace(taskId)),
    );
    const traces = settled
      .filter((result): result is PromiseFulfilledResult<Trace> => result.status === "fulfilled")
      .map((result) => result.value);
    const decisions = mine.filter((event) => event.event_type === "policy.evaluated");
    const count = (decision: string) =>
      decisions.filter((event) => event.payload.decision === decision).length;
    return {
      traces,
      totalTasks: taskIds.length,
      intents: mine.filter((event) => event.event_type === "intent.created").length,
      allowed: count("allow"),
      denied: count("deny"),
      escalated: count("escalate"),
      approvals: mine.filter((event) => event.event_type === "ledger.approval.requested").length,
      lastEventAt: mine[0]?.created_at ?? null,
      firstEventAt: mine[mine.length - 1]?.created_at ?? null,
    };
  });

  const agentKey = useMemo(() => {
    if (!data) return null;
    for (const trace of data.traces) {
      for (const entry of trace.chain) {
        if (entry.capability?.subject) return entry.capability.subject;
      }
    }
    return null;
  }, [data]);

  if (loading && !data) {
    return (
      <div style={{ display: "grid", gap: 18 }}>
        <Skeleton height={16} width={220} />
        <Skeleton height={38} width={380} />
        <Skeleton height={120} />
        <Skeleton height={220} />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div>
        <ErrorWindow code={error.code} message={error.message} title="AGENT — ERROR" />
        <button
          onClick={reload}
          className="mono btn-outline"
          style={{ marginTop: 18, background: "transparent", cursor: "pointer" }}
        >
          RETRY
        </button>
      </div>
    );
  }

  if (!data) return null;

  if (data.traces.length === 0) {
    return (
      <div>
        <p className="mono" style={{ fontSize: 11, letterSpacing: "0.2em", color: "#5a5a5a" }}>
          CONSOLE — AGENT
        </p>
        <h1
          style={{
            marginTop: 14,
            fontSize: "clamp(26px, 3vw, 42px)",
            fontWeight: 700,
            color: "#f4f4f4",
          }}
        >
          {shortId(agentId, 12)}
        </h1>
        <div style={{ marginTop: 28 }}>
          <EmptyState>
            No live events yet — run the demo agent or the swarm.
          </EmptyState>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <p className="mono" style={{ fontSize: 11, letterSpacing: "0.2em", color: "#5a5a5a" }}>
            CONSOLE — AGENT
          </p>
          <h1
            style={{
              marginTop: 14,
              fontSize: "clamp(26px, 3vw, 42px)",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "#f4f4f4",
            }}
          >
            {agentKey ?? shortId(agentId, 12)}
          </h1>
          <p className="mono" style={{ marginTop: 12, fontSize: 11, color: "#8a8a8a" }}>
            AGENT ID {agentId}
          </p>
        </div>
        <Link
          href="/console/agents"
          className="mono link"
          style={{ fontSize: 10.5, letterSpacing: "0.14em", alignSelf: "flex-start" }}
        >
          ← ALL AGENTS
        </Link>
      </div>

      <div
        className="mono"
        style={{
          marginTop: 26,
          paddingTop: 22,
          borderTop: "1px solid rgba(255,255,255,0.1)",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
          gap: "20px 28px",
        }}
      >
        {[
          {
            value:
              data.totalTasks > data.traces.length
                ? `${data.traces.length} / ${data.totalTasks}`
                : String(data.traces.length),
            label: "TASKS",
          },
          { value: String(data.intents), label: "INTENTS" },
          { value: `${data.allowed} / ${data.escalated} / ${data.denied}`, label: "ALLOW / ESC / DENY" },
          { value: String(data.approvals), label: "APPROVALS" },
          { value: fmtAge(data.lastEventAt), label: "LAST SEEN" },
        ].map((stat) => (
          <div key={stat.label}>
            <div style={{ fontSize: 19, color: "#e8e8e8", letterSpacing: "0.02em" }}>
              {stat.value}
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 9.5,
                letterSpacing: "0.16em",
                color: "#5a5a5a",
              }}
            >
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 30, display: "grid", gap: 16 }}>
        {data.traces.map((trace) => {
          const entry = trace.chain[0];
          const decisions = trace.chain.filter((chainEntry) => chainEntry.decision !== null);
          return (
            <div
              key={trace.task.id}
              style={{
                border: "1px solid #1f1f1f",
                borderRadius: 10,
                padding: "20px 22px",
                display: "grid",
                gap: 14,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 16,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#f4f4f4" }}>
                    {trace.task.title}
                  </div>
                  <div className="mono" style={{ marginTop: 8, fontSize: 10, color: "#5a5a5a" }}>
                    TASK {shortId(trace.task.id, 10)} · {trace.task.status.toUpperCase()}
                    {entry?.intent.created_at
                      ? ` · FIRST INTENT ${fmtDateTime(entry.intent.created_at)}`
                      : ""}
                  </div>
                </div>
                <Link
                  href={`/console/tasks/${trace.task.id}`}
                  className="mono link"
                  style={{ fontSize: 10.5, letterSpacing: "0.12em" }}
                >
                  FULL TRACE →
                </Link>
              </div>

              <div className="mono" style={{ display: "grid", gap: 8 }}>
                {decisions.map((chainEntry) => (
                  <div
                    key={chainEntry.intent.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      fontSize: 11,
                    }}
                  >
                    <span style={{ color: "#c9c9c9", minWidth: 0 }}>
                      {chainEntry.intent.tool}
                      <span style={{ color: "#3f3f3f" }}>
                        {chainEntry.intent.resource ? ` · ${chainEntry.intent.resource}` : ""}
                      </span>
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Tag>{chainEntry.decision?.matched_rule_id ?? "—"}</Tag>
                      <DecisionTag d={(chainEntry.decision?.decision ?? "").toUpperCase()} />
                    </span>
                  </div>
                ))}
                {decisions.length === 0 && (
                  <span style={{ fontSize: 10, color: "#3f3f3f" }}>NO DECISIONS RECORDED</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
