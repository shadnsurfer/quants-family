/**
 * Server-side data layer: reads the paper population truth produced by the orchestrator
 * (build/logs/evolution.json) plus the genesis/content seed files, fresh per request.
 * Types + pure helpers live in lib/world.ts (client-safe); this module is server-only.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { World } from "./world";

export * from "./world";

export function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

export function loadWorld(): World {
  const file = resolve(repoRoot(), "build/logs/evolution.json");
  if (!existsSync(file)) {
    return { present: false, quants: [], events: [], flows: null, simEndMs: null };
  }
  const raw = JSON.parse(readFileSync(file, "utf8"));
  return {
    present: true,
    quants: raw.quants ?? [],
    events: raw.events ?? [],
    flows: raw.flows ?? null,
    simEndMs: raw.simEndMs ?? null,
    real: raw.real === true,
    custody: raw.custody,
  };
}

export function loadContent(name: string): string {
  const file = resolve(repoRoot(), "data/content", name);
  return existsSync(file) ? readFileSync(file, "utf8").trim() : "";
}

export interface Commandment {
  num: number;
  text: string;
}

export function loadCommandments(): Commandment[] {
  const raw = loadContent("commandments.md");
  const out: Commandment[] = [];
  for (const line of raw.split("\n")) {
    const m = line.trim().match(/^(\d+)\.\s*(.+)$/);
    if (m) out.push({ num: parseInt(m[1], 10), text: m[2] });
  }
  return out;
}

export interface GenesisProfile {
  bio: string;
  mutationNote: string | null;
  examplePosts: string[];
}

export function loadProfiles(): Record<string, GenesisProfile> {
  const file = resolve(repoRoot(), "data/genesis/profiles.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}

export function loadGenesisGenome(name: string): Record<string, unknown> | null {
  const file = resolve(repoRoot(), "data/genesis", `${name}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}
