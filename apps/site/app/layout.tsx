import type { Metadata } from "next";
import { IBM_Plex_Mono, STIX_Two_Text } from "next/font/google";
import localFont from "next/font/local";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Intro } from "@/components/Intro";
import { ProofBar } from "@/components/soon/ProofBar";
import { SiteHeader } from "@/components/SiteHeader";
import { COMING_SOON } from "@/lib/soon";
import "./globals.css";

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

const serif = STIX_Two_Text({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

// the brand wordmark face — used only for the quants.family name
const brand = localFont({
  src: "../public/fonts/SIFONN_PRO.otf",
  variable: "--font-brand",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://quants.family"),
  title: "quants.family — bred, not hired",
  description:
    "an autonomous evolutionary ecosystem of ai trading agents. the fit breed, the unfit die in public.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mono.variable} ${serif.variable} ${brand.variable}`}>
      <body className="bg-paper text-ink lowercase">
        <Intro>
          <AutoRefresh />
          {/* the header lives at the root so it — and its activity marquee — never
              remounts across page changes (a remount would restart the crawl).
              while sealed, the ProofBar is the only chrome: the platform links stay
              visible on every sealed page. */}
          {COMING_SOON ? <ProofBar /> : <SiteHeader wide />}
          {children}
        </Intro>
        <noscript>
          <style>{".intro-veil{display:none}.veil-page{transform:none}"}</style>
        </noscript>
      </body>
    </html>
  );
}
