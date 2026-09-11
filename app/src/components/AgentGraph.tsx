"use client";

import { useEffect, useRef } from "react";
import type { Agent } from "@/data/agents";

type Pulse = { edge: number; t: number; speed: number };

// Interactive square-agent graph. Visual language mirrors NetworkCanvas
// (landing): outlined squares, faint links, traveling pulses — but every
// node here is a real directory entry, positioned deterministically so
// selection/hit-testing stays stable across frames.
export default function AgentGraph({
  agents,
  selectedId,
  onSelect,
}: {
  agents: Agent[];
  selectedId: number;
  onSelect: (id: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const geomRef = useRef<{ x: number; y: number; s: number; id: number }[]>([]);
  const selRef = useRef(selectedId);
  selRef.current = selectedId;
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
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
    let pulses: Pulse[] = [];
    let hover = -1;

    // Deterministic ring layout with slight per-id jitter.
    const layout = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h) / 2 - 56;
      geomRef.current = agentsRef.current.map((a, i) => {
        const ang = (i / agentsRef.current.length) * Math.PI * 2 - Math.PI / 2;
        const jx = (((a.registryId * 7919) % 37) - 18) * 0.9;
        const jy = (((a.registryId * 104729) % 41) - 20) * 0.9;
        const s = 14 + a.reputation * 12;
        return {
          x: cx + Math.cos(ang) * R * 0.92 + jx,
          y: cy + Math.sin(ang) * R * 0.82 + jy,
          s,
          id: a.registryId,
        };
      });
    };

    // Ring edges + a few cross-links for the mesh feel.
    const edges = (): [number, number][] => {
      const n = agentsRef.current.length;
      const list: [number, number][] = [];
      for (let i = 0; i < n; i++) list.push([i, (i + 1) % n]);
      for (let i = 0; i < n; i += 3) list.push([i, (i + 4) % n]);
      return list;
    };

    const statusColor = (a: Agent, lit: boolean) => {
      if (lit) return "rgba(255,255,255,0.95)";
      if (a.status === "online") return "rgba(255,255,255,0.6)";
      if (a.status === "idle") return "rgba(255,255,255,0.32)";
      return "rgba(255,255,255,0.18)";
    };

    const frame = () => {
      const list = agentsRef.current;
      const g = geomRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);

      const E = edges();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.09)";
      ctx.beginPath();
      for (const [ai, bi] of E) {
        if (!g[ai] || !g[bi]) continue;
        ctx.moveTo(g[ai].x, g[ai].y);
        ctx.lineTo(g[bi].x, g[bi].y);
      }
      ctx.stroke();

      if (pulses.length < 6 && Math.random() < 0.035) {
        pulses.push({
          edge: Math.floor(Math.random() * E.length),
          t: 0,
          speed: 0.0007 + Math.random() * 0.0011,
        });
      }
      pulses = pulses.filter((p) => p.t <= 1);
      const lit = new Set<number>();
      for (const p of pulses) {
        p.t += p.speed * 16.7;
        const [ai, bi] = E[p.edge % E.length];
        if (!g[ai] || !g[bi]) continue;
        const t0 = Math.max(0, p.t - 0.3);
        const t1 = Math.min(1, p.t + 0.05);
        const x0 = g[ai].x + (g[bi].x - g[ai].x) * t0;
        const y0 = g[ai].y + (g[bi].y - g[ai].y) * t0;
        const x1 = g[ai].x + (g[bi].x - g[ai].x) * t1;
        const y1 = g[ai].y + (g[bi].y - g[ai].y) * t1;
        const grad = ctx.createLinearGradient(x0, y0, x1, y1);
        grad.addColorStop(0, "rgba(255,255,255,0)");
        grad.addColorStop(0.5, "rgba(255,255,255,0.8)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        lit.add(ai);
        lit.add(bi);
      }

      ctx.textAlign = "center";
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        const p = g[i];
        if (!p) continue;
        const selected = a.registryId === selRef.current;
        const hov = i === hover;
        const isLit = lit.has(i);
        ctx.lineWidth = selected || hov ? 2 : 1;
        ctx.strokeStyle = selected
          ? "#fff"
          : hov
            ? "rgba(255,255,255,0.9)"
            : statusColor(a, isLit);
        ctx.strokeRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
        if (selected || isLit) {
          ctx.fillStyle = selected
            ? "rgba(255,255,255,0.95)"
            : "rgba(255,255,255,0.7)";
          ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
        }
        ctx.font = "10px ui-monospace, Menlo, monospace";
        ctx.fillStyle = selected
          ? "rgba(255,255,255,0.9)"
          : "rgba(255,255,255,0.38)";
        ctx.fillText(`#${a.registryId}`, p.x, p.y + p.s / 2 + 16);
      }

      raf = requestAnimationFrame(frame);
    };

    const toLocal = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onMove = (e: MouseEvent) => {
      const { x, y } = toLocal(e);
      hover = geomRef.current.findIndex(
        (p) => Math.abs(x - p.x) < p.s / 2 + 8 && Math.abs(y - p.y) < p.s / 2 + 8
      );
      canvas.style.cursor = hover >= 0 ? "pointer" : "default";
    };

    const onClick = (e: MouseEvent) => {
      const { x, y } = toLocal(e);
      const hit = geomRef.current.find(
        (p) => Math.abs(x - p.x) < p.s / 2 + 10 && Math.abs(y - p.y) < p.s / 2 + 10
      );
      if (hit) onSelectRef.current(hit.id);
    };

    layout();
    raf = requestAnimationFrame(frame);
    const ro = new ResizeObserver(layout);
    ro.observe(canvas);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("click", onClick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  );
}
