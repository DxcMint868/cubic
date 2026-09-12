"use client";

import { useEffect, useRef } from "react";
import type { NetworkEvent } from "@/lib/api";

interface AgentNode {
  pseudonym: string;
  category: string;
  count: number;
  risk: string;
  allow: number;
  deny: number;
  escalate: number;
  rejected: number;
  lastId: number;
  lastEventType: string;
  lastPolicy: "allow" | "deny" | "escalate" | null;
}

interface Pulse {
  id: number;
  pseudonym: string;
  actionClass: string;
  eventType: string;
  outcome: string;
  risk: string;
  start: number;
  duration: number;
}

interface PaymentMark {
  id: number;
  start: number;
  failed: boolean;
}

const PAYMENT_MARK_MS = 45000;
const PULSE_MS = 1300;
const BLOCKED = new Set([
  "deny",
  "rejected",
  "not_found",
  "replay",
  "expired",
  "action_mismatch",
  "resource_mismatch",
  "budget_exceeded",
  "denied",
  "failed",
]);

function buildNodes(events: NetworkEvent[]): AgentNode[] {
  const map = new Map<string, AgentNode>();
  for (const event of events) {
    let node = map.get(event.agent_pseudonym);
    if (!node) {
      node = {
        pseudonym: event.agent_pseudonym,
        category: event.agent_category,
        count: 0,
        risk: event.risk_class,
        allow: 0,
        deny: 0,
        escalate: 0,
        rejected: 0,
        lastId: 0,
        lastEventType: "",
        lastPolicy: null,
      };
      map.set(event.agent_pseudonym, node);
    }
    node.count += 1;
    if (event.id >= node.lastId) {
      node.lastId = event.id;
      node.category = event.agent_category || node.category;
      node.risk = event.risk_class || node.risk;
      node.lastEventType = event.event_type;
    }
    if (event.event_type === "policy.evaluated") {
      if (event.outcome === "allow") node.allow += 1;
      else if (event.outcome === "deny") node.deny += 1;
      else if (event.outcome === "escalate") node.escalate += 1;
      if (event.outcome === "allow" || event.outcome === "deny" || event.outcome === "escalate") {
        node.lastPolicy = event.outcome;
      }
    }
    if (event.event_type === "capability.rejected") node.rejected += 1;
  }
  return [...map.values()].sort((a, b) => a.pseudonym.localeCompare(b.pseudonym));
}

function nodeState(node: AgentNode): "allow" | "deny" | "escalate" | "rejected" {
  if (node.lastEventType === "capability.rejected") return "rejected";
  if (node.lastPolicy === "deny") return "deny";
  if (node.lastPolicy === "escalate") return "escalate";
  return "allow";
}

