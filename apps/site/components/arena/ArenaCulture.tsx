"use client";

/**
 * The arena dish: every quant an organism in one living culture. Organisms
 * drift, hover-readable; a birth buds off the parent with an acid pulse; a
 * death flashes red, flatlines to ×, and sinks into the sediment. Pan with
 * drag, zoom with scroll, click through to the quant's file.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fmtPct, fmtUsd, hpOf, pnlPct, type World, type WorldQuant } from "@/lib/world";

const W = 1600;
const H = 1000;
const DISH = { cx: W / 2, cy: H / 2, rx: 690, ry: 410 };
const MIN_S = 0.2;
const MAX_S = 2.2;

const INK = "#111311";
const DOWN = "#d43d1f";
const AMBER = "#a17305";
const ACCENT = "#ccff00";
const FAINT = "#979c90";
const SOFTRULE = "#e3e3da";

/** hex #rrggbb + alpha → #rrggbbaa */
const aa = (hex: string, a: number) =>
  `${hex}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0")}`;

interface Org {
  id: string;
  name: string;
  ticker: string;
  gen: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hp: number;
  pnl: number;
  equity: number;
  fitness: number | null;
  dead: boolean;
  cause: string | null;
  sport: boolean;
  settled: boolean;
  sinkOffset: number;
  bornAnim: number | null;
  deathAnim: number | null;
  parents: string[];
}

interface View {
  tx: number;
  ty: number;
  s: number;
}

const hash01 = (s: string, salt: number) => {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
};

