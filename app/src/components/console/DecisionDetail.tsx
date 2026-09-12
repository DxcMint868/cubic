"use client";

import Link from "next/link";
import {
  DecisionTag,
  EmptyState,
  ErrorWindow,
  Panel,
  Skeleton,
  Tag,
} from "@/components/ConsoleBits";
import { ProviderBadge } from "@/components/ConsoleBits";
import { asString, fmtDateTime, shortId, usd } from "@/components/console/derive";
import { getAuditEventsPaged, getTrace, useApi, type TraceChainEntry } from "@/lib/api";

interface DecisionData {
  taskId: string;
  taskTitle: string;
  taskStatus: string;
  entry: TraceChainEntry;
  decisionAt: string;
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "170px 1fr",
        gap: 14,
        alignItems: "baseline",
      }}
    >
      <span className="mono" style={{ fontSize: 9.5, letterSpacing: "0.14em", color: "#5a5a5a" }}>
        {k}
      </span>
      <span
        className="mono"
        style={{ fontSize: 12, color: "#c9c9c9", lineHeight: 1.6, wordBreak: "break-word" }}
      >
        {v}
      </span>
    </div>
  );
}

export default function DecisionDetail({ decisionId }: { decisionId: string }) {
  const { data, error, loading, reload } = useApi(
    `decision:${decisionId}`,
    async (): Promise<DecisionData | null> => {
      const events = await getAuditEventsPaged({
        eventType: "policy.evaluated",
        maxPages: 5,
      });
      const match = events.find(
        (event) => asString(event.payload.decision_id) === decisionId,
      );
      if (!match || !match.task_id) return null;
      const trace = await getTrace(match.task_id);
      const entry = trace.chain.find((item) => item.decision?.id === decisionId) ?? null;
      if (!entry) return null;
      return {
        taskId: trace.task.id,
        taskTitle: trace.task.title,
        taskStatus: trace.task.status,
        entry,
        decisionAt: match.created_at,
      };
    },
  );

  if (loading && data === null && !error) {
    return (
      <div style={{ display: "grid", gap: 18 }}>
        <Skeleton height={16} width={220} />
        <Skeleton height={38} width={420} />
        <Skeleton height={240} />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <ErrorWindow code={error.code} message={error.message} title="DECISION — ERROR" />
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

  if (!data) {
    return (
      <div>
        <p className="mono" style={{ fontSize: 11, letterSpacing: "0.2em", color: "#5a5a5a" }}>
          CONSOLE — DECISION
        </p>
        <h1 style={{ marginTop: 14, fontSize: 30, fontWeight: 700, color: "#f4f4f4" }}>
          {shortId(decisionId, 12)}
        </h1>
        <div style={{ marginTop: 28 }}>
          <EmptyState />
        </div>
      </div>
    );
  }

  const { entry, decisionAt } = data;
  const { intent, decision, capability, payments, executions, approvals } = entry;
  const denied = decision?.decision === "deny";
  const escalated = decision?.decision === "escalate";
  const reasons = decision?.reasons ?? [];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <p className="mono" style={{ fontSize: 11, letterSpacing: "0.2em", color: "#5a5a5a" }}>
            CONSOLE — DECISION
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
            {decision?.matched_rule_id ?? shortId(decisionId, 12)}
          </h1>
          <p className="mono" style={{ marginTop: 12, fontSize: 11, color: "#8a8a8a" }}>
            DECISION {shortId(decisionId, 12)} · {fmtDateTime(decisionAt)}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, alignSelf: "flex-start" }}>
          {decision && <DecisionTag d={decision.decision.toUpperCase()} />}
          <Link
            href={`/console/tasks/${data.taskId}`}
            className="mono link"
            style={{ fontSize: 10.5, letterSpacing: "0.14em" }}
          >
            FULL TRACE →
          </Link>
        </div>
      </div>

      {denied && (
        <div
          className="mono"
          style={{
            marginTop: 26,
            border: "1px dashed #c9c9c9",
            padding: "14px 16px",
            fontSize: 11,
            letterSpacing: "0.08em",
            color: "#f4f4f4",
            lineHeight: 1.9,
          }}
        >
          DENIED — {reasons.map((reason) => reason.code).join(" · ") || "no reason recorded"}
        </div>
      )}
      {escalated && (
        <div
          className="mono"
          style={{
            marginTop: 26,
            border: "1px solid #8a8a8a",
            padding: "14px 16px",
            fontSize: 11,
            letterSpacing: "0.08em",
            color: "#e8e8e8",
            lineHeight: 1.9,
          }}
        >
          ESCALATED — APPROVAL REQUIRED
          {reasons.length > 0 ? ` · ${reasons.map((reason) => reason.code).join(" · ")}` : ""}
        </div>
      )}

      <div style={{ marginTop: 26 }}>
        <Panel title="DECISION — DETAIL">
          <div
            style={{
              display: "grid",
              gap: 14,
            }}
          >
        <KV k="TASK" v={`${data.taskTitle} · ${data.taskStatus.toUpperCase()}`} />
        <KV k="INTENT" v={`${intent.tool} · ${intent.resource ?? "—"}`} />
        <KV k="MATCHED POLICY" v={decision?.matched_policy ?? "—"} />
        <KV k="MATCHED RULE" v={decision?.matched_rule_id ?? "—"} />
        <KV k="RISK SCORE" v={String(decision?.risk_score ?? "—")} />
        <KV
          k="REASONS"
          v={
            reasons.length > 0 ? (
              <span style={{ display: "inline-grid", gap: 6 }}>
                {reasons.map((reason) => (
                  <span key={reason.code}>
                    <span style={{ color: "#f4f4f4" }}>{reason.code}</span>
                    {reason.detail ? ` — ${reason.detail}` : ""}
                  </span>
                ))}
              </span>
            ) : (
              "—"
            )
          }
        />
        <KV k="CONTEXT HASH" v={`${shortId(decision?.context_snapshot_hash, 20)}…`} />
        <KV k="DECIDED AT" v={fmtDateTime(decision?.created_at)} />
          </div>
        </Panel>
      </div>

      <div style={{ marginTop: 20 }}>
        <Panel title="DECISION — CONSEQUENCES">
          <div
            style={{
              display: "grid",
              gap: 14,
            }}
          >
        {capability ? (
          <>
            <KV k="CAPABILITY" v={`${capability.action} · ${capability.resource}`} />
            <KV k="SUBJECT" v={capability.subject} />
            <KV k="BUDGET" v={usd(capability.budget_usd_cents)} />
            <KV k="NONCE" v={`${capability.nonce.slice(0, 8)}…`} />
            <KV k="POLICY HASH" v={`${capability.policy_hash.slice(0, 12)}…`} />
            <KV k="STATUS" v={capability.status.toUpperCase()} />
          </>
        ) : (
          <KV k="CAPABILITY" v={denied ? "NOT ISSUED — DENIED" : "NOT ISSUED"} />
        )}

        {approvals.map((approval) => (
          <KV
            key={approval.id}
            k="APPROVAL"
            v={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                <ProviderBadge provider={approval.provider} />
                <span>{approval.status.toUpperCase()}</span>
                {approval.provider_ref && <span>{approval.provider_ref}</span>}
              </span>
            }
          />
        ))}

        {payments.map((payment) => (
          <KV
            key={payment.id}
            k="PAYMENT"
            v={`${usd(payment.amount_usd_cents)} · ${payment.network} · ${payment.status.toUpperCase()}${
              payment.x402_ref ? ` · ${payment.x402_ref}` : ""
            }`}
          />
        ))}

        {executions.map((execution) => (
          <KV
            key={execution.id}
            k="EXECUTION"
            v={`${execution.status.toUpperCase()} · ${execution.executor}${
              execution.result_summary ? ` · ${execution.result_summary}` : ""
            }`}
          />
        ))}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Tag>{reasons.length} REASON{reasons.length === 1 ? "" : "S"}</Tag>
          {capability && <Tag>CAPABILITY {shortId(capability.id, 8)}</Tag>}
          {approvals.length > 0 && <Tag>{approvals.length} APPROVAL</Tag>}
        </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
