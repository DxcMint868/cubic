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
import { deriveAgents, fmtAge, shortId } from "@/components/console/derive";
import { getAuditEvents, useApi } from "@/lib/api";

export default function ConsoleAgents() {
  const { data, error, loading, reload } = useApi("console-agents", () =>
    getAuditEvents({ limit: 200 }),
  );
  const agents = useMemo(() => deriveAgents(data ?? []), [data]);

  if (loading && !data) {
    return (
      <div>
        <PageHead eyebrow="CONSOLE — AGENTS" title="Agents you authorize." />
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
        <PageHead eyebrow="CONSOLE — AGENTS" title="Agents you authorize." />
        <div style={{ marginTop: 28 }}>
          <ErrorWindow code={error.code} message={error.message} title="AGENTS — ERROR" />
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
        eyebrow="CONSOLE — AGENTS"
        title="Agents you authorize."
        sub="Every agent observed in the tenant audit log, with its intent and decision counts. Open an agent to see its identity (resolved from capability subjects) and its task activity."
      />
      <div style={{ marginTop: 28 }}>
        <Panel title={`${agents.length} AGENTS — FROM AUDIT EVENTS`}>
          {agents.length === 0 ? (
            <EmptyState />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="mono" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>AGENT ID</th>
                    <th style={th}>TASKS</th>
                    <th style={th}>INTENTS</th>
                    <th style={th}>ALLOW / ESC / DENY</th>
                    <th style={th}>APPROVALS</th>
                    <th style={th}>LAST EVENT</th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {agents.map((agent) => (
                    <tr key={agent.agentId}>
                      <td style={{ ...td, fontSize: 11 }}>{shortId(agent.agentId, 12)}</td>
                      <td style={td}>{agent.taskIds.length}</td>
                      <td style={td}>{agent.intents}</td>
                      <td style={td}>
                        {agent.allowed} / {agent.escalated} / {agent.denied}
                      </td>
                      <td style={td}>{agent.approvals}</td>
                      <td style={{ ...td, fontSize: 11 }}>{fmtAge(agent.lastEventAt)} ago</td>
                      <td style={{ ...td, textAlign: "right" }}>
                        <Link
                          href={`/console/agents/${agent.agentId}`}
                          className="link"
                          style={{ fontSize: 10.5, letterSpacing: "0.12em" }}
                        >
                          OPEN →
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
