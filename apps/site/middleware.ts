/**
 * The seal. While COMING_SOON is on, the only public rooms are `/` (the
 * incubation page) and the /docs family (the story + the technical docs) —
 * everything else redirects to `/`, and the world API answers 404. Static
 * assets and next internals pass through via the matcher below. Flip
 * COMING_SOON in lib/soon.ts to open the building.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COMING_SOON } from "@/lib/soon";

const PUBLIC_PATHS = new Set(["/", "/docs", "/health"]);

export function middleware(req: NextRequest) {
  if (!COMING_SOON) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  // the docs family (incl. /docs/technical) stays public under the seal
  if (pathname.startsWith("/docs/")) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "sealed until genesis" }, { status: 404 });
  }
  return NextResponse.redirect(new URL("/", req.url));
}

export const config = {
  matcher: [
    // everything except next internals, the brand assets, and static files
    "/((?!_next/|brand/|.*\\.(?:png|jpg|jpeg|svg|ico|webp|gif|woff2?|txt|xml|webmanifest)).*)",
  ],
};
