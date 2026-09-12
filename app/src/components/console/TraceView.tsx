"use client";

import Link from "next/link";
import { useState } from "react";
import MacWindow from "@/components/MacWindow";
import { DecisionTag, EmptyState, ErrorWindow, ProviderBadge, Skeleton, Tag } from "@/components/ConsoleBits";
import {
  fmtDateTime,
  shortId,
  usd,
} from "@/components/console/derive";
import { getTrace, useApi, type Trace, type TraceChainEntry } from "@/lib/api";

function KV({ k, v, mono = true }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "150px 1fr",
        gap: 14,
        alignItems: "baseline",
      }}
    >
      <span
        className="mono"
        style={{ fontSize: 9.5, letterSpacing: "0.14em", color: "#5a5a5a" }}
      >
        {k}
      </span>
      <span
        className={mono ? "mono" : undefined}
        style={{ fontSize: 12, color: "#c9c9c9", lineHeight: 1.6, wordBreak: "break-word" }}
      >
        {v}
      </span>
    </div>
  );
}

function Stage({
  label,
  children,
  muted,
}: {
  label: string;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div
      style={{
        borderLeft: `2px solid ${muted ? "#1f1f1f" : "#3a3a3a"}`,
        padding: "2px 0 2px 18px",
        display: "grid",
        gap: 10,
      }}
    >
      <span
        className="mono"
        style={{ fontSize: 9.5, letterSpacing: "0.2em", color: muted ? "#3f3f3f" : "#8a8a8a" }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function reasonText(entry: TraceChainEntry): string {
  const reasons = entry.decision?.reasons ?? [];
  return reasons
    .map((reason) => (reason.detail ? `${reason.code} — ${reason.detail}` : reason.code))
    .join(" · ");
}

function ChainEntry({ entry, index }: { entry: TraceChainEntry; index: number }) {
  const { intent, decision, capability, payments, executions, approvals } = entry;
  const denied = decision?.decision === "deny";
  const escalated = decision?.decision === "escalate";

  return (
    <div
      style={{
        border: "1px solid #1f1f1f",
        borderLeft: `3px solid ${denied ? "#e8e8e8" : escalated ? "#6a6a6a" : "#2e2e2e"}`,
        borderRadius: 10,
        padding: "22px 22px 24px",
        display: "grid",
        gap: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <span className="mono" style={{ fontSize: 10, color: "#5a5a5a" }}>
            #{String(index + 1).padStart(2, "0")}
          </span>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#f4f4f4" }}>
            {intent.tool}
          </span>
          <span className="mono" style={{ fontSize: 11, color: "#8a8a8a" }}>
            {intent.resource ?? "—"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Tag>{intent.risk_class.toUpperCase()} RISK</Tag>
          {decision && <DecisionTag d={decision.decision.toUpperCase()} />}
        </div>
      </div>

      {denied && (
        <div
          className="mono"
          style={{
            border: "1px dashed #c9c9c9",
            padding: "12px 14px",
            fontSize: 11,
            letterSpacing: "0.08em",
            color: "#f4f4f4",
            lineHeight: 1.8,
          }}
        >
          DENIED — {reasonText(entry) || "no reason recorded"}
          {decision?.matched_rule_id ? ` · RULE ${decision.matched_rule_id}` : ""}
        </div>
      )}
      {escalated && (
        <div
          className="mono"
          style={{
            border: "1px solid #8a8a8a",
            padding: "12px 14px",
            fontSize: 11,
            letterSpacing: "0.08em",
            color: "#e8e8e8",
            lineHeight: 1.8,
          }}
        >
          ESCALATED — APPROVAL REQUIRED
          {reasonText(entry) ? ` · ${reasonText(entry)}` : ""}
          {decision?.matched_rule_id ? ` · RULE ${decision.matched_rule_id}` : ""}
        </div>
      )}

      <Stage label="INTENT">
        <KV k="TOOL" v={intent.tool} />
        <KV k="RESOURCE" v={intent.resource ?? "—"} />
        <KV k="RISK CLASS" v={intent.risk_class.toUpperCase()} />
        <KV k="ORIGIN" v={intent.origin} />
        <KV k="INTENT ID" v={intent.id} />
        <KV k="CREATED" v={fmtDateTime(intent.created_at)} />
        {intent.arguments_redacted && Object.keys(intent.arguments_redacted).length > 0 && (
          <KV
            k="ARGUMENTS (REDACTED)"
            v={JSON.stringify(intent.arguments_redacted)}
          />
        )}
      </Stage>

      <Stage label="DECISION" muted={!decision}>
        {decision ? (
          <>
            <KV k="DECISION" v={decision.decision.toUpperCase()} />
            <KV k="MATCHED POLICY" v={decision.matched_policy} />
            <KV k="MATCHED RULE" v={decision.matched_rule_id} />
            <KV k="RISK SCORE" v={String(decision.risk_score)} />
            <KV k="REASONS" v={reasonText(entry) || "—"} />
            <KV k="CONTEXT HASH" v={`${shortId(decision.context_snapshot_hash, 16)}…`} />
            <KV
              k="DETAIL"
              v={
                <Link href={`/console/decisions/${decision.id}`} className="link">
                  OPEN DECISION →
                </Link>
              }
            />
          </>
        ) : (
          <span className="mono" style={{ fontSize: 11, color: "#3f3f3f" }}>
            NO DECISION RECORDED
          </span>
        )}
      </Stage>

      <Stage label="CAPABILITY" muted={!capability}>
        {capability ? (
          <>
            <KV k="SCOPE" v={`${capability.action} · ${capability.resource}`} />
            <KV k="SUBJECT" v={capability.subject} />
            <KV k="BUDGET" v={usd(capability.budget_usd_cents)} />
            <KV k="EXPIRES" v={fmtDateTime(capability.expires_at)} />
            <KV k="NONCE" v={`${capability.nonce.slice(0, 8)}…`} />
            <KV k="POLICY HASH" v={`${capability.policy_hash.slice(0, 12)}…`} />
            <KV k="STATUS" v={capability.status.toUpperCase()} />
          </>
        ) : (
          <span className="mono" style={{ fontSize: 11, color: "#3f3f3f" }}>
            {denied ? "NO CAPABILITY — DENIED" : "NO CAPABILITY RECORDED"}
          </span>
        )}
      </Stage>

      <Stage label="PAYMENTS" muted={payments.length === 0}>
        {payments.length > 0 ? (
          payments.map((payment) => (
            <div key={payment.id} style={{ display: "grid", gap: 10 }}>
              <KV k="AMOUNT" v={`${usd(payment.amount_usd_cents)} · ${payment.network}`} />
              <KV k="SERVICE" v={payment.service} />
              <KV k="STATUS" v={payment.status.toUpperCase()} />
              <KV k="SETTLEMENT REF" v={payment.x402_ref ?? "—"} />
              <KV k="SETTLED" v={fmtDateTime(payment.settled_at)} />
            </div>
          ))
        ) : (
          <span className="mono" style={{ fontSize: 11, color: "#3f3f3f" }}>
            NO PAYMENT FOR THIS INTENT
          </span>
        )}
      </Stage>

      <Stage label="APPROVALS" muted={approvals.length === 0}>
        {approvals.length > 0 ? (
          approvals.map((approval) => (
            <div key={approval.id} style={{ display: "grid", gap: 10 }}>
              <KV
                k="PROVIDER"
                v={<ProviderBadge provider={approval.provider} />}
              />
              <KV k="TYPE" v={approval.type.toUpperCase()} />
              <KV k="OUTCOME" v={approval.status.toUpperCase()} />
              <KV k="REQUESTED" v={fmtDateTime(approval.requested_at)} />
              <KV k="COMPLETED" v={fmtDateTime(approval.completed_at)} />
              {approval.provider_ref && <KV k="PROVIDER REF" v={approval.provider_ref} />}
              {approval.status === "pending" && (
                <KV
                  k="ACTION"
                  v={
                    <Link href="/console/approvals" className="link">
                      RESOLVE IN APPROVAL QUEUE →
                    </Link>
                  }
                />
              )}
            </div>
          ))
        ) : (
          <span className="mono" style={{ fontSize: 11, color: "#3f3f3f" }}>
            NO APPROVAL REQUIRED
          </span>
        )}
      </Stage>

      <Stage label="EXECUTION" muted={executions.length === 0}>
        {executions.length > 0 ? (
          executions.map((execution) => (
            <div key={execution.id} style={{ display: "grid", gap: 10 }}>
              <KV k="STATUS" v={execution.status.toUpperCase()} />
              <KV k="EXECUTOR" v={execution.executor} />
              <KV k="TOOL" v={execution.tool} />
              <KV k="RESULT" v={execution.result_summary ?? "—"} />
              {execution.error && <KV k="ERROR" v={execution.error} />}
              <KV k="STARTED" v={fmtDateTime(execution.started_at)} />
              <KV k="COMPLETED" v={fmtDateTime(execution.completed_at)} />
            </div>
          ))
        ) : (
          <span className="mono" style={{ fontSize: 11, color: "#3f3f3f" }}>
            NO EXECUTION RECORDED
          </span>
        )}
      </Stage>
    </div>
  );
}

function EventsTab({ trace }: { trace: Trace }) {
  if (trace.events.length === 0) return <EmptyState />;
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <span className="mono" style={{ fontSize: 9.5, letterSpacing: "0.2em", color: "#5a5a5a" }}>
        {trace.events.length} AUDIT EVENTS — ORDERED
      </span>
      {trace.events.map((event, index) => (
        <div
          key={`${event.event_type}-${index}`}
          style={{
            borderBottom: "1px solid rgba(255,255,255,0.07)",
            paddingBottom: 12,
            display: "grid",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span className="mono" style={{ fontSize: 11.5, color: "#e8e8e8" }}>
              {event.event_type}
            </span>
            <span className="mono" style={{ fontSize: 10, color: "#5a5a5a" }}>
              {fmtDateTime(event.occurred_at)}
            </span>
          </div>
          <div className="mono" style={{ display: "grid", gap: 4, fontSize: 10.5 }}>
            {Object.entries(event.payload ?? {}).map(([key, value]) => (
              <div key={key} style={{ display: "flex", gap: 12 }}>
                <span style={{ color: "#5a5a5a", minWidth: 140 }}>{key}</span>
                <span style={{ color: "#c9c9c9", wordBreak: "break-word" }}>
                  {typeof value === "object" && value !== null
                    ? JSON.stringify(value)
                    : String(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TraceView({ taskId }: { taskId: string }) {
  const { data: trace, error, loading, reload } = useApi(`trace:${taskId}`, () =>
    getTrace(taskId),
  );
  const [tab, setTab] = useState("trace");

  if (loading && !trace) {
    return (
      <div>
        <Skeleton height={16} width={180} />
        <div style={{ marginTop: 18 }}>
          <Skeleton height={34} width={420} />
        </div>
        <div style={{ marginTop: 28, display: "grid", gap: 16 }}>
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} height={120} />
          ))}
        </div>
      </div>
    );
  }

  if (error && !trace) {
    return (
      <div>
        <ErrorWindow code={error.code} message={error.message} title="TRACE — ERROR" />
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

  if (!trace) return null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <p className="mono" style={{ fontSize: 11, letterSpacing: "0.2em", color: "#5a5a5a" }}>
            CONSOLE — ACTION TRACE
          </p>
          <h1
            style={{
              marginTop: 14,
              fontSize: "clamp(26px, 3vw, 42px)",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              lineHeight: 1.15,
              color: "#f4f4f4",
            }}
          >
            {trace.task.title}
          </h1>
          <p className="mono" style={{ marginTop: 12, fontSize: 11, color: "#8a8a8a" }}>
            TASK {trace.task.id} · STATUS {trace.task.status.toUpperCase()} · BUDGET{" "}
            {usd(trace.task.budget_usd_cents)}
          </p>
        </div>
        <Link
          href="/console/tasks"
          className="mono link"
          style={{ fontSize: 10.5, letterSpacing: "0.14em", alignSelf: "flex-start" }}
        >
          ← ALL TASKS
        </Link>
      </div>

      <div style={{ marginTop: 26 }}>
        <MacWindow
          tabs={[
            { id: "trace", label: "TRACE" },
            { id: "events", label: "EVENTS" },
          ]}
          activeTab={tab}
          onTabChange={setTab}
        >
          <div style={{ padding: "24px 24px 28px" }}>
            {tab === "trace" ? (
              trace.chain.length === 0 ? (
                <EmptyState />
              ) : (
                <div style={{ display: "grid", gap: 20 }}>
                  {trace.chain.map((entry, index) => (
                    <ChainEntry key={entry.intent.id} entry={entry} index={index} />
                  ))}
                </div>
              )
            ) : (
              <EventsTab trace={trace} />
            )}
          </div>
        </MacWindow>
      </div>
    </div>
  );
}
