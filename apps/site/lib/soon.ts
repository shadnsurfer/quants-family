/**
 * The coming-soon switch. ON by default: `/` renders the incubation page,
 * every other route except /docs (+assets, /health) is sealed by middleware,
 * and the chrome greys its nav.
 *
 * Runtime-controlled so one build can serve both faces side by side:
 *   - production / quants.family: default (or COMING_SOON=1) — the seal
 *   - local full-site preview:    COMING_SOON=off — the whole building opens
 *
 * At genesis, ship with COMING_SOON=off (or delete the gate entirely).
 */
export const COMING_SOON = process.env.COMING_SOON !== "off";
