"use client";

/**
 * The instrument layer for the incubation page: a custom cursor (acid square
 * + a mono coordinate readout) and normalized --mx/--my CSS vars on :root
 * that drive the mark sculpture's tilt and acid underlay. All motion is
 * lerped on one rAF loop and written straight to the DOM — no react
 * re-renders. Fine-pointer devices only; reduced-motion and touch get the
 * native cursor and a still page.
 */
import { useEffect, useRef } from "react";

const OFFSCREEN = "translate3d(-300px,-300px,0)";

export function MouseTracker() {
  const cursor = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)").matches;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!fine || reduced) return;

    const root = document.documentElement;
    root.classList.add("has-custom-cursor");

    const target = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const cur = { ...target }; // cursor — snappy
    const par = { x: 0.5, y: 0.5 }; // sculpture vars — lazy
    let raf = 0;
    let lastReadout = "";

    const onMove = (e: PointerEvent) => {
      target.x = e.clientX;
      target.y = e.clientY;
    };
    const onOver = (e: PointerEvent) => {
      const hot = !!(e.target as HTMLElement).closest?.("a,button");
      cursor.current?.classList.toggle("is-hover", hot);
    };

    const loop = () => {
      cur.x += (target.x - cur.x) * 0.38;
      cur.y += (target.y - cur.y) * 0.38;
      par.x += (target.x / window.innerWidth - par.x) * 0.055;
      par.y += (target.y / window.innerHeight - par.y) * 0.055;

      root.style.setProperty("--mx", par.x.toFixed(4));
      root.style.setProperty("--my", par.y.toFixed(4));

      if (cursor.current) cursor.current.style.transform = `translate3d(${cur.x}px,${cur.y}px,0)`;

      const rx = String(Math.round(par.x * 999)).padStart(3, "0");
      const ry = String(Math.round(par.y * 999)).padStart(3, "0");
      const text = `${rx} · ${ry}`;
      if (text !== lastReadout && readout.current) {
        readout.current.textContent = text;
        lastReadout = text;
      }
      raf = requestAnimationFrame(loop);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerover", onOver, { passive: true });
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      root.classList.remove("has-custom-cursor");
      root.style.removeProperty("--mx");
      root.style.removeProperty("--my");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerover", onOver);
    };
  }, []);

  return (
    <div ref={cursor} aria-hidden className="soon-cursor pointer-events-none fixed left-0 top-0 z-[70]" style={{ transform: OFFSCREEN }}>
      <span className="sq absolute block h-[7px] w-[7px] bg-accent" style={{ transform: "translate(-50%,-50%)" }} />
      <span ref={readout} className="absolute left-3 top-2.5 whitespace-nowrap text-[10px] font-medium tracking-[0.14em] text-faint" />
    </div>
  );
}
