"use client";

/**
 * The arena rail: the judging apparatus, spore-style. Default tab is the live
 * activity feed — every birth, death, trade, tweet, and fee claim, newest
 * first — with the bloodline leaderboard, the public mutation log, and the
 * graveyard one tab over. All from the same polled world the dish renders.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { Chip, HpWell, Pnl } from "@/components/chrome";
import { fmtAge, fmtAgo, fmtUsd, hpOf, pnlPct, type World, type WorldEvent, type WorldQuant } from "@/lib/world";

export type RailTab = "activity" | "board" | "mutations" | "graves";

const TABS: Array<[RailTab, string]> = [
  ["activity", "activity"],
  ["board", "leaderboard"],
  ["mutations", "mutations"],
  ["graves", "graveyard"],
];

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

interface Bloodline {
  root: WorldQuant;
  members: WorldQuant[];
  living: number;
  dead: number;
  equity: number;
}

function useDerived(world: World) {
  return useMemo(() => {
    const byId = new Map(world.quants.map((q) => [q.id, q]));
    const rankOf = new Map(
      [...world.quants]
        .sort((a, b) => (b.fitness ?? -Infinity) - (a.fitness ?? -Infinity))
        .map((q, i) => [q.id, i + 1]),
    );

    const rootOf = (q: WorldQuant): WorldQuant => {
      let cur = q;
      const seen = new Set<string>();
      while (cur.parents.length > 0) {
        if (seen.has(cur.id)) break;
        seen.add(cur.id);
        const p = byId.get(cur.parents[0]);
        if (!p) break;
        cur = p;
      }
      return cur;
    };

    const lines = new Map<string, Bloodline>();
    for (const q of world.quants) {
      const root = rootOf(q);
      const line = lines.get(root.id) ?? { root, members: [], living: 0, dead: 0, equity: 0 };
      line.members.push(q);
      if (q.status === "alive") {
        line.living += 1;
        line.equity += q.equityUsd;
      } else {
        line.dead += 1;
      }
      lines.set(root.id, line);
    }
    const bloodlines = [...lines.values()].sort((a, b) => b.equity - a.equity);
    for (const l of bloodlines) {
      l.members.sort((a, b) => (b.fitness ?? -Infinity) - (a.fitness ?? -Infinity));
    }

    const mutationLog = world.quants
      .filter((q) => (q.mutations?.length ?? 0) > 0)
      .sort((a, b) => b.bornAtMs - a.bornAtMs);

    const graves = world.quants
      .filter((q) => q.status === "dead")
      .sort((a, b) => (b.diedAtMs ?? 0) - (a.diedAtMs ?? 0));

    const activity = [...world.events].reverse().slice(0, 150);

    return { byId, rankOf, bloodlines, mutationLog, graves, activity };
  }, [world]);
}

function QuantRow({ q, rank }: { q: WorldQuant; rank: number }) {
  const dead = q.status === "dead";
  return (
    <Link
      href={`/q/${encodeURIComponent(q.name)}`}
      className={`grid grid-cols-[30px_1fr_64px_70px_86px] items-center gap-2 border-b border-softrule px-3 py-2 text-[13px] transition-colors ${
        dead ? "opacity-55 hover:opacity-85" : "hover:bg-accent/45"
      }`}
    >
      <span className="text-dim">{String(rank).padStart(2, "0")}</span>
      <span className="min-w-0 truncate">
        <span className={`mr-1.5 inline-block h-[7px] w-[7px] rounded-full ${dead ? "bg-faint" : "bg-accent"}`} />
        <span className={`font-medium ${dead ? "text-faint line-through" : "text-ink"}`}>{q.name}</span>{" "}
        <span className="text-[11px] text-dim">g{q.generation}</span>
      </span>
      <span className="text-ink">{q.fitness === null ? "—" : q.fitness.toFixed(3)}</span>
      <Pnl value={pnlPct(q)} />
      <span className="text-right">
        <HpWell hp={hpOf(q)} dead={dead} compact />
      </span>
    </Link>
  );
}

/** one line of the species' live journal — decisions carry their voiced thesis underneath */
function ActivityRow({ e, byId, endMs }: { e: WorldEvent; byId: Map<string, WorldQuant>; endMs: number }) {
  const q = byId.get(e.quantId);
  const name = q?.name ?? e.quantId.replace(/^g\d+-/, "");
  return (
    <div className="flex items-baseline gap-2.5 border-b border-softrule px-3 py-2.5 text-[12.5px] leading-relaxed">
      <span className={`w-[62px] shrink-0 text-[10px] font-medium uppercase tracking-[0.12em] ${EVENT_TONE[e.kind] ?? "text-dim"}`}>
        {e.kind}
      </span>
      <span className="min-w-0 flex-1 text-ink/85">
        {q ? (
          <Link href={`/q/${encodeURIComponent(q.name)}`} className="font-medium text-ink hover:bg-accent hover:text-[var(--on-accent)]">
            {name}
          </Link>
        ) : (
          <span className="font-medium text-ink">{name}</span>
        )}{" "}
        <span className="text-dim">{e.detail.length > 120 ? `${e.detail.slice(0, 120)}…` : e.detail}</span>
        {e.thesis ? (
          <span className="mt-0.5 block text-[12px] italic leading-snug text-dim/75">
            “{e.thesis.length > 180 ? `${e.thesis.slice(0, 180)}…` : e.thesis}”
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-[10.5px] uppercase tracking-[0.08em] text-faint">{fmtAgo(e.atMs, endMs)}</span>
    </div>
  );
}

export function ArenaRail({ world, initialTab = "activity" }: { world: World; initialTab?: RailTab }) {
  const [tab, setTab] = useState<RailTab>(initialTab);
  const { byId, rankOf, bloodlines, mutationLog, graves, activity } = useDerived(world);
  const endMs = world.simEndMs ?? Date.now();

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <div className="flex shrink-0 items-stretch border-b border-rule">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 border-r border-rule px-1 py-2.5 text-[10px] font-medium uppercase tracking-[0.1em] transition-colors last:border-r-0 ${
              tab === id ? "bg-accent text-[var(--on-accent)]" : "text-dim hover:bg-panel hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
        <span
          className="flex items-center gap-1.5 border-l border-rule px-2.5 text-[10px] uppercase tracking-[0.12em] text-dim"
          title="polling the world every few seconds"
        >
          <span className="blink inline-block h-[6px] w-[6px] bg-up" />
          live
        </span>
      </div>

      <div className="rail min-h-0 flex-1 overflow-y-auto">
        {tab === "activity" ? (
          activity.length === 0 ? (
            <p className="specimen px-4 py-8 text-[15px]">nothing has happened yet. the clock has started.</p>
          ) : (
            activity.map((e, i) => <ActivityRow key={`${e.atMs}-${i}`} e={e} byId={byId} endMs={endMs} />)
          )
        ) : null}

        {tab === "board" ? (
          bloodlines.length === 0 ? (
            <p className="specimen px-4 py-8 text-[15px]">the dish is empty. gen 0 is pending.</p>
          ) : (
            bloodlines.map((line) => (
              <div key={line.root.id}>
                <div className="flex items-baseline justify-between gap-2 border-b border-rule bg-panel px-3 py-2">
                  <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink">
                    bloodline {line.root.name}
                  </span>
                  <span className="text-[10.5px] uppercase tracking-[0.1em] text-dim">
                    {line.living} living · {line.dead} dead · {fmtUsd(line.equity)}
                  </span>
                </div>
                {line.members.map((q) => (
                  <QuantRow key={q.id} q={q} rank={rankOf.get(q.id) ?? 0} />
                ))}
              </div>
            ))
          )
        ) : null}

        {tab === "mutations" ? (
          mutationLog.length === 0 ? (
            <p className="specimen px-4 py-8 text-[15px]">
              no mutations yet. the first brood will bend its parents&apos; genes in public.
            </p>
          ) : (
            mutationLog.map((q) => (
              <div key={q.id} className="border-b border-softrule px-3 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <Link href={`/q/${encodeURIComponent(q.name)}`} className="text-[13px] font-medium text-ink hover:bg-accent hover:text-[var(--on-accent)]">
                    {q.name}
                  </Link>
                  <span className="text-[10.5px] uppercase tracking-[0.1em] text-dim">
                    g{q.generation} · {q.mutations!.length} mutation{q.mutations!.length > 1 ? "s" : ""}
                  </span>
                </div>
                <ul className="mt-1.5 grid gap-1">
                  {q.mutations!.map((m, i) => (
                    <li
                      key={i}
                      className={`text-[12px] leading-relaxed ${m.startsWith("SPORT") ? "text-amber" : "text-ink/80"}`}
                    >
                      {m}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )
        ) : null}

        {tab === "graves" ? (
          graves.length === 0 ? (
            <p className="specimen px-4 py-8 text-[15px]">
              no graves yet. the season is young — most will not survive it.
            </p>
          ) : (
            graves.map((q) => (
              <Link
                key={q.id}
                href={`/q/${encodeURIComponent(q.name)}`}
                className="block border-b border-softrule px-3 py-3 transition-colors hover:bg-panel"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-medium text-ink">
                    ✝ {q.name} <span className="text-[11px] font-normal text-dim">g{q.generation} · ${q.ticker}</span>
                  </span>
                  <span className="text-[11px] uppercase tracking-[0.1em] text-dim">
                    lived {fmtAge(q.bornAtMs, q.diedAtMs ?? endMs)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <Chip tone="down">{q.causeOfDeath ?? "dead"}</Chip>
                </div>
                {q.finalWords ? (
                  <p className="specimen mt-1.5 text-[14px] leading-relaxed">“{q.finalWords}”</p>
                ) : null}
              </Link>
            ))
          )
        ) : null}
      </div>

      <div className="shrink-0 border-t border-rule px-3 py-2 text-[10px] uppercase tracking-[0.12em] text-faint">
        season zero — the species runs itself; everything public
      </div>
    </div>
  );
}
