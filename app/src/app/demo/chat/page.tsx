// plan-16 — /demo/chat (MacWindow, .mono, monochrome).
//
// Human demo surface: user bubbles, agent-intent JSON bubbles, verdict
// banners in filled/outlined/dashed states, trace + network links, tools
// chip, template buttons, free-text box, Play mode auto-running the scenario
// beat-by-beat with literal narration cues from docs/demo.md. Play ends on
// /network. Beat 0 is a title card + voiceover (no raw-agent build).
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import MacWindow from "@/components/MacWindow";
import { PLAY_BEATS, PINNED_TEMPLATE_IDS } from "@/server/demo/templates";
import {
  getChatBootstrap,
  pollApprovalFollowUp,
  postChatTurn,
  type ChatBootstrap,
  type ChatResponse,
  type ChatTurn,
} from "@/lib/api";

type Item =
  | { kind: "card"; cue: string }
  | { kind: "cue"; cue: string }
  | { kind: "user"; text: string }
  | { kind: "pending"; id: number }
  | { kind: "turn"; turn: ChatTurn };

let pendingSeq = 0;

function DecisionBanner({ turn }: { turn: ChatTurn }) {
  if (!turn.decision) return null;
  const reason = turn.reasons[0]?.code ?? turn.matched_rule_id ?? "—";
  const word =
    turn.decision === "allow" ? "Allow" : turn.decision === "deny" ? "Deny — BLOCKED" : "Escalate";
  const label = `Decision: ${word} — ${reason}`;
  if (turn.decision === "allow") {
    return (
      <div
        className="mono"
        style={{
          background: "#f4f4f4",
          color: "#000",
          fontSize: 11.5,
          letterSpacing: "0.08em",
          padding: "10px 14px",
          borderRadius: 6,
        }}
      >
        {label}
      </div>
    );
  }
  if (turn.decision === "escalate") {
    return (
      <div
        className="mono"
        style={{
          border: "1px solid #f4f4f4",
          color: "#f4f4f4",
          fontSize: 11.5,
          letterSpacing: "0.08em",
          padding: "10px 14px",
          borderRadius: 6,
        }}
      >
        {label}
      </div>
    );
  }
  return (
    <div
      className="mono"
      style={{
        border: "1px dashed #8a8a8a",
        color: "#e8e8e8",
        fontSize: 11.5,
        letterSpacing: "0.08em",
        padding: "10px 14px",
        borderRadius: 6,
      }}
    >
      {`✕ ${label}`}
    </div>
  );
}

