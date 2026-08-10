#!/usr/bin/env node
/**
 * check-dashboard.mjs — M4 referee. Probes the running dashboard on localhost:4321.
 * Fails if any required route is missing or the cruel-arena disclaimer isn't present above the fold.
 * The loop must have the site process running before this passes.
 */
const BASE = process.env.DASH_URL || "http://localhost:4321";
// /pool probe removed 2026-08-02 — the pool concept was erased from the spec (see build/state/NOTES.md)
const routes = ["/", "/tree", "/graveyard", "/q/kelly", "/dna", "/docs", "/system"];
let bad = [];

async function get(path) {
  try {
    const r = await fetch(BASE + path, { signal: AbortSignal.timeout(8000) });
    const body = await r.text();
    return { status: r.status, body };
  } catch (e) { return { status: 0, body: "", err: String(e) }; }
}

const res = await get("/");
if (res.status !== 200) {
  console.error(`dashboard not up at ${BASE} (is the site process running?) — ${res.err || res.status}`);
  process.exit(1);
}
// disclaimer must be on the landing page
if (!/most quants will die|do not bring money you cannot lose|experiment in machine evolution/i.test(res.body)) {
  bad.push("/ is missing the cruel-arena disclaimer above the fold");
}
for (const p of routes) {
  const r = await get(p);
  if (r.status !== 200) bad.push(`${p} -> HTTP ${r.status || "no response"}`);
}
if (bad.length) {
  console.error("DASHBOARD CHECK FAILED:");
  for (const b of bad) console.error("  - " + b);
  process.exit(1);
}
console.log(`dashboard ok ✓ (${routes.length} routes, disclaimer present)`);
