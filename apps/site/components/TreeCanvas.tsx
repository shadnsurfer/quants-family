"use client";

/**
 * Pannable/zoomable culture-dish canvas for the family tree. Dependency-free: pointer-drag
 * pan (background only — cards stay clickable), wheel zoom anchored at the cursor, +/−/fit
 * controls. Fits the whole tree on mount.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProtoNode, TreeEdge, TreeNode } from "@/lib/tree";
import { CARD_H, CARD_W } from "@/lib/tree";
import { ProtoCard, QuantCard } from "./QuantCard";

const MIN_S = 0.3;
const MAX_S = 1.6;

interface View {
  tx: number;
  ty: number;
  s: number;
}

export function TreeCanvas({
  nodes, proto, edges, worldW, worldH,
}: {
  nodes: TreeNode[];
  proto: ProtoNode | null;
  edges: TreeEdge[];
  worldW: number;
  worldH: number;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ tx: 0, ty: 0, s: 0.8 });
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const fit = useCallback(() => {
    const el = frame.current;
    if (!el) return;
    const { clientWidth: vw, clientHeight: vh } = el;
    const s = Math.min(MAX_S, Math.max(MIN_S, Math.min(vw / worldW, vh / worldH) * 0.96));
    setView({ tx: (vw - worldW * s) / 2, ty: (vh - worldH * s) / 2, s });
  }, [worldW, worldH]);

  // opening view favors reading over overview: cards at legible size, centered on the tree's
  // top rows — the fit button gives the whole-species view on demand.
  const openingView = useCallback(() => {
    const el = frame.current;
    if (!el) return;
    const { clientWidth: vw, clientHeight: vh } = el;
    const fitS = Math.min(vw / worldW, vh / worldH) * 0.96;
    const s = Math.min(MAX_S, Math.max(0.74, fitS));
    const ty = worldH * s <= vh ? (vh - worldH * s) / 2 : 16 - 30 * s;
    setView({ tx: (vw - worldW * s) / 2, ty, s });
  }, [worldW, worldH]);

  useEffect(() => {
    openingView();
    window.addEventListener("resize", openingView);
    return () => window.removeEventListener("resize", openingView);
  }, [openingView]);

  const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
    setView((v) => {
      const s = Math.min(MAX_S, Math.max(MIN_S, v.s * factor));
      const k = s / v.s;
      return { s, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k };
    });
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, [zoomAt]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-card]")) return; // cards stay clickable
    drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [view.tx, view.ty]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setView((v) => ({ ...v, tx: d.tx + (e.clientX - d.x), ty: d.ty + (e.clientY - d.y) }));
  }, []);

  const endDrag = useCallback(() => {
    drag.current = null;
  }, []);

  const center = () => {
    const el = frame.current;
    return el ? { x: el.clientWidth / 2, y: el.clientHeight / 2 } : { x: 0, y: 0 };
  };

  return (
    <div
      ref={frame}
      className="dish relative h-full w-full touch-none select-none overflow-hidden cursor-grab active:cursor-grabbing"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
    >
      <div
        className="absolute left-0 top-0"
        style={{
          width: worldW,
          height: worldH,
          transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`,
          transformOrigin: "0 0",
        }}
      >
        <svg className="absolute left-0 top-0" width={worldW} height={worldH} aria-hidden>
          {edges.map((e, i) => {
            const midY = (e.y1 + e.y2) / 2;
            const d = `M ${e.x1} ${e.y1} L ${e.x1} ${midY} L ${e.x2} ${midY} L ${e.x2} ${e.y2}`;
            const stroke = e.proto ? "var(--amber)" : e.dead ? "var(--faint)" : "var(--ink)";
            return (
              <path
                key={i}
                d={d}
                fill="none"
                stroke={stroke}
                strokeOpacity={e.proto ? 0.6 : e.dead ? 0.45 : 0.6}
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            );
          })}
        </svg>

        {nodes.map((n) => (
          <div key={n.q.id} className="absolute" style={{ left: n.x, top: n.y, width: CARD_W, height: CARD_H }}>
            <QuantCard node={n} />
          </div>
        ))}
        {proto ? (
          <div className="absolute" style={{ left: proto.x, top: proto.y, width: CARD_W, height: CARD_H }}>
            <ProtoCard gen={proto.gen} />
          </div>
        ) : null}
      </div>

      <div className="absolute bottom-3 left-3 flex flex-col border border-rule bg-paper text-ink">
        <button aria-label="zoom in" className="px-2.5 py-1 transition-colors hover:bg-accent hover:text-[var(--on-accent)]" onClick={() => { const c = center(); zoomAt(c.x, c.y, 1.25); }}>+</button>
        <button aria-label="zoom out" className="border-t border-rule px-2.5 py-1 transition-colors hover:bg-accent hover:text-[var(--on-accent)]" onClick={() => { const c = center(); zoomAt(c.x, c.y, 1 / 1.25); }}>−</button>
        <button aria-label="fit tree" className="border-t border-rule px-2.5 py-1 text-[12px] transition-colors hover:bg-accent hover:text-[var(--on-accent)]" onClick={fit}>fit</button>
      </div>

      <div className="pointer-events-none absolute bottom-3 right-3 flex gap-4 border border-rule bg-paper px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-dim">
        <span><span className="text-ink">▪</span> living</span>
        <span><span className="text-faint">▪</span> grave</span>
        <span className="text-amber">◌ sport</span>
        <span>drag · scroll to zoom</span>
      </div>
    </div>
  );
}
