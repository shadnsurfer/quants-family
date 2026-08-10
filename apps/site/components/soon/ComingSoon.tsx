/**
 * The incubation page — one plain screen, no chrome, no scroll, no copy.
 * The name, a whisper of a sub-line, and two small doors centered. Nothing moves.
 * The ProofBar (root layout) carries the mark + the platform links above it.
 * Rendered at `/` while COMING_SOON.
 */
import Link from "next/link";

export function ComingSoon() {
  return (
    <main className="relative overflow-hidden bg-paper">
      <div className="relative z-10 flex min-h-[calc(100svh-53px)] flex-col items-center justify-center px-5 text-center">
        <h1
          className="intro-l1 text-[26px] normal-case tracking-[0.01em] text-ink sm:text-[30px]"
          style={{ fontFamily: "var(--font-brand), var(--font-mono), monospace" }}
        >
          Quants<span className="text-faint">.family</span>
        </h1>
        <p className="intro-l2 mt-3.5 text-[11px] font-medium uppercase tracking-[0.3em] text-faint">
          coming on robinhood chain
        </p>
        <div className="intro-actions mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-2.5 text-[11px] font-medium uppercase tracking-[0.16em] text-dim">
          <Link href="/docs" className="px-1 py-0.5 transition-colors hover:bg-accent hover:text-[var(--on-accent)]">
            what is quants.family <span aria-hidden>→</span>
          </Link>
          <a
            href="https://x.com/quantsdotfamily"
            target="_blank"
            rel="noopener noreferrer"
            className="px-1 py-0.5 transition-colors hover:bg-accent hover:text-[var(--on-accent)]"
          >
            x — @quantsdotfamily <span aria-hidden>↗</span>
          </a>
        </div>
      </div>
    </main>
  );
}
