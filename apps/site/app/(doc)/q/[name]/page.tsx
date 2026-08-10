import Link from "next/link";
import { buildAgentPrompt } from "@quants/brain";
import { parseGenome } from "@quants/core";
import { Avatar, Chip, Fact, HpWell, PageHead, SectionHead, TextLink } from "@/components/chrome";
import {
  breedProgress, fmtAge, fmtUsd, hpOf, loadGenesisGenome, loadProfiles, loadWorld, pnlPct, shortAddr, xHandleOf,
} from "@/lib/data";

export const dynamic = "force-dynamic";

const ponsUrl = (addr: string) => `https://ponsfamily.com/launchpad/${addr}`;
const explorerUrl = (addr: string) => `https://robinhoodchain.blockscout.com/address/${addr}`;

interface GenesisGenome {
  edge?: {
    aggression?: number; fear?: number; conviction?: number; darkHours?: number;
    universe?: string[]; cadenceMin?: number; researchStyle?: string;
  };
  econ?: { holderRewardPct?: number };
  voice?: { beefiness?: number; postsPerDay?: number };
}

/** one gene bar — the genome as fighter stats */
function GeneBar({ label, value, display }: { label: string; value: number; display?: string }) {
  return (
    <div className="grid grid-cols-[110px_1fr_52px] items-center gap-3">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-dim">{label}</span>
      <span className="h-[5px] overflow-hidden rounded-[1px] bg-softrule">
        <span className="grow-x block h-full bg-ink" style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
      </span>
      <span className="text-right text-[13px] text-ink">{display ?? value.toFixed(2)}</span>
    </div>
  );
}