function TurnView({ turn }: { turn: ChatTurn }) {
  // No-tool state: dashed-neutral, plain words — the message body is banned
  // from .mono, reason styling, trace payloads, and e2e assertions. Never
  // photographs as a Decision. (The tiny AGENT caption below the body is a
  // voice label, not engine output.)
  if (turn.kind === "no-tool" || turn.tool === null) {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "flex-start" }}>
          <div
            style={{
              border: "1px dashed #3a3a3a",
              borderRadius: 8,
              padding: "10px 14px",
              maxWidth: "80%",
              fontSize: 14,
              color: "#8a8a8a",
            }}
          >
            {turn.reply ?? turn.no_tool_message ?? "No tool matched — nothing was sent to the gateway"}
            <p className="mono" style={{ fontSize: 10, letterSpacing: "0.16em", color: "#5a5a5a", marginTop: 8 }}>
              AGENT — OUT OF SCOPE · GATEWAY NEVER CALLED
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <p className="mono" style={{ fontSize: 10, letterSpacing: "0.16em", color: "#5a5a5a" }}>
          {turn.client_label.toUpperCase()}
        </p>
        {turn.reply && (
          <div style={{ display: "grid", gap: 4 }}>
            <p className="mono" style={{ fontSize: 10, letterSpacing: "0.16em", color: "#5a5a5a" }}>
              LLM DRAFT
            </p>
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div style={{ fontSize: 14, color: "#e8e8e8", maxWidth: "85%" }}>{turn.reply}</div>
            </div>
          </div>
        )}
        {turn.intent && (
          <pre
            className="mono"
            style={{
              background: "#0b0b0b",
              border: "1px solid #2e2e2e",
              borderRadius: 6,
              padding: "12px 14px",
              fontSize: 11,
              lineHeight: 1.6,
              color: "#c9c9c9",
              overflowX: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {JSON.stringify(turn.intent, null, 2)}
          </pre>
        )}
        <DecisionBanner turn={turn} />
        {turn.decision === "deny" && (
          <div style={{ display: "grid", gap: 6 }}>
            <p className="mono" style={{ fontSize: 10.5, letterSpacing: "0.1em", color: "#8a8a8a" }}>
              GATEWAY INTERCEPTED — LLM DRAFTED, POLICY DENIED · NO CAPABILITY, NO EXECUTION
            </p>
            <div
              className="mono"
              style={{
                border: "1px dashed #3a3a3a",
                borderRadius: 6,
                padding: "10px 12px",
                fontSize: 11,
                lineHeight: 1.7,
                color: "#8a8a8a",
              }}
            >
              <p style={{ fontSize: 10, letterSpacing: "0.16em", color: "#5a5a5a", marginBottom: 4 }}>
                POLICY ENFORCEMENT DETAIL
              </p>
              {turn.matched_policy && <p>policy — {turn.matched_policy}</p>}
              {turn.matched_rule_id && <p>rule violated — {turn.matched_rule_id}</p>}
              {turn.reasons.length > 0 && (
                <p>reasons — {turn.reasons.map((r) => r.code).join(" · ")}</p>
              )}
              {turn.risk_score != null && <p>risk score — {turn.risk_score}</p>}
            </div>
          </div>
        )}
        {turn.approval && (
          <p className="mono" style={{ fontSize: 11, color: "#8a8a8a" }}>
            {`approval ${turn.approval.id.slice(0, 8)} · provider ${
              turn.approval.provider === "dev" ? "DEV (stand-in)" : turn.approval.provider.toUpperCase()
            } · ${turn.approval.status}`}
            {turn.approval_outcome === "rejected" ? " — the approver rejected it" : ""}
            {turn.decision === "escalate" && turn.approval.status === "pending" && !turn.approval_outcome
              ? " — awaiting approval in /console/approvals · this turn updates live"
              : ""}
          </p>
        )}
        {turn.receipt && (
          <p className="mono" style={{ fontSize: 11, color: "#c9c9c9" }}>
            {`receipt — $${(turn.receipt.amount_usd_cents / 100).toFixed(2)} · ${turn.receipt.network} · ${turn.receipt.ref} (${turn.receipt.ref_kind})`}
          </p>
        )}
        {turn.lines.capability && (
          <p className="mono" style={{ fontSize: 11, color: "#8a8a8a" }}>{turn.lines.capability}</p>
        )}
        {turn.lines.execution && (
          <p className="mono" style={{ fontSize: 11, color: "#8a8a8a" }}>{turn.lines.execution}</p>
        )}
        {turn.lines.payment && (
          <p className="mono" style={{ fontSize: 11, color: "#8a8a8a" }}>{turn.lines.payment}</p>
        )}
        {turn.follow_up && (
          <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
            <p className="mono" style={{ fontSize: 10, letterSpacing: "0.16em", color: "#5a5a5a" }}>
              AGENT FOLLOW-UP
            </p>
            <div style={{ fontSize: 14, color: "#e8e8e8", maxWidth: "85%" }}>{turn.follow_up}</div>
          </div>
        )}
        {turn.rejections.map((r) => (
          <p key={r.capability_id} className="mono" style={{ fontSize: 11, color: "#e8e8e8" }}>
            {`capability ${r.step} → rejected (${r.reason})`}
          </p>
        ))}
        {turn.anchors.length > 0 && (
          <div style={{ display: "grid", gap: 4 }}>
            {turn.anchors.map((a) => (
              <p key={`${a.event_type}-${a.fingerprint}`} className="mono" style={{ fontSize: 11, color: "#8a8a8a" }}>
                {`HCS anchor — ${a.event_type} · ${a.fingerprint.slice(0, 8)}`}
                {a.topic_url ? (
                  <a href={a.topic_url} target="_blank" rel="noreferrer" className="link" style={{ marginLeft: 8 }}>
                    {a.topic_id} →
                  </a>
                ) : (
                  <span style={{ marginLeft: 8, color: "#3a3a3a" }}>(anchoring disabled — no topic)</span>
                )}
              </p>
            ))}
          </div>
        )}
        <p className="mono" style={{ fontSize: 10.5, letterSpacing: "0.1em" }}>
          {turn.trace_url && (
            <Link href={turn.trace_url} className="link" style={{ marginRight: 18 }}>
              TRACE →
            </Link>
          )}
          <Link href={turn.network_url} className="link">
            NETWORK →
          </Link>
        </p>
      </div>
    </div>
  );
}