export default function NetworkGraph({
  events,
  selected,
  onSelect,
}: {
  events: NetworkEvent[];
  selected: string | null;
  onSelect: (pseudonym: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let hover: string | null = null;
    let primed = false;
    let lastSeenId = 0;
    let pulses: Pulse[] = [];
    let marks: PaymentMark[] = [];
    let hit: { pseudonym: string; x: number; y: number; size: number }[] = [];

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
    };

    const square = (x: number, y: number, size: number, fill: boolean) => {
      if (fill) ctx.fillRect(x - size / 2, y - size / 2, size, size);
      else ctx.strokeRect(x - size / 2 + 0.5, y - size / 2 + 0.5, size - 1, size - 1);
    };

    const frame = () => {
      const now = performance.now();
      const all = eventsRef.current;

      if (!primed && all.length > 0) {
        primed = true;
        lastSeenId = all[all.length - 1].id;
      } else if (primed) {
        const fresh = all.filter((event) => event.id > lastSeenId);
        if (fresh.length > 0) {
          lastSeenId = fresh[fresh.length - 1].id;
          for (const event of fresh.slice(-12)) {
            pulses.push({
              id: event.id,
              pseudonym: event.agent_pseudonym,
              actionClass: event.action_class,
              eventType: event.event_type,
              outcome: event.outcome,
              risk: event.risk_class,
              start: now,
              duration: PULSE_MS,
            });
            if (event.event_type.startsWith("payment.")) {
              marks.push({
                id: event.id,
                start: now,
                failed: event.event_type === "payment.failed",
              });
            }
          }
        }
      }

      pulses = pulses.filter((pulse) => now - pulse.start < pulse.duration);
      marks = marks.filter((mark) => now - mark.start < PAYMENT_MARK_MS);

      const nodes = buildNodes(all);
      const categories = [...new Set(nodes.map((node) => node.category))].sort();
      const cx = w / 2;
      const cy = h / 2;
      const ring = Math.min(w, h) * 0.34;
      const anchors = new Map<string, { x: number; y: number }>();
      categories.forEach((category, index) => {
        const angle =
          categories.length === 1
            ? -Math.PI / 2
            : -Math.PI / 2 + (index * Math.PI * 2) / categories.length;
        const radius = categories.length === 1 ? ring * 0.62 : ring;
        anchors.set(category, {
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
        });
      });

      const positions = new Map<string, { x: number; y: number; size: number }>();
      hit = [];
      const groups = new Map<string, AgentNode[]>();
      for (const node of nodes) {
        const group = groups.get(node.category) ?? [];
        group.push(node);
        groups.set(node.category, group);
      }
      for (const [category, group] of groups) {
        const anchor = anchors.get(category);
        if (!anchor) continue;
        const cols = Math.ceil(Math.sqrt(group.length));
        const rows = Math.ceil(group.length / cols);
        const gap = 36;
        group.forEach((node, index) => {
          const row = Math.floor(index / cols);
          const col = index % cols;
          const x = anchor.x + (col - (cols - 1) / 2) * gap;
          const y = anchor.y + (row - (rows - 1) / 2) * gap;
          const size = 13 + Math.min(node.count, 24) * 0.55;
          positions.set(node.pseudonym, { x, y, size });
          hit.push({ pseudonym: node.pseudonym, x, y, size });
        });
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);

      ctx.font = "9px ui-monospace, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (const [category, group] of groups) {
        const anchor = anchors.get(category);
        if (!anchor) continue;
        const cols = Math.ceil(Math.sqrt(group.length));
        const rows = Math.ceil(group.length / cols);
        const gap = 36;
        const halfW = Math.max(cols - 1, 0) * (gap / 2) + 22;
        const halfH = Math.max(rows - 1, 0) * (gap / 2) + 22;
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = "rgba(255,255,255,0.1)";
        ctx.lineWidth = 1;
        ctx.strokeRect(anchor.x - halfW + 0.5, anchor.y - halfH + 0.5, halfW * 2 - 1, halfH * 2 - 1);
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(255,255,255,0.34)";
        ctx.fillText(category.toUpperCase(), anchor.x, anchor.y - halfH - 10);
      }

      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const node of nodes) {
        const position = positions.get(node.pseudonym);
        if (!position) continue;
        ctx.moveTo(position.x, position.y);
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();

      ctx.strokeStyle = "#c9c9c9";
      ctx.lineWidth = 1;
      square(cx, cy, 30, false);
      ctx.fillStyle = "#c9c9c9";
      square(cx, cy, 8, true);
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillText("GATEWAY", cx, cy + 28);

      for (const mark of marks) {
        const age = (now - mark.start) / PAYMENT_MARK_MS;
        const alpha = Math.max(0, 1 - age);
        const offset = Math.min(marks.length, 8);
        const index = marks.indexOf(mark);
        const angle = -Math.PI / 2 + (index / Math.max(offset, 1)) * Math.PI * 2;
        const mx = cx + Math.cos(angle) * 30;
        const my = cy + Math.sin(angle) * 30;
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(Math.PI / 4);
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = mark.failed ? "#5a5a5a" : "#e8e8e8";
        ctx.setLineDash(mark.failed ? [2, 2] : []);
        ctx.lineWidth = 1;
        square(0, 0, 8, false);
        ctx.restore();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      ctx.textAlign = "center";
      for (const pulse of pulses) {
        const position = positions.get(pulse.pseudonym);
        if (!position) continue;
        const t = Math.min(1, (now - pulse.start) / pulse.duration);
        const blocked = BLOCKED.has(pulse.outcome);
        const limit = blocked ? Math.min(t, 0.58) : t;
        const headX = position.x + (cx - position.x) * limit;
        const headY = position.y + (cy - position.y) * limit;
        const tailT = Math.max(0, limit - 0.22);
        const tailX = position.x + (cx - position.x) * tailT;
        const tailY = position.y + (cy - position.y) * tailT;
        const fade = blocked ? Math.max(0, 1 - Math.max(0, t - 0.58) / 0.42) : 1 - t;
        const alpha = Math.max(0.08, fade);
        const escalated = pulse.outcome === "escalate" || pulse.outcome === "escalated";

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = "#e8e8e8";

        if (pulse.actionClass === "payment") {
          ctx.lineWidth = 2;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(tailX, tailY);
          ctx.lineTo(headX, headY);
          ctx.stroke();
          ctx.translate(headX, headY);
          ctx.rotate(Math.PI / 4);
          square(0, 0, 7, !blocked);
        } else {
          if (pulse.actionClass === "intent") {
            ctx.setLineDash([1, 3]);
            ctx.lineWidth = 1;
          } else if (pulse.actionClass === "approval") {
            ctx.setLineDash([5, 4]);
            ctx.lineWidth = 1;
          } else if (pulse.actionClass === "execution") {
            ctx.setLineDash([]);
            ctx.lineWidth = 3;
          } else if (pulse.actionClass === "authorization") {
            ctx.setLineDash([]);
            ctx.lineWidth = 2;
          } else if (pulse.actionClass === "discovery") {
            ctx.setLineDash([1, 2]);
            ctx.lineWidth = 1;
          } else if (pulse.actionClass === "evaluation") {
            ctx.setLineDash([]);
            ctx.lineWidth = 1.5;
          } else if (pulse.actionClass === "task") {
            ctx.setLineDash([1, 5]);
            ctx.lineWidth = 1;
          } else {
            ctx.setLineDash([]);
            ctx.lineWidth = blocked ? 1 : 1.5;
          }
          ctx.beginPath();
          ctx.moveTo(tailX, tailY);
          ctx.lineTo(headX, headY);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.translate(headX, headY);
          square(0, 0, escalated ? 9 : 6, !blocked && !escalated);
        }
        ctx.restore();
      }

      for (const node of nodes) {
        const position = positions.get(node.pseudonym);
        if (!position) continue;
        const isSelected = node.pseudonym === selectedRef.current;
        const isHover = node.pseudonym === hover;
        const state = nodeState(node);
        const riskStroke =
          node.risk === "critical"
            ? "#d8d8d8"
            : node.risk === "high"
              ? "#a8a8a8"
              : node.risk === "medium"
                ? "#6f6f6f"
                : "#4a4a4a";

        ctx.save();
        ctx.setLineDash(state === "deny" || state === "rejected" ? [3, 3] : []);
        ctx.strokeStyle = isSelected ? "#ffffff" : isHover ? "#e8e8e8" : riskStroke;
        ctx.lineWidth = isSelected || isHover ? 2 : node.risk === "high" || node.risk === "critical" ? 2 : 1;
        square(position.x, position.y, position.size, false);
        ctx.setLineDash([]);
        if (state === "allow") {
          ctx.fillStyle = isSelected ? "#ffffff" : "rgba(255,255,255,0.75)";
          square(position.x, position.y, 4, true);
        } else if (state === "escalate") {
          ctx.strokeStyle = isSelected ? "#ffffff" : "#8a8a8a";
          ctx.lineWidth = 1;
          square(position.x, position.y, Math.max(6, position.size - 8), false);
        } else {
          ctx.fillStyle = isSelected ? "#ffffff" : "#8a8a8a";
          ctx.fillRect(position.x - 1, position.y - 1, 2, 2);
        }
        if (isSelected || isHover) {
          ctx.fillStyle = "rgba(255,255,255,0.7)";
          ctx.fillText(node.pseudonym.slice(0, 8), position.x, position.y + position.size / 2 + 12);
        }
        ctx.restore();
      }

      raf = requestAnimationFrame(frame);
    };

    const toLocal = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const onMove = (event: MouseEvent) => {
      const { x, y } = toLocal(event);
      const found = hit.find(
        (item) => Math.abs(x - item.x) < item.size / 2 + 8 && Math.abs(y - item.y) < item.size / 2 + 8,
      );
      hover = found ? found.pseudonym : null;
      canvas.style.cursor = hover ? "pointer" : "default";
    };

    const onClick = (event: MouseEvent) => {
      const { x, y } = toLocal(event);
      const found = hit.find(
        (item) => Math.abs(x - item.x) < item.size / 2 + 10 && Math.abs(y - item.y) < item.size / 2 + 10,
      );
      onSelectRef.current(found ? found.pseudonym : null);
    };

    resize();
    raf = requestAnimationFrame(frame);
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("click", onClick);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("click", onClick);
    };
  }, []);

  return <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />;
}
