"use client";

import { useEffect, useRef } from "react";
import type { NetworkEvent } from "@/lib/api";
import { SERVICES, serviceFor } from "./topology";

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
  serviceId: string;
  start: number;
  duration: number;
}

const PULSE_MS = 1200;
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
  emptyLabel,
}: {
  events: NetworkEvent[];
  selected: string | null;
  onSelect: (pseudonym: string | null) => void;
  emptyLabel?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const emptyRef = useRef(emptyLabel ?? "");
  emptyRef.current = emptyLabel ?? "";

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
    // One live signal per agent: a fresh event for an agent restarts its dot
    // instead of stacking, so a burst reads as one signal per rail.
    const pulses = new Map<string, Pulse>();
    const serviceGlow = new Map<string, number>();
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

    // Two-leg path: agent (ax,ay) → gateway (gx,gy) → service (sx,sy).
    // Blocked outcomes never leave the gateway: t maps onto the first leg.
    const pathPoint = (
      ax: number,
      ay: number,
      gx: number,
      gy: number,
      sx: number,
      sy: number,
      t: number,
      blocked: boolean,
    ): { x: number; y: number } => {
      if (blocked) {
        const c = Math.min(t, 0.58);
        return { x: ax + (gx - ax) * c, y: ay + (gy - ay) * c };
      }
      if (t <= 0.45) {
        const k = t / 0.45;
        return { x: ax + (gx - ax) * k, y: ay + (gy - ay) * k };
      }
      const k = (t - 0.45) / 0.55;
      return { x: gx + (sx - gx) * k, y: gy + (sy - gy) * k };
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
            pulses.set(event.agent_pseudonym, {
              id: event.id,
              pseudonym: event.agent_pseudonym,
              actionClass: event.action_class,
              eventType: event.event_type,
              outcome: event.outcome,
              risk: event.risk_class,
              serviceId: serviceFor(event),
              start: now,
              duration: PULSE_MS,
            });
          }
        }
      }

      for (const [key, pulse] of pulses) {
        if (now - pulse.start >= pulse.duration) pulses.delete(key);
      }
      for (const [id, until] of serviceGlow) {
        if (now > until) serviceGlow.delete(id);
      }

      const nodes = buildNodes(all);
      const gx = w * 0.5;
      const gy = h / 2;
      const ax = Math.max(w * 0.2, 90);
      const sx = Math.min(w * 0.82, w - 70);

      // Vertical stacks, centered.
      const agentGap = nodes.length <= 1 ? 0 : Math.min(42, (h - 150) / Math.max(nodes.length - 1, 1));
      const agentTop = gy - (agentGap * Math.max(nodes.length - 1, 0)) / 2;
      const svcGap = Math.min(46, (h - 150) / Math.max(SERVICES.length - 1, 1));
      const svcTop = gy - (svcGap * (SERVICES.length - 1)) / 2;

      const agentPos = new Map<string, { x: number; y: number; size: number }>();
      hit = [];
      nodes.forEach((node, index) => {
        const y = nodes.length === 1 ? gy : agentTop + index * agentGap;
        const size = 13 + Math.min(node.count, 24) * 0.55;
        agentPos.set(node.pseudonym, { x: ax, y, size });
        hit.push({ pseudonym: node.pseudonym, x: ax, y, size });
      });
      const svcPos = new Map<string, { x: number; y: number }>();
      SERVICES.forEach((svc, index) => {
        svcPos.set(svc.id, { x: sx, y: svcTop + index * svcGap });
      });

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);

      ctx.font = "9px ui-monospace, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      if (nodes.length === 0) {
        ctx.fillStyle = "rgba(255,255,255,0.34)";
        ctx.fillText(
          emptyRef.current || "NO AGENTS IN VIEW — TRY GLOBAL",
          gx,
          gy,
        );
        raf = requestAnimationFrame(frame);
        return;
      }

      // Column headers.
      ctx.fillStyle = "rgba(255,255,255,0.34)";
      ctx.fillText(`AGENTS · ${nodes.length}`, ax, 22);
      ctx.fillText(`SERVICES · ${SERVICES.length}`, sx, 22);

      // Static rails: agents → gateway, gateway → services.
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath();
      for (const node of nodes) {
        const p = agentPos.get(node.pseudonym);
        if (!p) continue;
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(gx, gy);
      }
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.11)";
      ctx.beginPath();
      for (const svc of SERVICES) {
        const p = svcPos.get(svc.id);
        if (!p) continue;
        ctx.moveTo(gx, gy);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();

      // Gateway.
      ctx.strokeStyle = "#c9c9c9";
      ctx.lineWidth = 1;
      square(gx, gy, 30, false);
      ctx.fillStyle = "#c9c9c9";
      square(gx, gy, 8, true);
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillText("GATEWAY", gx, gy + 28);

      // Signals: one small dot traveling the rail, nothing else. No tails,
      // no labels — the feed below says what flowed; the canvas just moves.
      for (const pulse of pulses.values()) {
        const a = agentPos.get(pulse.pseudonym);
        const s = svcPos.get(pulse.serviceId);
        if (!a || !s) continue;
        const t = Math.min(1, (now - pulse.start) / pulse.duration);
        const blocked = BLOCKED.has(pulse.outcome);
        const head = pathPoint(a.x, a.y, gx, gy, s.x, s.y, t, blocked);
        const fade = blocked ? Math.max(0, 1 - Math.max(0, t - 0.58) / 0.42) : 1 - t * 0.5;
        const escalated = pulse.outcome === "escalate" || pulse.outcome === "escalated";
        if (!blocked && t > 0.85) serviceGlow.set(pulse.serviceId, now + 900);

        ctx.save();
        ctx.globalAlpha = Math.max(0.2, fade);
        if (blocked) {
          ctx.fillStyle = "#8a8a8a";
          square(head.x, head.y, 3, true);
        } else if (escalated) {
          ctx.strokeStyle = "#e8e8e8";
          ctx.lineWidth = 1;
          square(head.x, head.y, 6, false);
        } else {
          ctx.fillStyle = "#e8e8e8";
          square(head.x, head.y, 4, true);
        }
        ctx.restore();
      }

      // Service nodes (right column).
      for (const svc of SERVICES) {
        const p = svcPos.get(svc.id);
        if (!p) continue;
        const active = serviceGlow.has(svc.id);
        ctx.save();
        ctx.strokeStyle = active ? "#ffffff" : "#6f6f6f";
        ctx.lineWidth = active ? 2 : 1;
        square(p.x, p.y, 20, false);
        if (active) {
          ctx.fillStyle = "rgba(255,255,255,0.8)";
          square(p.x, p.y, 4, true);
        }
        ctx.fillStyle = active ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.4)";
        ctx.fillText(svc.label, p.x, p.y + 20);
        ctx.restore();
      }

      // Agent nodes (left column).
      ctx.textAlign = "center";
      for (const node of nodes) {
        const position = agentPos.get(node.pseudonym);
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
