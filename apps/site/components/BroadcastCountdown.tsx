"use client";

/** Live countdown to the next state-of-the-species broadcast (sunday 18:00 utc). */
import { useEffect, useState } from "react";
import { fmtCountdown, nextBroadcastMs } from "@/lib/world";

export function BroadcastCountdown() {
  // mount-gated: Date.now() differs between SSR and hydration — render nothing
  // until the client clock owns the label (avoids a hydration mismatch error)
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setLabel(fmtCountdown(nextBroadcastMs(Date.now()) - Date.now()));
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="tabular-nums">{label ?? "…"}</span>;
}
