import { Arena } from "@/components/arena/Arena";
import type { RailTab } from "@/components/arena/ArenaRail";
import { ComingSoon } from "@/components/soon/ComingSoon";
import { loadWorld } from "@/lib/data";
import { COMING_SOON } from "@/lib/soon";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ rail?: string }> }) {
  // the seal: while COMING_SOON, `/` is the incubation page and the arena
  // below stays dark. flip lib/soon.ts at genesis and the show returns.
  if (COMING_SOON) return <ComingSoon />;

  const { rail } = await searchParams;
  const initialTab: RailTab =
    rail === "graves" || rail === "mutations" || rail === "board" ? rail : "activity";
  const world = loadWorld();

  return <Arena initialWorld={world} initialTab={initialTab} />;
}
