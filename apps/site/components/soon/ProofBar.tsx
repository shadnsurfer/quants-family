/**
 * The proof bar — the only chrome while the building is sealed. Spore-style: the platforms
 * the species stands on are linked directly in the menu bar, not buried in body copy.
 * Rendered by the ROOT layout under COMING_SOON so it tops every sealed page (/, /docs).
 */
import Link from "next/link";
import { EIGENCOMPUTE_URL, SOURCE_URL, TURNKEY_URL } from "@/lib/links";

const PROOF = [
  [EIGENCOMPUTE_URL, "eigencompute"],
  [TURNKEY_URL, "turnkey"],
  [SOURCE_URL, "source"],
] as const;

export function ProofBar() {
  return (
    <header className="sticky top-0 z-20 border-b border-rule bg-paper">
      <div className="flex h-[52px] items-stretch justify-between">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-1.5 border-r border-rule px-4 transition-colors hover:bg-accent hover:text-[var(--on-accent)] sm:px-5"
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
        <nav className="flex items-stretch text-[10.5px] font-medium uppercase tracking-[0.1em] min-[430px]:text-[11.5px] min-[430px]:tracking-[0.16em]">
          <span className="hidden select-none items-center px-3 text-faint md:flex">
            provable autonomy on
          </span>
          {PROOF.map(([href, label]) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center border-l border-rule px-3 transition-colors hover:bg-accent hover:text-[var(--on-accent)] sm:px-4"
            >
              {label}&nbsp;↗
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
