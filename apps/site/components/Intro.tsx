"use client";

/**
 * The boot veil + the page beneath it, choreographed together. The veil plays
 * its boot readout (mark, acid tagline, hairline, kicker), then LIFTS upwards
 * like a curtain while the page settles from a slight zoom-out into place.
 * Full sequence on every load; reduced-motion users never see it.
 *
 * phases: in (veil up, page zoomed out) → out (veil lifts, page settles)
 *         → gone (veil unmounted) → done (page transform released)
 */
import { useEffect, useState } from "react";

// the last veil element lands at ~0.98s — a breath to read it, then lift.
export const VEIL_OUT_MS = 1350; // BootLog starts typing as the veil lifts
const VEIL_GONE_MS = 1900; // out + 0.5s curtain
const VEIL_DONE_MS = 2150; // out + page settle (0.7s ease + 0.05s delay)

export function Intro({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<"in" | "out" | "gone" | "done">("in");

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPhase("done");
      return;
    }
    const t1 = setTimeout(() => setPhase("out"), VEIL_OUT_MS);
    const t2 = setTimeout(() => setPhase("gone"), VEIL_GONE_MS);
    const t3 = setTimeout(() => setPhase("done"), VEIL_DONE_MS);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  return (
    <>
      <div className={`veil-page ${phase === "out" || phase === "gone" ? "is-settled" : ""} ${phase === "done" ? "is-done" : ""}`}>
        {children}
      </div>
      {phase !== "gone" && phase !== "done" ? (
        <div className={`intro-veil ${phase === "out" ? "is-out" : ""}`} aria-hidden>
          <div className="veil-inner flex flex-col items-center gap-4">
            <div className="veil-mark">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/logo-black.png" alt="quants" width={208} height={69} className="block" />
            </div>
            <div className="veil-tag text-[14px] text-ink">
              <span className="veil-hl">bred, not hired.</span>
            </div>
            <div className="veil-rule" />
            <div className="veil-foot kicker">season zero · paper</div>
          </div>
        </div>
      ) : null}
    </>
  );
}
