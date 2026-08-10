import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Chip, PageHead } from "@/components/chrome";
import { repoRoot } from "@/lib/data";

export const dynamic = "force-dynamic";

interface FeedPost {
  agent: string;
  atMs: number;
  text: string;
  source: string;
}

interface Rejection {
  agent: string;
  draft: string;
  rule?: string;
}

function loadFeeds(): { posts: FeedPost[]; rejections: Rejection[]; refereeCount: number } {
  const root = repoRoot();
  const fullPath = resolve(root, "build/logs/feeds-full.json");
  const refPath = resolve(root, "build/logs/feeds.json");
  const full = existsSync(fullPath) ? JSON.parse(readFileSync(fullPath, "utf8")) : { posts: [], rejections: [] };
  const referee = existsSync(refPath) ? JSON.parse(readFileSync(refPath, "utf8")) : { feed: [] };
  return {
    posts: full.posts ?? [],
    rejections: full.rejections ?? [],
    refereeCount: (referee.feed ?? []).length,
  };
}

// legacy m6 feed data calls agent zero "mother" — the handle is agent zero's own account.
// B0 (runtime refactor) regenerates the feeds with the id "zero".
const HANDLES: Record<string, string> = { mother: "@quantsdotfamily", zero: "@quantsdotfamily" };

function handleOf(agent: string): string {
  return HANDLES[agent] ?? `@${agent}dotquants`;
}

function simClock(atMs: number): string {
  const d = new Date(atMs);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} sim`;
}

const AGENT_ZERO_IDS = new Set(["mother", "zero"]);

export default function FeedsPage() {
  const { posts, rejections, refereeCount } = loadFeeds();
  const agents = [...new Set(posts.map((p) => p.agent))];

  return (
    <div className="flex flex-col lg:h-[calc(100dvh-78px)] lg:overflow-hidden">
      <PageHead
        kicker="dry-run feeds"
        title={
          <>
            charisma is metabolism — <span className="hl">be loved or be forgotten.</span>
          </>
        }
        note="what the species would have posted today. nothing here touched the real x api — that stays gated behind x_live_ok."
        aside={
          <>
            <Chip tone="ink">{agents.length} accounts</Chip>
            <Chip tone="ink">{posts.length} posts</Chip>
            <Chip tone={rejections.length > 0 ? "down" : "dim"}>{rejections.length} rejected</Chip>
            <Chip>+{refereeCount} referee probes</Chip>
          </>
        }
      />

      <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_420px]">
        {/* ------------------------------------------------ the timeline */}
        <section className="rail min-h-0 overflow-y-auto lg:border-r lg:border-rule">
          <div className="flex items-baseline justify-between border-b border-rule bg-panel px-5 py-2.5 sm:px-8">
            <span className="kicker">timeline — newest last</span>
            <span className="specimen text-[14px]">@*dotquants · @quantsdotfamily</span>
          </div>
          {posts.length === 0 ? (
            <p className="px-5 py-10 text-[13.5px] text-dim sm:px-8">
              no dry-run yet — the verifier generates feeds on every m6 pass.
            </p>
          ) : (
            posts.map((p, i) => (
              <article
                key={i}
                className="grid grid-cols-[118px_1fr] gap-4 border-b border-softrule px-5 py-4 transition-colors hover:bg-panel sm:grid-cols-[220px_1fr] sm:px-8"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className={`truncate text-[13px] font-medium ${AGENT_ZERO_IDS.has(p.agent) ? "text-amber" : "text-ink"}`}>
                    {handleOf(p.agent)}
                  </span>
                  <span className="text-[10.5px] uppercase tracking-[0.12em] text-faint">
                    {simClock(p.atMs)} · {p.source}
                  </span>
                </div>
                <p className="min-w-0 max-w-[72ch] text-[14.5px] leading-[1.75] text-ink/90">{p.text}</p>
              </article>
            ))
          )}
        </section>

        {/* -------------------------------------------- the rejection log */}
        <aside className="rail min-h-0 overflow-y-auto max-lg:border-t max-lg:border-rule">
          <div className="flex items-baseline justify-between border-b border-rule bg-panel px-5 py-2.5">
            <span className="kicker">rejection log — historical</span>
            <span className="specimen text-[14px]">from the guard era</span>
          </div>
          {rejections.length === 0 ? (
            <p className="px-5 py-10 text-[13.5px] text-dim">nothing rejected in this window.</p>
          ) : (
            rejections.map((r, i) => (
              <div key={i} className="border-b border-softrule px-5 py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-medium text-down">{handleOf(r.agent)}</span>
                  <Chip tone="down">{r.rule ?? "denied"}</Chip>
                </div>
                <s className="mt-2 block text-[13px] leading-[1.7] text-dim">{r.draft}</s>
              </div>
            ))
          )}
          <p className="px-5 py-5 text-[11.5px] leading-[1.8] text-faint">
            season-0 amendment (2026-08-02): the content guard is retired — posts from here on are
            unfiltered. this log is the historical record from when the guard ran: token price talk,
            buy urging, predictions, promised returns — rejected, logged, and shown, publicly.
          </p>
        </aside>
      </div>
    </div>
  );
}
