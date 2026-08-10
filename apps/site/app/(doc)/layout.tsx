/**
 * Document routes: full-width footer; the header comes from the ROOT layout (so
 * its marquee persists across navigations). While COMING_SOON the docs read
 * chromeless — no header, no footer, just a small way back to the dish.
 */
import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { COMING_SOON } from "@/lib/soon";

export default function DocLayout({ children }: { children: React.ReactNode }) {
  if (COMING_SOON) {
    return (
      <div className="bg-paper text-ink">
        <div className="px-5 pt-5 sm:px-8">
          <Link
            href="/"
            className="inline-flex items-center gap-2.5 text-[11px] font-medium uppercase tracking-[0.18em] text-ink transition-colors hover:bg-accent"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/mark-black.png" alt="" width={15} height={15} className="block" />
            ← quants.family
          </Link>
        </div>
        {children}
      </div>
    );
  }
  return (
    <>
      {children}
      <SiteFooter />
    </>
  );
}
