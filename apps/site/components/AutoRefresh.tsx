"use client";

/**
 * Keeps the terminal honest: re-fetches the server-rendered world every 30s.
 * The daemon rewrites evolution.json every 60s; this just turns the page over.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [router, intervalMs]);
  return null;
}
