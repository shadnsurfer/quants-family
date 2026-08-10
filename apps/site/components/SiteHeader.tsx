/**
 * The shared site header — rendered once by the ROOT layout so it (and the live
 * activity marquee above it) persists across page changes. Structure: a short, dark,
 * near-still crawl on top; the nav row below it, open — no hairline separators, no
 * badges. The provable stack (eigencompute · turnkey · source) rides the nav row.
 * Themed entirely by design-token vars. `wide` drops the centered document column
 * for the full-bleed console. One marquee, site-wide: the live activity feed.
 */
import Link from "next/link";
import { ActivityMarquee } from "@/components/ActivityMarquee";
import { loadWorld } from "@/lib/data";
import { EIGENCOMPUTE_URL, SOURCE_URL, TURNKEY_URL } from "@/lib/links";
import { COMING_SOON } from "@/lib/soon";

const NAV = [
  ["/", "arena"],
  ["/feeds", "feeds"],
  ["/docs", "what is quants.family"],
] as const;

const PROOF = [
  [EIGENCOMPUTE_URL, "eigencompute"],
  [TURNKEY_URL, "turnkey"],
  [SOURCE_URL, "source"],
] as const;

export function SiteHeader({ wide = false }: { wide?: boolean }) {
  // while the building is sealed the world feed stays unread and the nav greys
  const world = COMING_SOON ? null : loadWorld();
  const alive = world ? world.quants.filter((q) => q.status === "alive").length : 0;
  const names = world ? Object.fromEntries(world.quants.map((q) => [q.id, q.name])) : {};
  const endMs = world?.simEndMs ?? Date.now();

  const inner = (
    <>
      <ActivityMarquee events={world?.events ?? []} names={names} endMs={endMs} />
      <div className="flex h-[52px] items-center">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-1 self-stretch px-3 transition-colors hover:bg-accent hover:text-[var(--on-accent)] sm:px-4"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/mark-black.png" alt="quants" width={21} height={21} className="block -translate-y-[1.5px]" />
          <span
            className="hidden text-[14px] normal-case tracking-[0.01em] min-[430px]:inline"
            style={{ fontFamily: "var(--font-brand), var(--font-mono), monospace" }}
          >
            Quants<span className="text-faint">.family</span>
          </span>
        </Link>
        <nav className="flex min-w-0 flex-1 items-center gap-0.5 px-2 text-[10.5px] font-medium uppercase tracking-[0.1em] min-[430px]:text-[11.5px] min-[430px]:tracking-[0.16em]">
          {NAV.map(([href, label]) =>
            COMING_SOON && href !== "/docs" ? (
              <span
                key={href}
                aria-disabled="true"
                title="sealed until genesis"
                className="flex flex-1 cursor-not-allowed select-none items-center justify-center px-1 py-1 text-faint min-[430px]:px-2 sm:px-3"
              >
                {label}
              </span>
            ) : (
              <Link
                key={href}
                href={href}
                className="flex flex-1 items-center justify-center px-1 py-1 transition-colors hover:bg-accent hover:text-[var(--on-accent)] min-[430px]:px-2 sm:px-3"
              >
                {label}
              </Link>
            ),
          )}
        </nav>
        {/* the provable stack rides the menu bar — external, opens in a new tab */}
        <div className="hidden items-center gap-0.5 px-2 text-[10.5px] font-medium uppercase tracking-[0.12em] text-dim md:flex min-[430px]:tracking-[0.16em]">
          {PROOF.map(([href, label]) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2 py-1 transition-colors hover:bg-accent hover:text-[var(--on-accent)] sm:px-2.5"
            >
              {label}&nbsp;↗
            </a>
          ))}
        </div>
        {COMING_SOON ? (
          <div className="hidden items-center gap-2 px-3 text-[12px] text-dim sm:flex">
            <span className="blink inline-block h-[7px] w-[7px] bg-accent" />
            incubating
          </div>
        ) : (
          <div className="hidden items-center gap-2 px-3 text-[12px] text-dim sm:flex">
            <span className="blink inline-block h-[7px] w-[7px] bg-up" />
            alive <span className="font-medium text-ink">{alive}</span>
          </div>
        )}
      </div>
    </>
  );

  return (
    <header className="sticky top-0 z-20 border-b border-rule bg-paper">
      {wide ? inner : <div className="mx-auto max-w-[920px] border-x border-rule">{inner}</div>}
    </header>
  );
}
