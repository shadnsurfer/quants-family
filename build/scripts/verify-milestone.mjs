#!/usr/bin/env node
/**
 * verify-milestone.mjs — the ground truth of the autonomous loop.
 *
 * Parses build/MILESTONES.md, finds the active (first not-done) milestone,
 * runs its `verify:` commands in order, and updates build/state/progress.json.
 *
 * Exit 0  => active milestone verified DONE (or the whole build is complete)
 * Exit 10 => active milestone NOT done yet (loop must continue)
 * Exit 20 => active milestone is blocked-waiting-human (loop continues to other work / or halts at M8)
 *
 * This script is the referee. The Stop hook calls it. Claude does not get to
 * declare victory — this does.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PROGRESS = resolve(ROOT, "build/state/progress.json");
const MILES = resolve(ROOT, "build/MILESTONES.md");

function parseMilestones(md) {
  // Extract blocks starting "## " with id/deps/verify/gate.
  const blocks = md.split(/\n## /).slice(1);
  const out = [];
  for (const b of blocks) {
    const idMatch = b.match(/- id:\s*([a-z0-9-]+)/i);
    if (!idMatch) continue;
    const id = idMatch[1].trim();
    const verify = [];
    const vSection = b.split(/- verify:/)[1];
    if (vSection) {
      const gateSplit = vSection.split(/- gate:/)[0];
      for (const line of gateSplit.split("\n")) {
        const m = line.match(/^\s*-\s*`([^`]+)`/);
        if (m) verify.push(m[1]);
      }
    }
    const blockedManual = /blocked-waiting-human|Skipped automatically|halts here by design/i.test(b);
    out.push({ id, verify, blockedManual });
  }
  return out;
}

function load(p) { return JSON.parse(readFileSync(p, "utf8")); }
function save(p, o) { o.updatedAt = new Date().toISOString(); writeFileSync(p, JSON.stringify(o, null, 2) + "\n"); }

const progress = load(PROGRESS);
const milestones = parseMilestones(readFileSync(MILES, "utf8"));

// --dry: parse-only mode (used by selfcheck.sh). Proves MILESTONES.md parses and progress.json loads.
// Runs no verify commands and mutates nothing — a full run here would recurse: the M0 verify list
// invokes selfcheck.sh, which invokes this script with --dry.
if (process.argv.includes("--dry")) {
  for (const m of milestones) console.log(`${m.id}: ${m.verify.length} verify cmds${m.blockedManual ? " (human-gated)" : ""}`);
  process.exit(milestones.length > 0 ? 0 : 1);
}

// Confirm files that can unblock a human-gated milestone.
const CONFIRM_FILES = {
  "m5-chain-dust": resolve(ROOT, "build/state/DUST_OK"),
};

const statusOf = (id) => progress.milestones[id]?.status ?? "pending";

// Milestone selection:
//   1. a blocked-waiting-human milestone whose confirm file has APPEARED gets re-verified first;
//   2. otherwise the first milestone that is neither done nor blocked-waiting-human
//      (blocked ones must not trap the loop — CLAUDE.md: mark blocked and proceed to M6+);
//   3. nothing runnable left: all-done exit 0, or blocked-only exit 20 (waiting on the human).
let active = milestones.find(
  (m) => statusOf(m.id) === "blocked-waiting-human" && CONFIRM_FILES[m.id] && existsSync(CONFIRM_FILES[m.id]),
);
active ??= milestones.find((m) => statusOf(m.id) !== "done" && statusOf(m.id) !== "blocked-waiting-human");

if (!active) {
  const blocked = milestones.filter((m) => statusOf(m.id) === "blocked-waiting-human").map((m) => m.id);
  if (blocked.length) {
    // point activeMilestone at the blocked gate so the Stop hook can recognize the
    // by-design M8 halt (it checks activeMilestone + exit 20) instead of looping forever
    progress.activeMilestone = blocked[blocked.length - 1];
    save(PROGRESS, progress);
    console.log(`ALL_RUNNABLE_DONE — waiting on human confirm files for: ${blocked.join(", ")}`);
    process.exit(20);
  }
  console.log("ALL_MILESTONES_DONE");
  process.exit(0);
}

progress.activeMilestone = active.id;
const rec = progress.milestones[active.id] ??= { status: "pending", attempts: 0, lastError: null };
rec.status = "verifying";
rec.attempts += 1;

let allPass = true;
let firstError = null;

for (const cmd of active.verify) {
  try {
    execSync(cmd, { cwd: ROOT, stdio: "pipe", timeout: 1000 * 60 * 20, shell: "/bin/bash" });
  } catch (e) {
    // If the failure is a dust/live gate waiting on a human confirm file, mark blocked, don't fail.
    const stderr = (e.stderr?.toString() || "") + (e.stdout?.toString() || "");
    if (/WAITING_HUMAN|NO_CONFIRM_FILE/.test(stderr)) {
      rec.status = "blocked-waiting-human";
      rec.lastError = "waiting on human confirmation file";
      save(PROGRESS, progress);
      console.log(`BLOCKED_WAITING_HUMAN ${active.id}`);
      process.exit(20);
    }
    allPass = false;
    firstError = `CMD FAILED: ${cmd}\n${stderr.slice(-4000)}`;
    break;
  }
}

if (allPass) {
  rec.status = "done";
  rec.lastError = null;
  save(PROGRESS, progress);
  console.log(`MILESTONE_DONE ${active.id}`);
  // If that was the last, signal completion; else keep looping (there's more to do).
  const stillOpen = milestones.some(m => (progress.milestones[m.id]?.status ?? "pending") !== "done");
  process.exit(stillOpen ? 10 : 0);
} else {
  rec.status = "failed";
  rec.lastError = firstError;
  save(PROGRESS, progress);
  console.log(`MILESTONE_FAILED ${active.id}`);
  console.log(firstError);
  process.exit(10);
}
