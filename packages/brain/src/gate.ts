/**
 * LLM reasoning gate (PROJECT.md §5.1 step 3). The gate can only SHRINK or VETO the
 * deterministic signal — it can never exceed it or bypass a guardrail.
 *
 * Offline mode (default, used by all paper tests/sims): a deterministic heuristic.
 * Live mode (M6+): an Anthropic-backed implementation plugs in via `backend` — same
 * contract, still shrink-or-veto only. No network calls happen in this module by default.
 */

export interface GateSignal {
  action: "enter" | "exit" | "hold";
  symbol?: string;
  /** 0..1 conviction from the deterministic signal */
  strength: number;
  reason: string;
}

/** On-chain flow read for the candidate symbol (from the flow desk), if the quant researches flow. */
export interface FlowInput {
  /** −1..1 sell→buy imbalance */
  imbalance: number;
  /** 0..1 how much flow backs that imbalance */
  confidence: number;
  /** 0..1 accumulation pressure */
  accumulation: number;
  /** window color for the thesis (B3): distinct new holders + gross volume seen on-chain */
  newHolders?: number;
  grossVolumeWeth?: number;
}

/** How the quant weighs flow (from its research genes). */
export interface ResearchGenes {
  style: "priceAction" | "flow" | "hybrid";
  /** 0..1 strength flow moves conviction */
  flowWeight: number;
  /** 0..1 discount on flow that disagrees with the price signal */
  flowSkepticism: number;
}

export interface GateInput {
  signal: GateSignal;
  equityUsd: number;
  positionCount: number;
  /** today's P&L fraction (negative = down) */
  dayPnlPct: number;
  archetype: string;
  name: string;
  /**
   * How far underwater the agent is vs its high-water equity, 0..1 (B2b drawdown control):
   * ≥ 0.35 vetoes every new entry; 0.25/0.15 throttle size. Deep underwater, the only
   * trade is no trade.
   */
  drawdownPct?: number;
  /**
   * §5.4 memory window (compact counters + latest digest). The offline gate ignores it by
   * design — it is the M6 Anthropic backend's context seam, identical contract either way.
   */
  memory?: string;
  /** flow research context — omit for price-action quants */
  flow?: FlowInput;
  research?: ResearchGenes;
}

export interface GateDecision {
  decision: "approve" | "veto";
  /** 0.5–1.0 multiplier on the deterministic size (never above 1) */
  sizeMult: number;
  /** one-line thesis in the quant's own voice-neutral words (composer adds voice) */
  thesis: string;
}

export type GateBackend = (input: GateInput) => Promise<GateDecision>;

/** Clamp any backend output into the shrink-or-veto contract. */
export function clampDecision(d: GateDecision): GateDecision {
  return {
    decision: d.decision === "veto" ? "veto" : "approve",
    sizeMult: Math.min(1, Math.max(0.5, d.sizeMult)),
    thesis: d.thesis.slice(0, 200),
  };
}

/**
 * Flow adjustment (shrink-or-veto preserving): a flow-researching quant lets on-chain flow
 * VETO a trade it dislikes or shrink size when flow disagrees. Flow can never ADD size beyond
 * the price signal or originate a trade — it only tightens the gate. Skepticism discounts
 * flow that opposes the price signal; agreeing flow is trusted at face value.
 */
function flowAdjust(baseMult: number, input: GateInput): { mult: number; veto: boolean; note: string } {
  const { flow, research } = input;
  if (!flow || !research || research.style === "priceAction" || research.flowWeight <= 0) {
    return { mult: baseMult, veto: false, note: "" };
  }
  // agreeing flow (buy pressure for a long entry) is positive; opposing flow is discounted
  const agrees = flow.accumulation - 0.5; // >0 accumulation, <0 distribution
  const trusted = agrees < 0 ? agrees * (1 - research.flowSkepticism) : agrees;
  const effect = trusted * flow.confidence * research.flowWeight; // −0.5..0.5-ish
  // window color for the thesis: holder growth + volume make the flow read concrete (B3)
  const color = [
    flow.newHolders !== undefined ? `${flow.newHolders} new holders` : "",
    flow.grossVolumeWeth !== undefined ? `${flow.grossVolumeWeth.toFixed(1)} weth vol` : "",
  ].filter(Boolean).join(", ");
  const seen = color ? ` (${color})` : "";
  // strong distribution under a confident, flow-heavy quant → veto
  if (effect <= -0.3) {
    return { mult: baseMult, veto: true, note: `on-chain flow distributing (imb ${flow.imbalance.toFixed(2)})${seen}` };
  }
  const mult = Math.min(1, Math.max(0.5, baseMult * (1 + effect)));
  const note =
    effect > 0.02 ? `flow confirms accumulation (imb ${flow.imbalance.toFixed(2)})${seen}` :
    effect < -0.02 ? `flow soft, sized down (imb ${flow.imbalance.toFixed(2)})${seen}` : "";
  return { mult, veto: false, note };
}

function offlineGate(input: GateInput): GateDecision {
  const { signal } = input;
  if (signal.action !== "enter" || !signal.symbol) {
    return { decision: "veto", sizeMult: 0.5, thesis: "no actionable signal" };
  }
  if (signal.strength < 0.25) {
    return { decision: "veto", sizeMult: 0.5, thesis: `signal on ${signal.symbol} too weak vs costs` };
  }
  // drawdown control (B2b): deep underwater, the only trade is no trade
  const dd = input.drawdownPct ?? 0;
  if (dd >= 0.35) {
    return { decision: "veto", sizeMult: 0.5, thesis: `${signal.reason}; vetoed: -${Math.round(dd * 100)}% from my peak — protecting what's left` };
  }
  let sizeMult = 0.5 + 0.5 * Math.min(1, signal.strength);
  if (input.dayPnlPct < -0.04) sizeMult = Math.max(0.5, sizeMult * 0.75);

  const flow = flowAdjust(sizeMult, input);
  if (flow.veto) {
    return { decision: "veto", sizeMult: 0.5, thesis: `${signal.reason}; vetoed: ${flow.note}` };
  }
  // drawdown throttle: trim, then halve, as the hole deepens
  let mult = flow.mult;
  let ddNote = "";
  if (dd >= 0.25) {
    mult = Math.max(0.5, mult * 0.5);
    ddNote = `drawdown -${Math.round(dd * 100)}%: half size`;
  } else if (dd >= 0.15) {
    mult = Math.max(0.5, mult * 0.75);
    ddNote = `drawdown -${Math.round(dd * 100)}%: trimmed`;
  }
  return {
    decision: "approve",
    sizeMult: Math.min(1, mult),
    thesis: [signal.reason, flow.note, ddNote].filter(Boolean).join("; "),
  };
}

export async function reasoningGate(input: GateInput, opts: { backend?: GateBackend } = {}): Promise<GateDecision> {
  if (opts.backend) {
    return clampDecision(await opts.backend(input));
  }
  return clampDecision(offlineGate(input));
}
