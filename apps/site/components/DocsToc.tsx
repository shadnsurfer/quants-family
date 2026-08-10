"use client";

/**
 * The docs table of contents with a live reading indicator: an acid marker slides down the
 * track to the section currently in the reading band (IntersectionObserver, rootMargin tuned
 * so "current" means roughly the middle of the viewport). One component serves both rooms —
 * the live site (sticky under the header) and the coming-soon site (no header — the caller
 * passes a smaller sticky offset). Numbered counter included: "03 / 11".
 */
import { useEffect, useRef, useState } from "react";

export function DocsToc({
  items,
  stickyClass = "top-[88px]",
}: {
  items: ReadonlyArray<readonly [id: string, label: string]>;
  stickyClass?: string;
}) {
  const [active, setActive] = useState<string>(items[0]?.[0] ?? "");
  const listRef = useRef<HTMLUListElement>(null);
  const [marker, setMarker] = useState<{ top: number; height: number; ready: boolean }>({ top: 0, height: 0, ready: false });

  // scrollspy: the section occupying the reading band becomes current
  useEffect(() => {
    const sections = items
      .map(([id]) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      // the reading band: upper-middle of the viewport
      { rootMargin: "-18% 0px -68% 0px", threshold: 0 },
    );
    for (const s of sections) observer.observe(s);
    return () => observer.disconnect();
  }, [items]);

  // the marker slides to the current item (measured off the list, so it works at any scale)
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-toc-id="${CSS.escape(active)}"]`);
    if (el) setMarker({ top: el.offsetTop + 2, height: Math.max(0, el.offsetHeight - 4), ready: true });
  }, [active, items]);

  const activeIndex = items.findIndex(([id]) => id === active);

  return (
    <nav className={`sticky ${stickyClass} px-5 py-8`} aria-label="contents">
      <div className="mb-4 flex items-baseline justify-between">
        <span className="kicker">contents</span>
        <span
          aria-live="polite"
          className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-faint tabular-nums"
        >
          {activeIndex >= 0 ? String(activeIndex + 1).padStart(2, "0") : "—"} / {String(items.length).padStart(2, "0")}
        </span>
      </div>
      <div className="relative">
        {/* the hairline track */}
        <span aria-hidden className="absolute bottom-1 left-0 top-1 w-px bg-softrule" />
        {/* the acid marker — slides to the section being read */}
        <span
          aria-hidden
          className={`absolute left-[-1.5px] w-[4px] bg-accent transition-all duration-300 ease-out ${marker.ready ? "opacity-100" : "opacity-0"}`}
          style={{ top: marker.top, height: marker.height }}
        />
        <ul ref={listRef} className="grid gap-1.5">
          {items.map(([id, label], i) => {
            const current = id === active;
            return (
              <li key={id} data-toc-id={id}>
                <a
                  href={`#${id}`}
                  aria-current={current ? "location" : undefined}
                  className={`block py-[3px] pl-4 text-[12.5px] uppercase tracking-[0.1em] transition-colors duration-200 ${
                    current ? "font-medium text-ink" : "text-dim hover:text-ink"
                  }`}
                >
                  {label}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
