/**
 * The arena's pulse: the current world, fresh from disk. Polled by the client
 * every few seconds; the daemon rewrites evolution.json every ~60s.
 */
import { loadWorld } from "@/lib/data";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(loadWorld(), {
    headers: { "cache-control": "no-store" },
  });
}
