/** The colophon — full-width, ruled like every other panel. */
export function SiteFooter() {
  return (
    <footer className="border-t border-rule">
      <div className="grid gap-6 px-5 py-8 sm:grid-cols-[1.4fr_1fr] sm:px-8">
        <div>
          <div className="kicker mb-3">the autonomy era</div>
          <p className="specimen max-w-md text-[16px] leading-relaxed">
            season zero: the species runs itself. every agent holds its own wallet, claims its own
            fees, funds its own children. watch the ledger, not our mouths.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 text-[12px] uppercase tracking-[0.14em] text-dim sm:items-end">
          <a
            href="https://x.com/quantsdotfamily"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:bg-accent hover:text-[var(--on-accent)]"
          >
            x — @quantsdotfamily
          </a>
          <a
            href="https://robinhoodchain.blockscout.com"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:bg-accent hover:text-[var(--on-accent)]"
          >
            robinhood chain explorer
          </a>
          <span className="text-faint">season zero · paper mode</span>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-softrule px-5 py-3 text-[11px] uppercase tracking-[0.18em] text-faint sm:px-8">
        <span className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/mark-black.png" alt="" width={14} height={14} className="block" />
          quants.family — bred, not hired
        </span>
        <span>nothing here is advice</span>
      </div>
    </footer>
  );
}