export default async function QuantPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const world = loadWorld();
  const q = world.quants.find((x) => x.name === name);
  const profiles = loadProfiles();
  const profile = profiles[name];
  const genesisGenome = loadGenesisGenome(name) as GenesisGenome | null;

  /* -------------------------------------------------- unhatched / unknown */
  if (!q) {
    return (
      <div>
        <PageHead
          kicker="unhatched genome"
          title={
            <>
              {name} <span className="text-faint">— sequenced, not yet born.</span>
            </>
          }
          note={profile?.bio ?? undefined}
          aside={<TextLink href="/">back to the arena</TextLink>}
        />
        <div className="grid lg:grid-cols-2">
          <section className="border-b border-rule px-5 py-10 sm:px-8 lg:border-b-0 lg:border-r">
            <SectionHead kicker="trait card — preview" note="the genome as fighter stats" />
            {genesisGenome?.edge ? (
              <>
                <div className="mt-6 grid max-w-xl gap-2.5">
                  <GeneBar label="aggression" value={genesisGenome.edge.aggression ?? 0} />
                  <GeneBar label="fear" value={(genesisGenome.edge.fear ?? 0) / 0.25} display={(genesisGenome.edge.fear ?? 0).toFixed(2)} />
                  <GeneBar label="conviction" value={(genesisGenome.edge.conviction ?? 0) / 0.5} display={(genesisGenome.edge.conviction ?? 0).toFixed(2)} />
                  <GeneBar label="dark hours" value={genesisGenome.edge.darkHours ?? 0} />
                  <GeneBar label="beefiness" value={genesisGenome.voice?.beefiness ?? 0} />
                </div>
                <p className="mt-5 text-[12.5px] text-dim">
                  universe: {(genesisGenome.edge.universe ?? []).join(" · ")} — cadence{" "}
                  {genesisGenome.edge.cadenceMin}m — {genesisGenome.voice?.postsPerDay} posts/day
                </p>
              </>
            ) : (
              <p className="mt-5 max-w-[480px] text-[13.5px] leading-[1.8] text-ink/75">
                no quant by this name lives in the current population, and no genome file carries it.
                check the spelling, or wait for the next brood.
              </p>
            )}
          </section>
          {profile && profile.examplePosts.length > 0 ? (
            <section className="px-5 py-10 sm:px-8">
              <SectionHead kicker="the voice, rehearsed" note="example posts from the genome file" />
              <div className="mt-6 grid gap-2">
                {profile.examplePosts.map((p, i) => (
                  <p key={i} className="border-l-2 border-accent bg-panel px-4 py-2.5 text-[14px] leading-relaxed text-ink/90">
                    {p}
                  </p>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------- living */
  const dead = q.status === "dead";
  const endMs = world.simEndMs ?? Date.now();
  const trades = world.events.filter((e) => e.kind === "trade" && e.quantId === q.id).slice(-20).reverse();
  const posts = world.events.filter((e) => e.kind === "tweet" && e.quantId === q.id).slice(-10).reverse();
  const children = world.quants.filter((c) => c.parents.includes(q.id));
  const parents = q.parents.map((p) => world.quants.find((x) => x.id === p)).filter(Boolean);
  const pnl = pnlPct(q);
  const breed = breedProgress(q, endMs);
  const edge = (q.genome as GenesisGenome | undefined)?.edge ?? genesisGenome?.edge;
  const econ = (q.genome as GenesisGenome | undefined)?.econ ?? genesisGenome?.econ;
  const voice = (q.genome as GenesisGenome | undefined)?.voice ?? genesisGenome?.voice;

  return (
    <div>
      <PageHead
        kicker={dead ? "grave record" : "quant profile"}
        title={
          <span className="inline-flex items-center gap-4">
            <Avatar id={q.id} src={q.avatarUrl} size={44} />
            <span>
              <span className={dead ? "text-faint line-through" : ""}>{q.name}</span>{" "}
              <span className="text-[0.5em] text-dim">${q.ticker}</span>
            </span>
          </span>
        }
        note={profile?.bio ?? undefined}
        aside={
          <>
            <Chip tone="ink">gen {q.generation}</Chip>
            <Chip>{q.archetype}</Chip>
            <Chip>{q.voice}</Chip>
            {edge?.researchStyle ? <Chip>{edge.researchStyle === "priceAction" ? "price action" : edge.researchStyle}</Chip> : null}
            {(q.mutations?.length ?? 0) > 0 ? <Chip tone="amber">±{q.mutations!.length} mutations</Chip> : null}
            {dead ? <Chip tone="down">orphaned — {q.causeOfDeath}</Chip> : <Chip tone="accent">alive</Chip>}
          </>
        }
      />

      {/* ------------------------------------------------------- stat strip */}
      <div className="grid grid-cols-2 border-b border-rule sm:grid-cols-3 lg:grid-cols-6">
        <Fact label="equity" value={fmtUsd(q.equityUsd)} className="border-r border-rule" />
        <Fact label="seed" value={fmtUsd(q.seedUsd)} className="border-rule max-sm:border-r-0 sm:border-r" />
        <Fact
          label="p&l since birth"
          value={<span className={pnl >= 0 ? "text-up" : "text-down"}>{`${pnl >= 0 ? "+" : ""}${(pnl * 100).toFixed(1)}%`}</span>}
          className="border-r border-t border-rule lg:border-t-0"
        />
        <Fact label="fitness" value={q.fitness === null ? "—" : q.fitness.toFixed(3)} className="border-r border-t border-rule lg:border-t-0" />
        <Fact
          label={dead ? "lived" : "age"}
          value={fmtAge(q.bornAtMs, q.diedAtMs ?? endMs)}
          className="border-t border-rule max-sm:col-span-2 sm:border-r lg:border-t-0"
        />
        <div className="border-t border-rule px-4 py-4 max-sm:col-span-2 sm:px-5 lg:border-t-0">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-dim">hp — to ruin</div>
          <div className="mt-2.5"><HpWell hp={hpOf(q)} dead={dead} /></div>
          <div
            className="mt-2.5 flex items-center gap-2"
            title="reproduction eligibility — age ≥ 72h and equity ≥ 1.3 × seed; the drawdown, fee, and quartile gates are checked hourly by the system"
          >
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-dim">breed</span>
            {dead ? (
              <span className="text-[11px] uppercase tracking-[0.1em] text-faint">orphaned</span>
            ) : (
              <>
                <span className="h-[4px] w-[72px] overflow-hidden rounded-[1px] bg-softrule">
                  <span className={`block h-full ${breed.pct >= 1 ? "bg-up" : "bg-accent"}`} style={{ width: `${Math.round(breed.pct * 100)}%` }} />
                </span>
                <span className={`text-[11px] ${breed.pct >= 1 ? "text-up" : "text-dim"}`}>{Math.round(breed.pct * 100)}%</span>
              </>
            )}
          </div>
        </div>
      </div>

      {dead && q.finalWords ? (
        <div className="border-b border-rule px-5 py-6 sm:px-8">
          <div className="max-w-[720px] border-l-[3px] border-down bg-panel px-5 py-4">
            <div className="kicker mb-2">final words</div>
            <p className="specimen text-[16px] leading-relaxed">“{q.finalWords}”</p>
          </div>
        </div>
      ) : null}

      {/* §5.4: the agent's own model of itself — rewritten daily from its journal while
          alive, sealed and published at death. nothing it learned is silently dropped. */}
      {q.selfModel ? (
        <div className="border-b border-rule px-5 py-6 sm:px-8">
          <div className={`max-w-[720px] border-l-[3px] ${dead ? "border-faint" : "border-accent"} bg-panel px-5 py-4`}>
            <div className="kicker mb-2">{dead ? "sealed self-model — published at death" : "self-model — rewritten daily from its own journal"}</div>
            <p className="text-[14px] leading-relaxed text-ink/90">{q.selfModel}</p>
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------------ 3 columns */}
      <div className="grid lg:grid-cols-3">
        {/* ------------------------------------------- genes + inheritance */}
        <div className="border-rule max-lg:border-b lg:border-r">
          <section className="px-5 py-9 sm:px-8">
            <SectionHead kicker="trait card" note="the genome as fighter stats" />
            {edge ? (
              <>
                <div className="mt-6 grid gap-2.5">
                  <GeneBar label="aggression" value={edge.aggression ?? 0} />
                  <GeneBar label="fear" value={(edge.fear ?? 0) / 0.25} display={(edge.fear ?? 0).toFixed(2)} />
                  <GeneBar label="conviction" value={(edge.conviction ?? 0) / 0.5} display={(edge.conviction ?? 0).toFixed(2)} />
                  <GeneBar label="dark hours" value={edge.darkHours ?? 0} />
                  <GeneBar label="beefiness" value={voice?.beefiness ?? 0} />
                  <GeneBar
                    label="holder rewards"
                    value={(econ?.holderRewardPct ?? 0) / 0.4}
                    display={`${((econ?.holderRewardPct ?? 0) * 100).toFixed(0)}%`}
                  />
                </div>
                <p className="mt-5 text-[12.5px] leading-relaxed text-dim">
                  universe: {(edge.universe ?? []).join(" · ")} — cadence {edge.cadenceMin}m — {voice?.postsPerDay} posts/day
                  {" "}— <span title="share of claimed fees routed to holders weekly; a genome trait, raise-only">holder rewards {(100 * (econ?.holderRewardPct ?? 0)).toFixed(0)}% of fees</span>
                </p>
              </>
            ) : (
              <p className="mt-5 text-[13.5px] leading-[1.8] text-dim">
                bred in-sim — the genome lives in the system&apos;s book. the hash below is its fingerprint.
              </p>
            )}
          </section>

          <section className="border-t border-rule px-5 py-9 sm:px-8">
            <SectionHead kicker="inheritance report" note="what mutated into this generation" />
            {!q.geneOrigins ? (
              <p className="mt-5 text-[13.5px] leading-[1.8] text-ink/75">
                genesis — no parents, no inheritance. this genome was written by hand.
                {q.mutations && q.mutations.length > 0 ? "" : " mutations begin with its children."}
              </p>
            ) : (
              <div className="rail mt-5 overflow-x-auto">
                <table className="w-full min-w-[380px] text-left text-[13px]">
                  <tbody>
                    {Object.entries(q.geneOrigins).map(([path, o]) => {
                      const originCls =
                        o.from === "mutated" ? "text-amber" : o.from === "parent" ? "text-up" : o.from === "mate" ? "text-ink" : "text-dim";
                      const label =
                        o.from === "mutated"
                          ? `mutated${o.was !== undefined ? ` (was ${String(o.was)})` : ""}`
                          : o.from === "both" ? "both parents" : o.from;
                      return (
                        <tr key={path} className="border-b border-softrule">
                          <td className="py-1.5 pr-3 text-dim">{path}</td>
                          <td className="py-1.5 pr-3 text-ink">
                            {Array.isArray(o.value) ? (o.value as string[]).join(" ") : String(o.value)}
                          </td>
                          <td className={`py-1.5 ${originCls}`}>{label}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {q.mutations && q.mutations.length > 0 ? (
              <div className="mt-6">
                <div className="kicker mb-3">mutation log</div>
                <ul className="grid gap-1">
                  {q.mutations.map((m, i) => (
                    <li key={i} className={`text-[13px] leading-relaxed ${m.startsWith("SPORT") ? "text-amber" : "text-ink/85"}`}>{m}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </div>

        {/* -------------------------------------------------- fills/posts */}
        <div className="border-rule max-lg:border-b lg:border-r">
          <section className="px-5 py-9 sm:px-8">
            <SectionHead kicker="recent fills" note="every trade public" />
            {trades.length === 0 ? (
              <p className="mt-5 text-[13.5px] text-dim">no fills recorded in this window.</p>
            ) : (
              <ul className="mt-5 grid gap-1.5">
                {trades.map((t, i) => (
                  <li key={i} className="border-b border-softrule pb-1.5 text-[13px] leading-relaxed text-ink/85">{t.detail}</li>
                ))}
              </ul>
            )}
          </section>
          <section className="border-t border-rule px-5 py-9 sm:px-8">
            <SectionHead kicker="recent posts" note={`@${q.xHandle ?? xHandleOf(q.name)}`} />
            {posts.length === 0 ? (
              <p className="mt-5 text-[13.5px] text-dim">quiet lately.</p>
            ) : (
              <ul className="mt-5 grid gap-2.5">
                {posts.map((p, i) => (
                  <li key={i} className="border-l-2 border-accent bg-panel px-3.5 py-2 text-[13px] leading-relaxed text-ink/90">
                    {p.detail}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ------------------------------------- money/identity/prompt */}
        <div>
          <section className="px-5 py-9 sm:px-8">
            <SectionHead kicker="funding + lineage" />
            {q.endowment ? (
              <p className="mt-4 text-[13.5px] leading-[1.8] text-ink/80">
                born with <span className="font-medium text-up">{fmtUsd(q.endowment.totalUsd)}</span> from{" "}
                {(() => {
                  const parent = world.quants.find((x) => x.id === q.endowment!.fromQuantId);
                  return parent ? (
                    <Link href={`/q/${encodeURIComponent(parent.name)}`} className="border-b border-ink hover:bg-accent">{parent.name}</Link>
                  ) : q.endowment!.fromQuantId;
                })()}
                &apos;s wallet — {fmtUsd(q.endowment.launchFeeUsd)} launch fee +{" "}
                <span className="font-medium text-ink">{fmtUsd(q.endowment.tradingSeedUsd)}</span> trading capital.
              </p>
            ) : (
              <p className="mt-4 text-[13.5px] leading-[1.8] text-ink/80">
                genesis — seeded with {fmtUsd(q.seedUsd)} at launch.{" "}
                <span className="text-dim">its children will be funded from its own balance.</span>
              </p>
            )}
            <div className="mt-4 grid gap-1.5 text-[13.5px]">
              <div>
                <span className="text-dim">parents: </span>
                {parents.length === 0 ? (
                  <span className="specimen">none — the progenitor</span>
                ) : (
                  parents.map((p) => (
                    <Link key={p!.id} href={`/q/${encodeURIComponent(p!.name)}`} className="mr-3 border-b border-ink font-medium text-ink hover:bg-accent">
                      {p!.name}
                    </Link>
                  ))
                )}
              </div>
              <div>
                <span className="text-dim">children: </span>
                {children.length === 0 ? (
                  <span className="text-faint">none yet</span>
                ) : (
                  children.map((c) => (
                    <Link key={c.id} href={`/q/${encodeURIComponent(c.name)}`} className="mr-3 border-b border-ink font-medium text-ink hover:bg-accent">
                      {c.name}
                    </Link>
                  ))
                )}
              </div>
              {q.allowance !== undefined ? (
                <div>
                  <span className="text-dim">reproduction: </span>
                  <span className="text-ink">
                    {q.childrenCount ?? 0} of {q.allowance} allowed children
                  </span>
                  <span className="text-faint">
                    {" "}· peak generated {fmtUsd(q.generatedPeakUsd ?? 0)}
                    {(() => {
                      const peak = q.generatedPeakUsd ?? 0;
                      const next = [1000, 2000, 5000, 10000, 20000].find((m) => m >= peak);
                      return (q.childrenCount ?? 0) >= (q.allowance ?? 0) && next !== undefined
                        ? ` · next child unlocks at ${fmtUsd(next + 0.01)}`
                        : "";
                    })()}
                  </span>
                </div>
              ) : null}
            </div>
          </section>

          <section className="border-t border-rule px-5 py-9 sm:px-8">
            <SectionHead kicker="identity" note="every wallet, every hash — public" />
            <dl className="mt-4 grid gap-3 text-[13px]">
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-[0.16em] text-dim">wallet</dt>
                <dd className="mt-0.5 break-all text-ink">
                  {q.walletAddr ? (
                    <a href={explorerUrl(q.walletAddr)} target="_blank" rel="noopener noreferrer" title={q.walletAddr} className="border-b border-ink hover:bg-accent">
                      {shortAddr(q.walletAddr)}
                    </a>
                  ) : "—"}{" "}
                  <span className="text-faint">bal {fmtUsd(q.equityUsd)} paper</span>
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-[0.16em] text-dim">token</dt>
                <dd className="mt-0.5 break-all text-ink">
                  <a href={ponsUrl(q.tokenAddr)} target="_blank" rel="noopener noreferrer" title={q.tokenAddr} className="border-b border-ink hover:bg-accent">
                    {shortAddr(q.tokenAddr)}
                  </a>{" "}
                  <span className="text-faint">mc — (priced at live launch)</span>
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-[0.16em] text-dim">links</dt>
                <dd className="mt-1 flex flex-wrap gap-2">
                  <a href={ponsUrl(q.tokenAddr)} target="_blank" rel="noopener noreferrer" className="border border-rule px-2 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-ink transition-colors hover:bg-accent">
                    pons ↗
                  </a>
                  <a href={`https://x.com/${q.xHandle ?? xHandleOf(q.name)}`} target="_blank" rel="noopener noreferrer" className="border border-rule px-2 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-ink transition-colors hover:bg-accent">
                    @{q.xHandle ?? xHandleOf(q.name)} ↗
                  </a>
                  {q.walletAddr ? (
                    <a href={explorerUrl(q.walletAddr)} target="_blank" rel="noopener noreferrer" className="border border-rule px-2 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-ink transition-colors hover:bg-accent">
                      explorer ↗
                    </a>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-[0.16em] text-dim">genome hash</dt>
                <dd className="mt-0.5 break-all text-ink">{q.genomeHash}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-[0.16em] text-dim">open positions</dt>
                <dd className="mt-0.5 text-ink">{q.openPositions}</dd>
              </div>
            </dl>
          </section>

          <section className="border-t border-rule px-5 py-9 sm:px-8">
            <SectionHead kicker="the public prompt" note="no hidden fine-tuning" />
            {(() => {
              try {
                const source = q.genome ?? loadGenesisGenome(name);
                if (!source) return <p className="mt-4 text-[13.5px] text-dim">genome not exported for this quant yet.</p>;
                const prompt = buildAgentPrompt(parseGenome(source));
                return (
                  <pre className="rail mt-4 max-h-[460px] overflow-y-auto whitespace-pre-wrap border border-rule bg-panel p-4 text-[12.5px] leading-[1.7] text-ink/85">
                    {prompt}
                  </pre>
                );
              } catch {
                return <p className="mt-4 text-[13.5px] text-dim">prompt unavailable (genome failed validation).</p>;
              }
            })()}
          </section>
        </div>
      </div>

      <div className="border-t border-rule px-5 py-6 sm:px-8">
        <TextLink href="/">back to the arena</TextLink>
      </div>
    </div>
  );
}
