"use client";

import { useEffect, useRef } from "react";

type Node = {
  hx: number;
  hy: number;
  ph: number;
  sp: number;
  amp: number;
};

type Edge = { a: number; b: number };

type Pulse = {
  edge: number;
  t: number;
  speed: number;
};

const CELL = 86;
const JITTER = 24;

export default function NetworkCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let nodes: Node[] = [];
    let edges: Edge[] = [];
    let pulses: Pulse[] = [];
    let raf = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;

    const build = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);

      nodes = [];
      edges = [];
      pulses = [];

      const cols = Math.ceil(w / CELL) + 2;
      const rows = Math.ceil(h / CELL) + 2;
      const at = (c: number, r: number) => r * cols + c;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          nodes.push({
            hx: c * CELL + (Math.random() - 0.5) * 2 * JITTER,
            hy: r * CELL + (Math.random() - 0.5) * 2 * JITTER,
            ph: Math.random() * Math.PI * 2,
            sp: 0.00025 + Math.random() * 0.00045,
            amp: 6 + Math.random() * 9,
          });
        }
      }

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (c + 1 < cols && Math.random() < 0.88)
            edges.push({ a: at(c, r), b: at(c + 1, r) });
          if (r + 1 < rows && Math.random() < 0.88)
            edges.push({ a: at(c, r), b: at(c, r + 1) });
          if (c + 1 < cols && r + 1 < rows && Math.random() < 0.32)
            edges.push({ a: at(c, r), b: at(c + 1, r + 1) });
          if (c - 1 >= 0 && r + 1 < rows && Math.random() < 0.32)
            edges.push({ a: at(c, r), b: at(c - 1, r + 1) });
        }
      }
    };

    const pos = (n: Node, t: number): [number, number] => [
      n.hx + Math.sin(t * n.sp + n.ph) * n.amp + Math.sin(t * 0.00011 + n.ph * 2.3) * 5,
      n.hy + Math.cos(t * n.sp * 0.83 + n.ph * 1.7) * n.amp * 0.8,
    ];

    const frame = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);

      const px = new Float32Array(nodes.length);
      const py = new Float32Array(nodes.length);
      for (let i = 0; i < nodes.length; i++) {
        const [x, y] = pos(nodes[i], t);
        px[i] = x;
        py[i] = y;
      }

      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.09)";
      ctx.beginPath();
      for (const e of edges) {
        ctx.moveTo(px[e.a], py[e.a]);
        ctx.lineTo(px[e.b], py[e.b]);
      }
      ctx.stroke();

      if (pulses.length < 7 && Math.random() < 0.03) {
        pulses.push({
          edge: Math.floor(Math.random() * edges.length),
          t: 0,
          speed: 0.0007 + Math.random() * 0.0011,
        });
      }
      pulses = pulses.filter((p) => p.t <= 1);
      const lit = new Set<number>();
      for (const p of pulses) {
        p.t += p.speed * 16.7;
        const e = edges[p.edge];
        const a = [px[e.a], py[e.a]];
        const b = [px[e.b], py[e.b]];
        const t0 = Math.max(0, p.t - 0.35);
        const t1 = Math.min(1, p.t + 0.05);
        const x0 = a[0] + (b[0] - a[0]) * t0;
        const y0 = a[1] + (b[1] - a[1]) * t0;
        const x1 = a[0] + (b[0] - a[0]) * t1;
        const y1 = a[1] + (b[1] - a[1]) * t1;
        const g = ctx.createLinearGradient(x0, y0, x1, y1);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(0.5, "rgba(255,255,255,0.85)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = g;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        lit.add(e.a);
        lit.add(e.b);
      }

      ctx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        const s = 9;
        const isLit = lit.has(i);
        ctx.strokeStyle = isLit ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.45)";
        ctx.strokeRect(px[i] - s / 2, py[i] - s / 2, s, s);
        if (isLit) {
          ctx.fillStyle = "rgba(255,255,255,0.9)";
          ctx.fillRect(px[i] - 2, py[i] - 2, 4, 4);
        }
      }

      raf = requestAnimationFrame(frame);
    };

    build();
    raf = requestAnimationFrame(frame);

    const ro = new ResizeObserver(build);
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  );
}
