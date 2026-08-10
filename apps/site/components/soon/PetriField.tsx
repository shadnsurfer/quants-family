"use client";

/**
 * The living dish: a full-bleed generative canvas behind the incubation page.
 * Ink-outlined organisms drift, wobble, and occasionally divide in a flash of
 * acid; plankton motes drift underneath for depth. The cursor disturbs the
 * culture. Dependency-free, DPR-aware, honors prefers-reduced-motion with a
 * single still frame. Palette is read from the design tokens at runtime.
 */
import { useEffect, useRef } from "react";

interface Organism {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  seed: number;
  acid: boolean;
  born: number; // seconds
  life: number; // seconds
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

interface Pulse {
  x: number;
  y: number;
  born: number;
}

const FADE = 1.6; // seconds to grow in / die out
const MAX_ORGANISMS = 24;

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function spawn(w: number, h: number, t: number, r?: number): Organism {
  const a = rand(0, Math.PI * 2);
  return {
    x: rand(0, w),
    y: rand(0, h),
    vx: Math.cos(a) * rand(4, 12),
    vy: Math.sin(a) * rand(4, 12),
    r: r ?? rand(9, 30),
    seed: rand(0, 1000),
    acid: Math.random() < 0.18,
    born: t,
    life: rand(18, 42),
  };
}

/** closed wobbling blob path through N perturbed points, quadratic-smoothed */
function traceBlob(
  ctx: CanvasRenderingContext2D,
  o: Organism,
  t: number,
) {
  const N = 9;
  const pts: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const wob =
      1 +
      0.16 * Math.sin(a * 3 + t * 0.9 + o.seed) +
      0.09 * Math.sin(a * 5 - t * 0.6 + o.seed * 1.7);
    pts.push([o.x + Math.cos(a) * o.r * wob, o.y + Math.sin(a) * o.r * wob]);
  }
  ctx.beginPath();
  ctx.moveTo((pts[0][0] + pts[N - 1][0]) / 2, (pts[0][1] + pts[N - 1][1]) / 2);
  for (let i = 0; i < N; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % N];
    ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  }
  ctx.closePath();
}

export function PetriField({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const css = getComputedStyle(document.documentElement);
    const INK = css.getPropertyValue("--ink").trim() || "#111311";
    const ACID = css.getPropertyValue("--accent").trim() || "#ccff00";
    const FAINT = css.getPropertyValue("--faint").trim() || "#979c90";

    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    let organisms: Organism[] = [];
    let motes: Mote[] = [];
    let pulses: Pulse[] = [];
    let nextSplit = 5;
    const mouse = { x: -9999, y: -9999 };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const seedWorld = (t: number) => {
      const target = Math.max(9, Math.min(16, Math.round((w * h) / 110000)));
      organisms = Array.from({ length: target }, () => {
        const o = spawn(w, h, t);
        o.born = t - rand(0, o.life * 0.6); // pre-aged so the dish opens mid-culture
        return o;
      });
      motes = Array.from({ length: Math.round((w * h) / 26000) }, () => ({
        x: rand(0, w),
        y: rand(0, h),
        vx: rand(-3, 3),
        vy: rand(-3, 3),
        r: rand(0.7, 1.7),
      }));
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seedWorld(performance.now() / 1000);
    };

    const step = (t: number, dt: number) => {
      // drift + cursor disturbance + soft wrap
      for (const o of organisms) {
        o.x += o.vx * dt;
        o.y += o.vy * dt;
        const dx = o.x - mouse.x;
        const dy = o.y - mouse.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 150 * 150 && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const f = ((150 - d) / 150) * 34 * dt;
          o.x += (dx / d) * f;
          o.y += (dy / d) * f;
        }
        const m = o.r + 30;
        if (o.x < -m) o.x = w + m;
        if (o.x > w + m) o.x = -m;
        if (o.y < -m) o.y = h + m;
        if (o.y > h + m) o.y = -m;
      }
      for (const mo of motes) {
        mo.x = (mo.x + mo.vx * dt + w) % w;
        mo.y = (mo.y + mo.vy * dt + h) % h;
      }
      // division: an adult splits into two, leaving an acid pulse
      if (t > nextSplit && organisms.length < MAX_ORGANISMS) {
        const adults = organisms.filter((o) => o.r > 15 && t - o.born > 4);
        if (adults.length > 0) {
          const parent = adults[Math.floor(Math.random() * adults.length)];
          pulses.push({ x: parent.x, y: parent.y, born: t });
          organisms = organisms.filter((o) => o !== parent);
          for (const s of [-1, 1]) {
            const child = spawn(w, h, t, parent.r * 0.62);
            child.x = parent.x + s * parent.r * 0.8;
            child.y = parent.y + rand(-6, 6);
            child.acid = parent.acid ? Math.random() < 0.5 : Math.random() < 0.12;
            organisms.push(child);
          }
        }
        nextSplit = t + rand(3.5, 7.5);
      }
      // death: fade out, reseed at the edge of the dish
      const survivors: Organism[] = [];
      for (const o of organisms) {
        if (t - o.born > o.life && organisms.length > 10) {
          if (t - o.born > o.life + FADE) continue; // fully faded — drop
        }
        survivors.push(o);
      }
      if (survivors.length < 10) survivors.push(spawn(w, h, t));
      organisms = survivors;
      pulses = pulses.filter((p) => t - p.born < 0.9);
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      // plankton
      ctx.fillStyle = FAINT;
      for (const mo of motes) {
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(mo.x, mo.y, mo.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // division pulses: expanding acid rings
      for (const p of pulses) {
        const k = (t - p.born) / 0.9;
        ctx.globalAlpha = (1 - k) * 0.8;
        ctx.strokeStyle = ACID;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8 + k * 44, 0, Math.PI * 2);
        ctx.stroke();
      }
      // organisms
      for (const o of organisms) {
        const age = t - o.born;
        const grow = Math.min(1, age / FADE);
        const dying = Math.max(0, Math.min(1, (age - o.life) / FADE));
        const alpha = grow * (1 - dying);
        if (alpha <= 0) continue;
        traceBlob(ctx, o, t);
        if (o.acid) {
          ctx.globalAlpha = alpha * 0.9;
          ctx.fillStyle = ACID;
          ctx.fill();
        }
        ctx.globalAlpha = alpha * 0.55;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    if (reduced) {
      draw(performance.now() / 1000); // one still frame, no loop
    } else {
      let last = performance.now() / 1000;
      const loop = () => {
        const t = performance.now() / 1000;
        const dt = Math.min(0.05, t - last);
        last = t;
        step(t, dt);
        draw(t);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    };
    const onLeave = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
}
