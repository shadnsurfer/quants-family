"use client";

/**
 * The live activity crawl: the species' journal streamed across the site header —
 * births, deaths, trades, tweets, fee claims — newest window, chronological, in the
 * same acid-ruled strip the commandments once occupied. SSR-seeded from the world;
 * AutoRefresh keeps it current.
 */
import { fmtAgo, type WorldEvent } from "@/lib/world";

const EVENT_TONE: Record<string, string> = {
  birth: "text-up",
  death: "text-down",
  "fee-claim": "text-amber",
  trade: "text-ink",
  tweet: "text-dim",
  halt: "text-down",
  sweep: "text-amber",
  reward: "text-up",
  veto: "text-dim",
  milestone: "text-up",
};

/** how many recent events ride the crawl */
const WINDOW = 24;

export function ActivityMarquee({
  events,
  names,
  endMs,
}: {
  events: WorldEvent[];
  /** quantId → display name */
  names: Record<string, string>;
  endMs: number;
}) {
  const run = events.slice(-WINDOW);
  if (run.length === 0) return null;

  const items = run.map((e, i) => {
    const name = names[e.quantId] ?? e.quantId.replace(/^g\d+-/, "");
    const detail = e.detail.length > 90 ? `${e.detail.slice(0, 90)}…` : e.detail;
    return (
      <span key={`${e.atMs}-${i}`} className="mx-5 inline-flex items-baseline gap-2">
        <span className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${EVENT_TONE[e.kind] ?? "text-dim"}`}>
          {e.kind}
        </span>
        <span className="text-[12px] font-medium text-ink">{name}</span>
        <span className="text-[12px] text-dim">{detail}</span>
        <span className="text-[10.5px] uppercase tracking-[0.08em] text-faint">{fmtAgo(e.atMs, endMs)}</span>
      </span>
    );
  });

  return (
    <div className="relative overflow-hidden border-b border-rule bg-paper" aria-label="live activity feed">
      <div className="marquee-track marquee-slow py-1.5">
        <span className="inline-flex">{items}</span>
        <span className="inline-flex" aria-hidden="true">{items}</span>
      </div>
    </div>
  );
}