const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export function ArenaCulture({ world }: { world: World }) {
  const router = useRouter();
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<View>({ tx: 0, ty: 0, s: 0.7 });
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const worldRef = useRef(world);
  worldRef.current = world;
  const orgsRef = useRef<Map<string, Org>>(new Map());
  const engineRef = useRef<{ draw: () => void; fit: () => void; sync: () => void } | null>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fontStack = getComputedStyle(document.body).fontFamily;

    // theme from the scoped design tokens — the dish follows the room it's in
    const cs = getComputedStyle(frame);
    const css = (v: string, fb: string) => cs.getPropertyValue(v).trim() || fb;
    const C = {
      paper: css("--paper", "#fdfdfb"),
      panel: css("--panel", "#ffffff"),
      ink: css("--ink", INK),
      dim: css("--dim", "#565b53"),
      faint: css("--faint", FAINT),
      softrule: css("--softrule", SOFTRULE),
      up: css("--up", "#14803c"),
      down: css("--down", DOWN),
      amber: css("--amber", AMBER),
      accent: css("--accent", ACCENT),
    };

    let dpr = 1;
    let raf = 0;
    let firstSync = true;

    const orgs = orgsRef.current;

    const resize = () => {
      const rect = frame.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const nw = Math.max(1, Math.round(rect.width * dpr));
      const nh = Math.max(1, Math.round(rect.height * dpr));
      if (nw !== canvas.width || nh !== canvas.height) {
        canvas.width = nw;
        canvas.height = nh;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const fit = () => {
      const rect = frame.getBoundingClientRect();
      const s = Math.min(MAX_S, Math.max(MIN_S, Math.min(rect.width / W, rect.height / H) * 0.98));
      setView({ tx: (rect.width - W * s) / 2, ty: (rect.height - H * s) / 2, s });
    };

    const spawnOrg = (q: WorldQuant, now: number, animate: boolean): Org => {
      const h1 = hash01(q.id, 7);
      const h2 = hash01(q.id, 13);
      const parent = q.parents.length > 0 ? orgs.get(q.parents[0]) : undefined;
      let x: number;
      let y: number;
      if (parent) {
        // born of an organism: bud off the parent's flank
        const a = h1 * Math.PI * 2;
        x = parent.x + Math.cos(a) * (parent.r + 26);
        y = parent.y + Math.sin(a) * (parent.r + 26);
      } else {
        const a = h1 * Math.PI * 2;
        const rr = Math.sqrt(h2) * 0.72;
        x = DISH.cx + Math.cos(a) * rr * DISH.rx;
        y = DISH.cy + Math.sin(a) * rr * DISH.ry;
      }
      const pnl = pnlPct(q);
      return {
        id: q.id,
        name: q.name,
        ticker: q.ticker,
        gen: q.generation,
        x, y,
        vx: (h1 - 0.5) * 8,
        vy: (h2 - 0.5) * 8,
        r: 22 + Math.max(-6, Math.min(12, pnl * 40)),
        hp: hpOf(q),
        pnl,
        equity: q.equityUsd,
        fitness: q.fitness,
        dead: q.status === "dead",
        cause: q.causeOfDeath,
        sport: false,
        settled: q.status === "dead",
        sinkOffset: hash01(q.id, 29) * 80 - 40,
        bornAnim: animate ? now : null,
        deathAnim: null,
        parents: q.parents,
      };
    };

    const reconcile = (now: number) => {
      const w = worldRef.current;
      const sports = new Set(
        w.events.filter((e) => e.kind === "birth" && /SPORT/i.test(e.detail)).map((e) => e.quantId),
      );
      const seen = new Set<string>();
      for (const q of w.quants) {
        seen.add(q.id);
        let o = orgs.get(q.id);
        if (!o) {
          o = spawnOrg(q, now, !firstSync);
          orgs.set(q.id, o);
        }
        o.hp = hpOf(q);
        o.pnl = pnlPct(q);
        o.equity = q.equityUsd;
        o.fitness = q.fitness;
        o.sport = sports.has(q.id);
        o.r = 22 + Math.max(-6, Math.min(12, o.pnl * 40));
        const dead = q.status === "dead";
        if (dead && !o.dead) {
          o.dead = true;
          o.deathAnim = now;
          o.settled = false;
        }
        o.cause = q.causeOfDeath;
      }
      for (const id of [...orgs.keys()]) {
        if (!seen.has(id)) orgs.delete(id);
      }
      firstSync = false;
    };

    const step = (dt: number) => {
      const list = [...orgs.values()];
      for (const o of list) {
        if (o.dead) {
          if (!o.settled) {
            // the dead settle into the sediment at the dish floor
            o.vy += 30 * dt;
            o.vx *= 0.97;
            o.x += o.vx * dt;
            o.y += o.vy * dt;
            const floor = DISH.cy + DISH.ry * 0.86 + o.sinkOffset * 0.3;
            if (o.y >= floor - o.r) {
              o.y = floor - o.r;
              o.vx = 0;
              o.vy = 0;
              o.settled = true;
            }
          }
          continue;
        }
        o.vx += (Math.random() - 0.5) * 26 * dt;
        o.vy += (Math.random() - 0.5) * 26 * dt;
        const sp = Math.hypot(o.vx, o.vy) || 1;
        const max = 15;
        if (sp > max) {
          o.vx = (o.vx / sp) * max;
          o.vy = (o.vy / sp) * max;
        }
        o.x += o.vx * dt;
        o.y += o.vy * dt;
        // soft containment in the dish ellipse
        const nx = (o.x - DISH.cx) / (DISH.rx * 0.92);
        const ny = (o.y - DISH.cy) / (DISH.ry * 0.92);
        const d = nx * nx + ny * ny;
        if (d > 1) {
          o.vx -= nx * 60 * dt;
          o.vy -= ny * 60 * dt;
        }
      }
      // gentle repulsion among the living
      const alive = list.filter((o) => !o.dead);
      for (let i = 0; i < alive.length; i++) {
        for (let j = i + 1; j < alive.length; j++) {
          const a = alive[i];
          const b = alive[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 1;
          const min = a.r + b.r + 46;
          if (dist < min) {
            const push = ((min - dist) / min) * 26 * dt;
            const ux = dx / dist;
            const uy = dy / dist;
            a.vx -= ux * push;
            a.vy -= uy * push;
            b.vx += ux * push;
            b.vy += uy * push;
          }
        }
      }
    };

    const drawOrg = (o: Org, now: number) => {
      let scale = 1;
      let alpha = o.dead ? 0.45 : 1;
      if (o.bornAnim !== null) {
        const t = Math.min(1, (now - o.bornAnim) / 1400);
        scale = easeOutBack(t);
        if (t >= 1) o.bornAnim = null;
        else {
          // the acid pulse of a birth
          ctx.beginPath();
          ctx.arc(o.x, o.y, o.r + t * 80, 0, Math.PI * 2);
          ctx.strokeStyle = C.accent;
          ctx.globalAlpha = (1 - t) * 0.95;
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      if (o.deathAnim !== null) {
        const t = Math.min(1, (now - o.deathAnim) / 900);
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r + t * 54, 0, Math.PI * 2);
        ctx.strokeStyle = C.down;
        ctx.globalAlpha = (1 - t) * 0.9;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (t >= 1) o.deathAnim = null;
      }

      const r = Math.max(0.1, o.r * scale);
      ctx.globalAlpha = alpha;

      // hp track + arc
      if (!o.dead) {
        ctx.beginPath();
        ctx.arc(o.x, o.y, r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = C.softrule;
        ctx.lineWidth = 2;
        ctx.stroke();
        if (o.hp > 0.01) {
          ctx.beginPath();
          ctx.arc(o.x, o.y, r + 5, -Math.PI / 2, -Math.PI / 2 + o.hp * Math.PI * 2);
          ctx.strokeStyle = o.hp < 0.4 ? C.down : C.accent;
          ctx.lineWidth = 3.5;
          ctx.stroke();
        }
      }

      // body — ink ring on paper, acid held for the nucleus
      ctx.beginPath();
      ctx.arc(o.x, o.y, r, 0, Math.PI * 2);
      ctx.fillStyle = o.dead ? C.panel : "#ffffff";
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = o.dead ? C.faint : C.ink;
      ctx.stroke();

      if (o.sport && !o.dead) {
        ctx.beginPath();
        ctx.setLineDash([4, 5]);
        ctx.arc(o.x, o.y, r + 10, 0, Math.PI * 2);
        ctx.strokeStyle = C.amber;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (o.dead) {
        // flatline ×
        ctx.beginPath();
        ctx.moveTo(o.x - r * 0.34, o.y - r * 0.34);
        ctx.lineTo(o.x + r * 0.34, o.y + r * 0.34);
        ctx.moveTo(o.x + r * 0.34, o.y - r * 0.34);
        ctx.lineTo(o.x - r * 0.34, o.y + r * 0.34);
        ctx.strokeStyle = C.faint;
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        // nucleus
        ctx.beginPath();
        ctx.arc(o.x, o.y, Math.max(2.5, r * 0.16), 0, Math.PI * 2);
        ctx.fillStyle = C.accent;
        ctx.fill();
      }

      // labels
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.font = `500 14px ${fontStack}`;
      ctx.fillStyle = o.dead ? C.faint : C.ink;
      const nameY = o.y + r + 12;
      ctx.fillText(o.name, o.x, nameY);
      if (o.dead) {
        const wName = ctx.measureText(o.name).width;
        ctx.beginPath();
        ctx.moveTo(o.x - wName / 2, nameY + 6.5);
        ctx.lineTo(o.x + wName / 2, nameY + 6.5);
        ctx.strokeStyle = C.faint;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.font = `400 11px ${fontStack}`;
      ctx.fillStyle = o.dead ? C.faint : o.pnl > 0 ? C.up : o.pnl < 0 ? C.down : C.faint;
      ctx.fillText(`$${o.ticker} · ${o.dead ? o.cause ?? "dead" : fmtPct(o.pnl)}`, o.x, nameY + 16);

      ctx.globalAlpha = 1;
    };

    const draw = () => {
      const now = performance.now();
      const { tx, ty, s } = viewRef.current;
      const vw = canvas.width / dpr;
      const vh = canvas.height / dpr;
      ctx.clearRect(0, 0, vw, vh);
      ctx.fillStyle = C.paper;
      ctx.fillRect(0, 0, vw, vh);
      ctx.save();
      ctx.translate(tx, ty);
      ctx.scale(s, s);

      // the culture bloom — a uniform breath of acid inside the dish (no gradient: bands show on near-black)
      ctx.beginPath();
      ctx.ellipse(DISH.cx, DISH.cy, DISH.rx, DISH.ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = aa(C.accent, 0.03);
      ctx.fill();

      // culture-dot grid
      ctx.fillStyle = C.softrule;
      for (let gx = 0; gx <= W; gx += 26) {
        for (let gy = 0; gy <= H; gy += 26) {
          ctx.fillRect(gx, gy, 1.4, 1.4);
        }
      }

      // the dish
      ctx.beginPath();
      ctx.setLineDash([2, 7]);
      ctx.ellipse(DISH.cx, DISH.cy, DISH.rx, DISH.ry, 0, 0, Math.PI * 2);
      ctx.strokeStyle = aa(C.faint, 0.55);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `400 12px ${fontStack}`;
      ctx.fillStyle = aa(C.faint, 0.85);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.fillText("+", DISH.cx + Math.cos(a) * DISH.rx, DISH.cy + Math.sin(a) * DISH.ry);
      }

      // lineage threads
      ctx.lineWidth = 1;
      for (const o of orgs.values()) {
        for (const pid of o.parents) {
          const p = orgs.get(pid);
          if (!p) continue;
          ctx.beginPath();
          ctx.setLineDash([4, 5]);
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(o.x, o.y);
          ctx.strokeStyle = p.dead || o.dead ? aa(C.faint, 0.35) : aa(C.ink, 0.25);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // organisms: dead first so the living float on top
      const list = [...orgs.values()].sort((a, b) => Number(a.dead) - Number(b.dead));
      for (const o of list) drawOrg(o, now);

      ctx.restore();
    };

    const loop = (now: number) => {
      const prev = (loop as unknown as { last?: number }).last ?? now;
      (loop as unknown as { last?: number }).last = now;
      const dt = Math.min(0.05, (now - prev) / 1000);
      reconcile(now);
      step(dt);
      draw();
      raf = requestAnimationFrame(loop);
    };

    resize();
    fit();
    const ro = new ResizeObserver(() => {
      resize();
      if (reduced) draw();
    });
    ro.observe(frame);

    if (reduced) {
      reconcile(performance.now());
      draw();
    } else {
      raf = requestAnimationFrame(loop);
    }

    engineRef.current = { draw, fit, sync: () => { reconcile(performance.now()); draw(); } };
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // reduced-motion has no loop: reconcile + repaint when the polled world lands
  useEffect(() => {
    engineRef.current?.sync();
  }, [world]);

  // redraw on view changes in reduced-motion mode (no loop to do it)
  useEffect(() => {
    engineRef.current?.draw();
  }, [view]);

  const toWorld = (sx: number, sy: number): [number, number] => {
    const { tx, ty, s } = viewRef.current;
    return [(sx - tx) / s, (sy - ty) / s];
  };

  const hitAt = (sx: number, sy: number): Org | null => {
    const [wx, wy] = toWorld(sx, sy);
    let best: Org | null = null;
    let bestD = Infinity;
    for (const o of orgsRef.current.values()) {
      const d = Math.hypot(o.x - wx, o.y - wy);
      if (d < o.r + 14 && d < bestD) {
        best = o;
        bestD = d;
      }
    }
    return best;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (drag.current) {
      setView((v) => ({ ...v, tx: drag.current!.tx + (e.clientX - drag.current!.x), ty: drag.current!.ty + (e.clientY - drag.current!.y) }));
      return;
    }
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    const o = hitAt(e.clientX - rect.left, e.clientY - rect.top);
    if (o) {
      const { tx, ty, s } = viewRef.current;
      setHover({ id: o.id, x: o.x * s + tx, y: (o.y - o.r - 10) * s + ty });
    } else {
      setHover(null);
    }
  };

  const hovered = hover ? orgsRef.current.get(hover.id) ?? null : null;

  return (
    <div
      ref={frameRef}
      className={`relative h-full w-full touch-none select-none overflow-hidden ${hovered ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"}`}
      onPointerMove={onPointerMove}
      onPointerLeave={() => {
        drag.current = null;
        setHover(null);
      }}
      onPointerDown={(e) => {
        if (hitAt(e.clientX - frameRef.current!.getBoundingClientRect().left, e.clientY - frameRef.current!.getBoundingClientRect().top)) return;
        drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      }}
      onPointerUp={(e) => {
        const wasDrag = drag.current && (Math.abs(e.clientX - drag.current.x) > 4 || Math.abs(e.clientY - drag.current.y) > 4);
        drag.current = null;
        if (wasDrag) return;
        // hit-test at release — taps land without a prior hover (touch)
        const rect = frameRef.current?.getBoundingClientRect();
        if (!rect) return;
        const o = hitAt(e.clientX - rect.left, e.clientY - rect.top);
        if (o) router.push(`/q/${encodeURIComponent(o.name)}`);
      }}
      onWheel={(e) => {
        const rect = frameRef.current?.getBoundingClientRect();
        if (!rect) return;
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        setView((v) => {
          const s = Math.min(MAX_S, Math.max(MIN_S, v.s * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
          const k = s / v.s;
          return { s, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k };
        });
      }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />

      {/* zoom controls */}
      <div className="absolute bottom-3 left-3 flex flex-col border border-rule bg-paper text-ink">
        <button
          aria-label="zoom in"
          className="px-2.5 py-1 transition-colors hover:bg-accent hover:text-[var(--on-accent)]"
          onClick={() => {
            const rect = frameRef.current!.getBoundingClientRect();
            const cx = rect.width / 2;
            const cy = rect.height / 2;
            setView((v) => {
              const s = Math.min(MAX_S, v.s * 1.25);
              const k = s / v.s;
              return { s, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k };
            });
          }}
        >
          +
        </button>
        <button
          aria-label="zoom out"
          className="border-t border-rule px-2.5 py-1 transition-colors hover:bg-accent hover:text-[var(--on-accent)]"
          onClick={() => {
            const rect = frameRef.current!.getBoundingClientRect();
            const cx = rect.width / 2;
            const cy = rect.height / 2;
            setView((v) => {
              const s = Math.max(MIN_S, v.s / 1.25);
              const k = s / v.s;
              return { s, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k };
            });
          }}
        >
          −
        </button>
        <button aria-label="fit dish" className="border-t border-rule px-2.5 py-1 text-[12px] transition-colors hover:bg-accent hover:text-[var(--on-accent)]" onClick={() => engineRef.current?.fit()}>
          fit
        </button>
      </div>

      {/* hover card */}
      {hovered ? (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full border border-rule bg-paper px-3 py-2 text-[12px] shadow-[3px_3px_0_0_var(--softrule)]"
          style={{ left: hover!.x, top: hover!.y }}
        >
          <div className="flex items-baseline gap-2">
            <span className={`font-medium ${hovered.dead ? "text-faint line-through" : "text-ink"}`}>{hovered.name}</span>
            <span className="text-dim">${hovered.ticker}</span>
            <span className="text-faint">g{hovered.gen}</span>
          </div>
          <div className="mt-0.5 text-dim">
            f {hovered.fitness === null ? "—" : hovered.fitness.toFixed(3)} · {fmtUsd(hovered.equity)} ·{" "}
            {hovered.dead ? (
              <span className="text-down">{hovered.cause ?? "dead"}</span>
            ) : (
              <span className={hovered.pnl >= 0 ? "text-up" : "text-down"}>{fmtPct(hovered.pnl)}</span>
            )}{" "}
            · hp {(hovered.hp * 100).toFixed(0)}%
          </div>
        </div>
      ) : null}
    </div>
  );
}
