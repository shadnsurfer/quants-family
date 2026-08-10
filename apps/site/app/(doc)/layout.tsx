/**
 * Document routes: full-width footer; the header comes from the ROOT layout (so
 * its marquee persists across navigations). While COMING_SOON the docs read
 * chromeless except the ProofBar — the platform links live in the menu bar once
 * a visitor steps through the door, never on the landing page.
 */
import { ProofBar } from "@/components/soon/ProofBar";
import { SiteFooter } from "@/components/SiteFooter";
import { COMING_SOON } from "@/lib/soon";

export default function DocLayout({ children }: { children: React.ReactNode }) {
  if (COMING_SOON) {
    return (
      <div className="bg-paper text-ink">
        <ProofBar />
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
