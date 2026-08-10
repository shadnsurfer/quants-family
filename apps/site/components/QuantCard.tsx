"use client";

/**
 * The tree-node card: one quant's whole life at a glance — genome identicon,
 * token CA + market cap, wallet + balance, health and breeding progress, and
 * its public links (pons token page, x profile). The card itself routes to
 * the quant's file; the link icons stop propagation.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fmtUsd, fmtPct, quantPath, shortAddr, xHandleOf } from "@/lib/world";
import type { TreeNode } from "@/lib/tree";
import { Avatar, HpWell } from "./chrome";

const ponsUrl = (addr: string) => `https://ponsfamily.com/launchpad/${addr}`;
const explorerUrl = (addr: string) => `https://robinhoodchain.blockscout.com/address/${addr}`;

function OutLink({ href, children, title }: { href: string; children: React.ReactNode; title?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      onClick={(e) => e.stopPropagation()}
      className="text-dim transition-colors hover:bg-accent hover:text-[var(--on-accent)]"
    >
      {children}
    </a>
  );
}

export function QuantCard({ node }: { node: TreeNode }) {
  const router = useRouter();
  const { q } = node;
  const dead = q.status === "dead";
  const href = quantPath(q.name);
  const xUrl = `https://x.com/${q.xHandle ?? xHandleOf(q.name)}`;

  return (
    <div
      data-card
      role="link"
      tabIndex={0}
      onClick={() => router.push(href)}
      onKeyDown={(e) => { if (e.key === "Enter") router.push(href); }}
      className={`block h-full cursor-pointer border bg-paper px-3 py-2.5 transition-all ${
        dead
          ? "border-softrule opacity-70 hover:opacity-95"
          : "border-rule shadow-[3px_3px_0_0_var(--softrule)] hover:border-ink hover:shadow-[4px_4px_0_0_var(--accent)]"
      } ${node.sport ? "!border-dashed !border-amber" : ""}`}
    >
      {/* identity */}
      <div className="flex items-center gap-2.5">
        <Avatar id={q.id} src={q.avatarUrl} size={30} />
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5">
            <Link
              href={href}
              onClick={(e) => e.stopPropagation()}
              className={`truncate text-[15px] font-medium hover:bg-accent hover:text-[var(--on-accent)] ${dead ? "text-faint line-through" : "text-ink"}`}
            >
              {dead ? "✝ " : ""}{q.name}
            </Link>
            <span className="text-[11.5px] text-dim">${q.ticker}</span>
          </div>
          <div className="mt-px text-[10.5px] uppercase tracking-[0.1em] text-faint">
            {q.archetype} · {q.voice}
            {node.sport ? <span className="text-amber"> · sport</span> : null}
          </div>
        </div>
        <span className="ml-auto shrink-0 border border-softrule px-1 text-[10.5px] font-medium uppercase tracking-[0.12em] text-dim">
          g{q.generation}
        </span>
      </div>

      {/* token + wallet */}
      <div className="mt-2 grid gap-0.5 text-[11px] leading-relaxed">
        <div className="flex items-baseline gap-2">
          <span className="w-[52px] shrink-0 uppercase tracking-[0.1em] text-faint">ca</span>
          <OutLink href={ponsUrl(q.tokenAddr)} title="token page on the pons launchpad">
            {shortAddr(q.tokenAddr)}
          </OutLink>
          <span className="text-faint" title="market cap — priced at live launch; dust markets have no deep book">
            mc —
          </span>
          <span className="ml-auto flex gap-2.5 uppercase tracking-[0.1em]">
            <OutLink href={ponsUrl(q.tokenAddr)} title="token page on the pons launchpad">pons ↗</OutLink>
            <OutLink href={xUrl} title={`@${q.xHandle ?? xHandleOf(q.name)} on x`}>x ↗</OutLink>
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="w-[52px] shrink-0 uppercase tracking-[0.1em] text-faint">wallet</span>
          {q.walletAddr ? (
            <OutLink href={explorerUrl(q.walletAddr)} title="wallet on robinhoodchain.blockscout.com">
              {shortAddr(q.walletAddr)}
            </OutLink>
          ) : (
            <span className="text-dim">—</span>
          )}
          <span className={`ml-auto ${dead ? "text-faint" : "text-ink"}`} title="paper trading balance">
            bal {fmtUsd(q.equityUsd)}
          </span>
        </div>
      </div>

      {/* vitals */}
      <div className="mt-2 grid grid-cols-2 border border-softrule">
        <div className="border-r border-softrule bg-panel px-2 py-1.5">
          <div className="text-[9.5px] font-medium uppercase tracking-[0.16em] text-dim">equity</div>
          <div className={`text-[13.5px] ${dead ? "text-faint" : "text-ink"}`}>{fmtUsd(q.equityUsd)}</div>
        </div>
        <div className="bg-panel px-2 py-1.5">
          <div className="text-[9.5px] font-medium uppercase tracking-[0.16em] text-dim">p&amp;l</div>
          <div className={`text-[13.5px] ${node.pnl > 0 ? "text-up" : node.pnl < 0 ? "text-down" : "text-dim"}`}>
            {fmtPct(node.pnl)}
          </div>
        </div>
      </div>

      {/* health + breeding */}
      <div className="mt-2 grid gap-1.5">
        <div className="flex items-center gap-2">
          <span className="w-[52px] shrink-0 text-[9.5px] font-medium uppercase tracking-[0.16em] text-dim">hp</span>
          <HpWell hp={node.hp} dead={dead} compact />
        </div>
        <div className="flex items-center gap-2" title="reproduction eligibility — age ≥ 72h and equity ≥ 1.3 × seed; the drawdown, fee, and quartile gates are checked hourly by the system">
          <span className="w-[52px] shrink-0 text-[9.5px] font-medium uppercase tracking-[0.16em] text-dim">breed</span>
          {dead ? (
            <span className="text-[11px] uppercase tracking-[0.1em] text-faint">orphaned</span>
          ) : (
            <>
              <span className="h-[4px] flex-1 overflow-hidden rounded-[1px] bg-softrule">
                <span
                  className={`block h-full ${node.breed >= 1 ? "bg-up" : "bg-accent"}`}
                  style={{ width: `${Math.round(node.breed * 100)}%` }}
                />
              </span>
              <span className={`w-8 text-right text-[11px] ${node.breed >= 1 ? "text-up" : "text-dim"}`}>
                {Math.round(node.breed * 100)}%
              </span>
            </>
          )}
        </div>
      </div>

      {/* meta */}
      <div className="mt-2 flex items-center justify-between text-[10.5px] uppercase tracking-[0.1em] text-faint">
        <span>f {q.fitness === null ? "—" : q.fitness.toFixed(3)}</span>
        <span>#{node.rank}</span>
        {q.holderRewardPct !== undefined ? (
          <span title="holder rewards — share of claimed fees routed to holders weekly">r {(q.holderRewardPct * 100).toFixed(0)}%</span>
        ) : null}
        <span>{dead ? `lived ${node.ageH}h` : `age ${node.ageH}h`}</span>
        <span>{node.children > 0 ? `${node.children} kids` : "no kids"}</span>
      </div>
    </div>
  );
}

/** The unhatched next generation — dashed acid, waiting on the hourly eligibility sweep. */
export function ProtoCard({ gen }: { gen: number }) {
  return (
    <div data-card className="h-full border border-dashed border-ink/50 bg-accent/40 px-3 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[16px] font-medium text-ink">gen_{gen}</span>
        <span className="ml-auto border border-ink/50 px-1 text-[11px] font-medium uppercase tracking-[0.12em] text-ink">
          unhatched
        </span>
      </div>
      <div className="mt-3 space-y-1.5 text-[12.5px] text-ink/80">
        <div className="border border-ink/25 bg-paper/60 px-2 py-1">genes — an exact copy of one parent</div>
        <div className="border border-ink/25 bg-paper/60 px-2 py-1">mutation — ±20% per gene @ 15% · sport @ 3%</div>
        <div className="border border-ink/25 bg-paper/60 px-2 py-1">seed — 20% of the parent&apos;s own balance</div>
      </div>
      <p className="specimen mt-2.5 text-[13.5px]">no mother. the fit copy themselves. the copies differ.</p>
    </div>
  );
}
