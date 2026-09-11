"use client";

import { useEffect, useRef } from "react";

// "Inside the cube" backdrop — outlined squares drift outward from the
// center toward the viewer (tunnel feel), growing and fading as they
// approach. Slow, dim, monochrome; edges are masked to black by the
// parent so copy stays legible. Pauses offscreen, single static frame
// for prefers-reduced-motion.
type P = {
  ang: number;
  r: number;
  speed: number;
  drift: number;
  maxO: number;
  seed: number;
};

export default function CloserCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    let running = true;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);

    let parts: P[] = [];
    const seed = () => {
      const count = Math.max(28, Math.min(70, Math.floor((w * h) / 22000)));
      parts = Array.from({ length: count }, () => ({
        ang: Math.random() * Math.PI * 2,
        r: Math.random(),
        speed: rnd(0.00012, 0.0004),
        drift: rnd(-0.00012, 0.00012),
        maxO: rnd(0.08, 0.3),
        seed: Math.random() * Math.PI * 2,
      }));
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };

    const draw = (t: number) => {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h * 0.46;
      const maxR = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
      ctx.lineWidth = 1;
      for (const p of parts) {
        const breathe = 0.85 + 0.15 * Math.sin(t * 0.0004 + p.seed);
        const x = cx + Math.cos(p.ang) * p.r * maxR;
        const y = cy + Math.sin(p.ang) * p.r * maxR;
        const s = (3 + p.r * 22) * breathe;
        const o = Math.sin(Math.PI * Math.min(1, p.r)) * p.maxO;
        if (o <= 0.004) continue;
        ctx.strokeStyle = `rgba(255,255,255,${o.toFixed(3)})`;
        ctx.strokeRect(x - s / 2, y - s / 2, s, s);
        if (p.r > 0.72) {
          ctx.fillStyle = `rgba(255,255,255,${(o * 0.8).toFixed(3)})`;
          ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
        }
      }
    };

    const frame = (t: number) => {
      if (!running) return;
      for (const p of parts) {
        p.r += p.speed * 16.7;
        p.ang += p.drift * 16.7;
        if (p.r > 1) {
          p.r = 0.02;
          p.ang = Math.random() * Math.PI * 2;
        }
      }
      draw(t);
      raf = requestAnimationFrame(frame);
    };

    resize();
    if (reduced) {
      draw(2000);
    } else {
      raf = requestAnimationFrame(frame);
    }

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      if (reduced) return;
      if (e.isIntersecting && !running) {
        running = true;
        raf = requestAnimationFrame(frame);
      } else if (!e.isIntersecting && running) {
        running = false;
        cancelAnimationFrame(raf);
      }
    });
    io.observe(canvas);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  );
}
