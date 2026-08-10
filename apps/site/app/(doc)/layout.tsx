/**
 * Document routes: full-width footer; the header comes from the ROOT layout (so
 * its marquee persists across navigations). While COMING_SOON the docs read
 * chromeless — no header, no footer; the root layout's ProofBar tops the page.
 */
import { SiteFooter } from "@/components/SiteFooter";
import { COMING_SOON } from "@/lib/soon";

export default function DocLayout({ children }: { children: React.ReactNode }) {
  if (COMING_SOON) {
    return <div className="bg-paper text-ink">{children}</div>;
  }
  return (
    <>
      {children}
      <SiteFooter />
    </>
  );
}