const PLAY_STEP_MS = 1600;
const TURN_TIMEOUT_MS = 30000;

// A hung request must surface into `failed`, never wedge busy/playing forever.
async function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("chat turn timed out after 30s")), TURN_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export default function DemoChat() {
  const router = useRouter();
  const [bootstrap, setBootstrap] = useState<ChatBootstrap | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  // The session task pins every turn of one conversation to the same task row
  // so chat sessions land in /console/tasks. Adopted from the first turn that
  // returns one; template-spec tasks (over-budget beat) always mint their own.
  const [sessionTaskId, setSessionTaskId] = useState<string | null>(null);
  // Speaker override: null follows the bootstrap default (first demo agent).
  // Switching speakers resets the session pin — the server mints a fresh Chat
  // task rather than merging turns into another agent's session.
  const [agentOverride, setAgentOverride] = useState<string | null>(null);

function describeFailure(err: unknown): string {
  if (err instanceof TypeError && err.message === "Failed to fetch") {
    return "Couldn't reach the dev server — is `pnpm dev` running on this origin?";
  }
  return err instanceof Error ? err.message : String(err);
}
  const bottomRef = useRef<HTMLDivElement>(null);
  const playAbort = useRef(false);

  useEffect(() => {
    getChatBootstrap().then(setBootstrap).catch(() => undefined);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items]);

  // Post-approval live update: an escalated turn renders "awaiting approval"
  // and this poll watches the approval row. When the right-side console
  // resolves it, the turn patches in place — approved: execution summary +
  // agent follow-up; rejected: the rejection line. Stops after 5 minutes.
  function watchApproval(turnId: string, approvalId: string, message: string, tool: string | null, agentKey: string): void {
    if (!tool) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (attempts > 100) {
        clearInterval(timer);
        return;
      }
      pollApprovalFollowUp({ approval_id: approvalId, message, tool, agent_key: agentKey })
        .then((poll) => {
          if (poll.status === "pending") return;
          clearInterval(timer);
          setItems((prev) =>
            prev.map((item) => {
              if (item.kind !== "turn" || item.turn.task_id !== turnId || item.turn.approval?.id !== approvalId) {
                return item;
              }
              const turn = { ...item.turn };
              turn.approval = turn.approval ? { ...turn.approval, status: poll.status } : turn.approval;
              if (poll.outcome === "rejected") {
                turn.approval_outcome = "rejected";
                turn.lines = { ...turn.lines, execution: "no capability, no execution — the approver rejected it" };
              } else if (poll.outcome === "approved") {
                turn.approval_outcome = "approved";
                if (poll.execution_summary) {
                  turn.lines = { ...turn.lines, execution: poll.execution_summary };
                }
                if (poll.follow_up) turn.follow_up = poll.follow_up;
              }
              return { ...item, turn };
            }),
          );
        })
        .catch(() => undefined);
    }, 3000);
  }

  async function sendTemplate(template_id: string, chat_text: string): Promise<void> {
    setBusy(true);
    setFailed(null);
    const pid = ++pendingSeq;
    // Optimistic echo: the user bubble + a deciding indicator render
    // instantly — the engine round-trip never leaves dead silence.
    setItems((prev) => [...prev, { kind: "user", text: chat_text }, { kind: "pending", id: pid }]);
    try {
      const res = await withTimeout(
        postChatTurn({
          template_id,
          ...(sessionTaskId ? { task_id: sessionTaskId } : {}),
          ...(agentOverride ? { agent_key: agentOverride } : {}),
        }),
      );
      if (!sessionTaskId && res.turn.task_id) setSessionTaskId(res.turn.task_id);
      setItems((prev) =>
        prev.map((item) =>
          item.kind === "pending" && item.id === pid
            ? { kind: "turn" as const, turn: { ...res.turn, chat_text } }
            : item,
        ),
      );
      if (
        res.turn.decision === "escalate" &&
        res.turn.approval?.id &&
        res.turn.approval.status === "pending" &&
        res.turn.task_id
      ) {
        watchApproval(
          res.turn.task_id,
          res.turn.approval.id,
          chat_text,
          res.turn.tool,
          agentOverride ?? bootstrap?.agents[0]?.agent_key ?? "agent:8472",
        );
      }
    } catch (err) {
      setFailed(describeFailure(err));
      setItems((prev) => prev.filter((item) => !(item.kind === "pending" && item.id === pid)));
    } finally {
      setBusy(false);
    }
  }

  async function sendFreeText(): Promise<void> {
    const message = input.trim();
    if (!message || busy || playing) return;
    setInput("");
    setBusy(true);
    setFailed(null);
    const pid = ++pendingSeq;
    setItems((prev) => [...prev, { kind: "user", text: message }, { kind: "pending", id: pid }]);
    try {
      const res = await withTimeout(
        postChatTurn({
          message,
          ...(sessionTaskId ? { task_id: sessionTaskId } : {}),
          ...(agentOverride ? { agent_key: agentOverride } : {}),
        }),
      );
      if (!sessionTaskId && res.turn.task_id) setSessionTaskId(res.turn.task_id);
      setItems((prev) =>
        prev.map((item) =>
          item.kind === "pending" && item.id === pid ? { kind: "turn" as const, turn: res.turn } : item,
        ),
      );
      if (
        res.turn.decision === "escalate" &&
        res.turn.approval?.id &&
        res.turn.approval.status === "pending" &&
        res.turn.task_id
      ) {
        watchApproval(
          res.turn.task_id,
          res.turn.approval.id,
          message,
          res.turn.tool,
          agentOverride ?? bootstrap?.agents[0]?.agent_key ?? "agent:8472",
        );
      }
    } catch (err) {
      setFailed(describeFailure(err));
      setItems((prev) => prev.filter((item) => !(item.kind === "pending" && item.id === pid)));
    } finally {
      setBusy(false);
    }
  }

  async function play(): Promise<void> {
    if (playing || busy) return;
    setPlaying(true);
    playAbort.current = false;
    setFailed(null);
    // A Play run is one session: reset the pin so all beats share one task.
    setSessionTaskId(null);
    let playTaskId: string | null = null;
    try {
      for (const beat of PLAY_BEATS) {
        if (playAbort.current) break;
        if (beat.template_id === null) {
          setItems((prev) => [...prev, beat.card ? { kind: "card", cue: beat.cue } : { kind: "cue", cue: beat.cue }]);
        } else {
          setItems((prev) => [...prev, { kind: "cue", cue: beat.cue }]);
          const label = bootstrap?.templates.find((t) => t.id === beat.template_id)?.chat_text ?? beat.template_id;
          const pid = ++pendingSeq;
          setItems((prev) => [...prev, { kind: "user", text: label }, { kind: "pending", id: pid }]);
          const res: ChatResponse = await withTimeout(
            postChatTurn(playTaskId ? { template_id: beat.template_id, task_id: playTaskId } : { template_id: beat.template_id }),
          );
          if (!playTaskId && res.turn.task_id) {
            playTaskId = res.turn.task_id;
            setSessionTaskId(res.turn.task_id);
          }
          setItems((prev) =>
            prev.map((item) =>
              item.kind === "pending" && item.id === pid
                ? { kind: "turn" as const, turn: { ...res.turn, chat_text: label } }
                : item,
            ),
          );
        }
        await new Promise((resolve) => setTimeout(resolve, PLAY_STEP_MS));
      }
      if (!playAbort.current) router.push("/network");
    } catch (err) {
      setFailed(describeFailure(err));
      setItems((prev) => prev.filter((item) => item.kind !== "pending"));
    } finally {
      setPlaying(false);
    }
  }

  const providerOn = bootstrap?.provider.configured ?? false;
  const toolsCount = bootstrap?.tools.connected;
  const demoAgents = bootstrap?.agents ?? [];
  // Speaker identity: explicit pick, else the bootstrap default (first agent).
  // "agent:8472" marks shared templates — they run as the speaker, so the
  // same action can verdict differently per agent. Pinned ones (lab-1,
  // treasury beats) keep their scripted identity and list under their owner.
  const speakerKey = agentOverride ?? demoAgents[0]?.agent_key ?? "agent:8472";
  const speakerName = demoAgents.find((a) => a.agent_key === speakerKey)?.name ?? speakerKey;
  const allTemplates = (bootstrap?.templates ?? []).filter(
    (t) => t.agent_key === speakerKey || t.agent_key === "agent:8472",
  );
  const pinned = allTemplates.filter((t) => (PINNED_TEMPLATE_IDS as readonly string[]).includes(t.id));
  const visible = showAll ? allTemplates : pinned.length > 0 ? pinned : allTemplates;

  function pickAgent(next: string | null): void {
    setAgentOverride(next);
    // New speaker, new session — never merge turns into another agent's task.
    setSessionTaskId(null);
  }

  return (
    <div className="section-pad" style={{ maxWidth: 880, margin: "0 auto" }}>
      <p className="mono" style={{ fontSize: 11, letterSpacing: "0.2em", color: "#5a5a5a" }}>
        DEMO — CHAT
      </p>
      <h1 style={{ fontSize: "clamp(34px, 5vw, 56px)", fontWeight: 800, marginTop: 12 }}>
        Watch the gateway decide.
      </h1>
      <p style={{ marginTop: 12, fontSize: 16, color: "#8a8a8a", maxWidth: 620 }}>
        Each scenario runs through the real pipeline. Every turn shows the verbatim
        intent, the real decision with its reason code, and the trace.
      </p>
      <p className="mono" style={{ marginTop: 10, fontSize: 10.5, letterSpacing: "0.14em", color: "#5a5a5a" }}>
        {`SPEAKING AS ${speakerName.toUpperCase()} · ${speakerKey}`}
      </p>

      <div style={{ marginTop: 28, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <p
          className="mono"
          style={{
            fontSize: 10.5,
            letterSpacing: "0.14em",
            border: "1px solid #2e2e2e",
            borderRadius: 6,
            padding: "8px 12px",
            color: "#c9c9c9",
          }}
        >
          {toolsCount == null ? "TOOLS — UNKNOWN" : toolsCount === 5 ? "5 TOOLS CONNECTED" : `${toolsCount} TOOLS CONNECTED`}
        </p>
        {!providerOn && (
          <p className="mono" style={{ fontSize: 10.5, letterSpacing: "0.14em", color: "#5a5a5a" }}>
            TEMPLATES ONLY — NO PROVIDER
          </p>
        )}
        {demoAgents.length > 0 && (
          <label className="mono" style={{ fontSize: 10.5, letterSpacing: "0.14em", color: "#8a8a8a", display: "flex", alignItems: "center", gap: 8 }}>
            AGENT
            <select
              value={speakerKey}
              onChange={(e) => pickAgent(e.target.value === (demoAgents[0]?.agent_key ?? "agent:8472") ? null : e.target.value)}
              disabled={busy || playing}
              className="mono"
              aria-label="Pick the demo agent speaking"
              style={{
                background: "#0b0b0b",
                border: "1px solid #2e2e2e",
                borderRadius: 6,
                padding: "8px 10px",
                color: "#e8e8e8",
                fontSize: 11,
                letterSpacing: "0.1em",
                outline: "none",
                cursor: "pointer",
                maxWidth: 260,
              }}
            >
              {demoAgents.map((a) => (
                <option key={a.agent_key} value={a.agent_key}>
                  {a.name} · {a.agent_key}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          onClick={playing ? () => { playAbort.current = true; } : play}
          disabled={busy && !playing}
          className="mono btn-outline"
          style={{ background: "transparent", cursor: "pointer", marginLeft: "auto" }}
        >
          {playing ? "■ STOP" : "▶ PLAY"}
        </button>
      </div>

      <div style={{ marginTop: 20 }}>
        <MacWindow title="DEMO — CHAT">
          <div style={{ padding: 20, display: "grid", gap: 20, minHeight: 280 }}>
            {items.length === 0 && (
              <p className="mono" style={{ fontSize: 11, letterSpacing: "0.1em", color: "#5a5a5a" }}>
                PICK A SCENARIO BELOW — OR PRESS PLAY FOR THE HANDS-FREE TAKE.
              </p>
            )}
            {items.map((item, i) => {
              if (item.kind === "card") {
                return (
                  <div
                    key={i}
                    style={{
                      border: "1px solid #f4f4f4",
                      borderRadius: 8,
                      padding: "28px 24px",
                      textAlign: "center",
                    }}
                  >
                    <p className="mono" style={{ fontSize: 10, letterSpacing: "0.2em", color: "#5a5a5a" }}>
                      BEAT 0 — TITLE CARD
                    </p>
                    <p style={{ fontSize: 20, fontWeight: 700, marginTop: 12 }}>{item.cue}</p>
                  </div>
                );
              }
              if (item.kind === "cue") {
                return (
                  <p key={i} style={{ fontSize: 14, color: "#8a8a8a", fontStyle: "italic" }}>
                    {item.cue}
                  </p>
                );
              }
              if (item.kind === "user") {
                return (
                  <div key={i} style={{ display: "flex", justifyContent: "flex-end" }}>
                    <div
                      style={{
                        border: "1px solid #3a3a3a",
                        borderRadius: 8,
                        padding: "10px 14px",
                        maxWidth: "80%",
                        fontSize: 14,
                        color: "#e8e8e8",
                      }}
                    >
                      {item.text}
                    </div>
                  </div>
                );
              }
              if (item.kind === "pending") {
                return (
                  <p key={i} className="mono" style={{ fontSize: 11, letterSpacing: "0.14em", color: "#5a5a5a" }}>
                    DECIDING — CALLING GATEWAY…
                  </p>
                );
              }
              return <TurnView key={i} turn={item.turn} />;
            })}
            {failed && (
              <p className="mono" style={{ fontSize: 11, color: "#e8e8e8" }}>
                {`TURN FAILED — ${failed}`}
              </p>
            )}
            <div ref={bottomRef} />
          </div>
        </MacWindow>
      </div>

      <div style={{ marginTop: 20 }}>
        <p className="mono" style={{ fontSize: 10, letterSpacing: "0.16em", color: "#5a5a5a", marginBottom: 10 }}>
          SCENARIOS
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {visible.map((t) => (
            <button
              key={t.id}
              onClick={() => sendTemplate(t.id, t.chat_text)}
              disabled={busy || playing}
              className="mono btn-outline"
              style={{ background: "transparent", cursor: "pointer" }}
              title={t.chat_text}
            >
              {t.label.toUpperCase()}
            </button>
          ))}
          {allTemplates.length > pinned.length && (
            <button
              onClick={() => setShowAll((v) => !v)}
              disabled={busy || playing}
              className="mono btn-outline"
              style={{ background: "transparent", cursor: "pointer" }}
            >
              {showAll ? "− FEWER" : `+ ${allTemplates.length - pinned.length} MORE SCENARIOS`}
            </button>
          )}
        </div>
      </div>

      <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void sendFreeText(); }}
          placeholder={
            providerOn ? "Ask anything — the LLM drafts, the gateway decides…" : "Free text disabled — no provider configured (templates only)"
          }
          disabled={!providerOn || busy || playing}
          className="mono"
          aria-label="Free-text message to the demo agent"
          style={{
            flex: 1,
            background: "#0b0b0b",
            border: "1px solid #2e2e2e",
            borderRadius: 8,
            padding: "12px 14px",
            color: "#e8e8e8",
            fontSize: 13,
            outline: "none",
            opacity: !providerOn ? 0.5 : 1,
          }}
        />
        <button
          onClick={() => void sendFreeText()}
          disabled={!providerOn || busy || playing || input.trim() === ""}
          className="mono btn-outline"
          style={{ background: "transparent", cursor: "pointer" }}
        >
          SEND
        </button>
      </div>
      <p className="mono" style={{ marginTop: 16, fontSize: 10, letterSpacing: "0.1em", color: "#3a3a3a" }}>
        {providerOn
          ? "FREE TEXT — LLM DRAFTS THE TOOL CALL · DETERMINISTIC POLICY ALLOWS / DENIES / ESCALATES · TRY “DELETE THE REPO”"
          : "DEMO SURFACE — MOCK LABELS INTACT · DEV PROVIDER LABELED · HCS LINKS REAL-OR-ABSENT"}
      </p>
    </div>
  );
}
