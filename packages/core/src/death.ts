/**
 * Death triggers (PROJECT.md §4.5) — checked every loop, instant. Boundary semantics:
 *   ruin:       equity ≤ DEATH.ruinEquityFractionOfSeed × seed   (exactly 35% of seed → DEAD)
 *   starvation: equity + unclaimedFees < DEATH.starvationRunwayDays × dailyBurn
 *               (exactly 7 days of runway → alive)
 * Ruin is evaluated first; a quant that is both ruined and starving dies of ruin.
 */
import { DEATH } from "./constants.js";
import type { DeathInput, DeathVerdict } from "./types.js";

export function deathCheck(input: DeathInput): DeathVerdict {
  if (input.equityUsd <= DEATH.ruinEquityFractionOfSeed * input.seedUsd) {
    return { dead: true, cause: "ruin" };
  }
  const runwayNeededUsd = DEATH.starvationRunwayDays * input.dailyBurnUsd;
  if (input.dailyBurnUsd > 0 && input.equityUsd + input.unclaimedFeesUsd < runwayNeededUsd) {
    return { dead: true, cause: "starvation" };
  }
  return { dead: false, cause: null };
}
