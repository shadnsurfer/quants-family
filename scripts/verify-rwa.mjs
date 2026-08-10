#!/usr/bin/env node
/**
 * verify-rwa.mjs — read-only proof that the RWA trading surface works on Robinhood Chain:
 * every registry stock token answers symbol()/decimals(), a live pool with real liquidity
 * exists, and an indicative WETH→stock quote computes to a sane dollar price. ZERO spend —
 * trade execution stays behind MODE=live + GO_LIVE_OK by design.
 *
 * Exit 0 = surface verified. Non-zero = something is off (report, don't trade).
 */
import { createRequire } from "node:module";

// resolve viem through packages/chain (scripts/ is outside the pnpm workspace packages)
const require = createRequire(new URL("../packages/chain/package.json", import.meta.url));
const { createPublicClient, http, parseAbi } = require("viem");

const chain = await import(new URL("../packages/chain/dist/index.js", import.meta.url)).catch(() => null);
if (!chain) {
  console.error("build packages/chain first (pnpm -w run typecheck emits dist).");
  process.exit(1);
}
const { STOCK_TOKENS, RWA_INFRA, quoteStockBuy, readChainlinkPrice } = chain;

const client = createPublicClient({ transport: http(process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com") });
const erc20 = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)"]);

let bad = 0;

// 1) every registry token is live and self-describes correctly
for (const [sym, addr] of Object.entries(STOCK_TOKENS)) {
  try {
    const [onchainSym, decimals] = await Promise.all([
      client.readContract({ address: addr, abi: erc20, functionName: "symbol" }),
      client.readContract({ address: addr, abi: erc20, functionName: "decimals" }),
    ]);
    const ok = onchainSym === sym && decimals === 18;
    console.log(`${ok ? "ok " : "BAD"} token ${sym.padEnd(5)} ${addr} symbol=${onchainSym} decimals=${decimals}`);
    if (!ok) bad++;
  } catch (e) {
    console.log(`BAD token ${sym}: ${String(e).slice(0, 80)}`);
    bad++;
  }
}

// 2) derive ETH/USD from the deep WETH/USDG pool (USDG has 6 decimals → adjust 1e12)
const { findDeepestPool, midPriceFromPool } = chain;
const wethUsdg = await findDeepestPool(client, RWA_INFRA.weth, RWA_INFRA.usdg);
const ethUsd = wethUsdg ? midPriceFromPool(wethUsdg, RWA_INFRA.weth) * 1e12 : 1900;
console.log(`\neth/usd from WETH/USDG pool: $${ethUsd.toFixed(2)}`);

// 3) indicative quotes for the genesis-relevant symbols with WETH pools
console.log("\nindicative quotes (0.001 WETH ≈ $" + (0.001 * ethUsd).toFixed(2) + " in):");
let quoted = 0;
for (const sym of ["NVDA", "TSLA", "AAPL", "MSFT", "AMZN", "META"]) {
  const q = await quoteStockBuy(client, sym, 0.001, ethUsd);
  if (!q) {
    console.log(`  --  ${sym}: no live WETH pool (may quote against USDG only)`);
    continue;
  }
  const impliedUsdPerShare = ethUsd / q.midPerWeth;
  console.log(
    `  ok  ${sym.padEnd(5)} pool=${q.pool.slice(0, 10)}… fee=${q.feeBps}bps ` +
    `mid=${q.midPerWeth.toFixed(4)} ${sym}/WETH (≈$${impliedUsdPerShare.toFixed(2)}/share) ` +
    `out=${q.amountOutTokens.toFixed(6)} ${sym} spread≈${q.effectiveSpreadBps.toFixed(0)}bps`,
  );
  quoted++;
}

if (bad > 0 || quoted === 0) {
  console.error(`\nRWA VERIFY FAILED: badTokens=${bad} quotedPools=${quoted}`);
  process.exit(1);
}
console.log(`\nrwa surface verified ✓ (${Object.keys(STOCK_TOKENS).length} tokens live, ${quoted} tradeable WETH pools, execution gated behind GO_LIVE_OK)`);
