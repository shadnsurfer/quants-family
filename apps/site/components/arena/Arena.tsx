"use client";

/**
 * The arena shell: owns the live world (seeded by SSR, then polled from
 * /api/world every 8s), species vitals, and the judging rail. The dish is the
 * family tree — the only view. (The single activity marquee lives in the
 * root-layout header — one crawl for the whole site.)
 */
import { useEffect, useMemo, useState } from "react";
import { BroadcastCountdown } from "@/components/BroadcastCountdown";
import { TreeCanvas } from "@/components/TreeCanvas";
import { aiGdp, fmtUsd, type World } from "@/lib/world";
import { buildTreeLayout } from "@/lib/tree";
import { ArenaRail, type RailTab } from "./ArenaRail";

function Vital({ label, children, accent = false }: { label: string; children: React.ReactNode; accent?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 border border-rule bg-paper px-2 py-1 text-[10.5px] font-medium uppercase tracking-[0.12em] text-dim">
      {label}
      <span className={accent ? "bg-accent px-1 text-[var(--on-accent)]" : "text-ink"}>{children}</span>
    </span>
  );
}

export function Arena({
  initialWorld,
  initialTab,
}: {
  initialWorld: World;
  initialTab: RailTab;
}) {
  const [world, setWorld] = useState(initialWorld);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/world", { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as World;
        if (!stop) setWorld(next);
      } catch {
        // the daemon outlives a failed poll — keep the last world on screen
      }
    };
    const t = setInterval(tick, 8_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  const alive = world.quants.filter((q) => q.status === "alive").length;
  const dead = world.quants.filter((q) => q.status === "dead").length;
  const bred = new Set(world.events.filter((e) => e.kind === "birth").map((e) => e.quantId)).size;
  const layout = useMemo(() => buildTreeLayout(world), [world]);

  return (
    // chrome above: 52px header bar + 26px activity marquee = 78px
    <div className="flex h-[calc(100dvh-78px)] flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[1fr_380px]">
        {/* the dish */}
        <main className="relative h-[46%] min-h-0 border-b border-rule lg:h-auto lg:border-b-0 lg:border-r">
          {world.quants.length === 0 ? (
            <div className="dish grid h-full place-items-center">
              <p className="specimen text-[15px]">the dish is empty. gen 0 is pending.</p>
            </div>
          ) : (
            <TreeCanvas
              nodes={layout.nodes}
              proto={layout.proto}
              edges={layout.edges}
              worldW={layout.worldW}
              worldH={layout.worldH}
            />
          )}

          {/* species vitals */}
          <div className="pointer-events-none absolute left-3 top-3 flex max-w-[calc(100%-120px)] flex-wrap gap-1.5">
            <Vital label="alive" accent>{alive}</Vital>
            <Vital label="bred">{bred}</Vital>
            <Vital label="dead">{dead}</Vital>
            <Vital label="ai gdp">{fmtUsd(aiGdp(world))}</Vital>
            <Vital label="fees">{world.flows ? fmtUsd(world.flows.totals.feeClaims) : "—"}</Vital>
            <Vital label="broadcast"><BroadcastCountdown /></Vital>
          </div>
        </main>

        {/* the judging rail */}
        <aside className="min-h-0 flex-1 lg:h-full">
          <ArenaRail world={world} initialTab={initialTab} />
        </aside>
      </div>
    </div>
  );
}
