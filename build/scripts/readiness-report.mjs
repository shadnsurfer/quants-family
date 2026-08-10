#!/usr/bin/env node
/**
 * readiness-report.mjs — M8. Writes build/READINESS.md summarizing the go-live checklist and what is
 * blocked-waiting-human, then exits 20 (WAITING_HUMAN) so the loop halts by design at the finish line.
 */
import { writeFileSync, existsSync, readFileSync } from "node:fs";
const p = JSON.parse(readFileSync("build/state/progress.json","utf8"));
const confirm = (f) => existsSync(`build/state/${f}`) ? "PRESENT" : "missing";
const done = (id) => p.milestones[id]?.status === "done" ? "done" : (p.milestones[id]?.status || "pending");

const md = `# QUANTS — Go-Live Readiness

Generated ${new Date().toISOString()}

The autonomous loop has built and verified everything it can without committing real capital.
This is the finish line for autonomous work. Flipping to real money is **your** decision.

## Milestone status
${Object.keys(p.milestones).map(id=>`- ${id}: ${done(id)}`).join("\n")}

## Confirm files (you create these)
- DUST_OK: ${confirm("DUST_OK")}  — allows tiny real Pons dust launches
- X_LIVE_OK: ${confirm("X_LIVE_OK")}  — allows real X posting (else dry-run feed only)
- GO_LIVE_OK: ${confirm("GO_LIVE_OK")}  — the ONLY switch to real-money trading

## Before you create GO_LIVE_OK — human checklist (from PROJECT.md §12/§6 go-live gate)
- [ ] Agent zero funded (you set the day-one risk budget; every dollar visible on-chain)
- [ ] Wallet keys generated AND backed up offline
- [ ] System rules re-verified in code review (venue whitelist, slippage cap, thin-liquidity rule)
- [ ] Disclosures live on / and /docs
- [ ] Dust cycle verified on-chain (launch + fee-claim)
- [ ] X accounts created + warmed (agent zero + children as they're born)

## What happens when you flip GO_LIVE_OK
The safety-guard hook stops blocking MODE=live. You launch \$QUANTS — agent zero — on Pons,
agent zero posts its launch thread, and the clock starts. Every later agent is born of a quant,
never of the operator. Everything from that point is real money.

**Nothing here is financial or legal advice.**
`;
writeFileSync("build/READINESS.md", md);
console.log("wrote build/READINESS.md");
console.error("WAITING_HUMAN: readiness report ready; autonomous work complete. Review build/READINESS.md.");
process.exit(20);
