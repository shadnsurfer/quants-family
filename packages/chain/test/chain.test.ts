/**
 * @quants/chain suite (M5): PonsMock lifecycle (the CI stand-in for the launchpad),
 * chain-def and ABI-artifact validation (the refuse-to-guess safety posture), and the
 * pure calldata/price math. No network calls anywhere.
 */
import { describe, expect, it } from "vitest";
import {
  PonsMock, decodeChainlinkAnswer, encodeWethDeposit, encodeWethWithdraw,
  estimateSpreadBps, explorerAddressUrl, explorerTxUrl, priceFromSqrtX96,
  robinhoodChain, validateArtifact,
} from "../src/index.js";

const WALLET = "0x000000000000000000000000000000000000dEaD" as const;

describe("PonsMock — launch", () => {
  it("launch returns token/pool/tx, deterministic across instances", async () => {
    const a = await new PonsMock().launch({ name: "dust0", ticker: "DUST0" }, WALLET, 0.0002);
    const b = await new PonsMock().launch({ name: "dust0", ticker: "DUST0" }, WALLET, 0.0002);
    expect(a).toEqual(b);
    expect(a.tokenAddr).toMatch(/^0x[0-9a-f]{40}$/);
    expect(a.poolAddr).toMatch(/^0x[0-9a-f]{40}$/);
    expect(a.tokenAddr).not.toBe(a.poolAddr);
  });

  it("different names → different addresses", async () => {
    const pons = new PonsMock();
    const a = await pons.launch({ name: "alpha", ticker: "ALPHA" }, WALLET, 0);
    const b = await pons.launch({ name: "beta", ticker: "BETA" }, WALLET, 0);
    expect(a.tokenAddr).not.toBe(b.tokenAddr);
  });

  it("re-launching the same name throws; bad meta throws; negative devBuy throws", async () => {
    const pons = new PonsMock();
    await pons.launch({ name: "gamma", ticker: "GAMMA" }, WALLET, 0);
    await expect(pons.launch({ name: "gamma", ticker: "GAMMA" }, WALLET, 0)).rejects.toThrow(/already launched/);
    await expect(pons.launch({ name: "", ticker: "X" }, WALLET, 0)).rejects.toThrow(/required/);
    await expect(pons.launch({ name: "d", ticker: "D" }, WALLET, -1)).rejects.toThrow(/≥ 0/);
  });
});

describe("PonsMock — fee lifecycle", () => {
  it("accrue → read → claim → zero; claimed totals accumulate; unknown token throws", async () => {
    const pons = new PonsMock("fees");
    const { tokenAddr } = await pons.launch({ name: "delta", ticker: "DELTA" }, WALLET, 0);

    expect(await pons.readCreatorFees(tokenAddr)).toEqual({ tokenFees: 0, wethFees: 0 });
    pons.accrueFees(tokenAddr, 12.34, 0.005);
    pons.accrueFees(tokenAddr, 0.66, 0.001);
    expect(await pons.readCreatorFees(tokenAddr)).toEqual({ tokenFees: 13, wethFees: 0.006 });

    const claim = await pons.claimFees(tokenAddr);
    expect(claim.tokenFees).toBe(13);
    expect(claim.wethFees).toBe(0.006);
    expect(claim.tx).toMatch(/^0x[0-9a-f]{64}$/);

    expect(await pons.readCreatorFees(tokenAddr)).toEqual({ tokenFees: 0, wethFees: 0 });
    expect(pons.totalClaimed(tokenAddr)).toEqual({ tokenFees: 13, wethFees: 0.006 });

    await expect(pons.readCreatorFees("0x0000000000000000000000000000000000000001")).rejects.toThrow(/unknown token/);
  });

  it("seeded accrual with no explicit amounts is deterministic", async () => {
    const run = async () => {
      const pons = new PonsMock(42);
      const { tokenAddr } = await pons.launch({ name: "eps", ticker: "EPS" }, WALLET, 0);
      pons.accrueFees(tokenAddr);
      pons.accrueFees(tokenAddr);
      return pons.readCreatorFees(tokenAddr);
    };
    expect(await run()).toEqual(await run());
  });

  it("launchedTokens exposes the registry for the dress rehearsal", async () => {
    const pons = new PonsMock();
    await pons.launch({ name: "zeta", ticker: "ZETA" }, WALLET, 0.001);
    const tokens = pons.launchedTokens();
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.meta.ticker).toBe("ZETA");
    expect(tokens[0]!.feeWallet).toBe(WALLET);
    expect(tokens[0]!.devBuyEth).toBe(0.001);
  });
});

describe("robinhoodChain — env validation", () => {
  it("builds a viem chain from env", () => {
    const chain = robinhoodChain({ rpcUrl: "https://rpc.example", chainId: 4321 });
    expect(chain.id).toBe(4321);
    expect(chain.rpcUrls.default.http[0]).toBe("https://rpc.example");
    expect(chain.blockExplorers?.default.url).toContain("robinhoodchain.blockscout.com");
  });

  it("rejects bad env instead of guessing", () => {
    expect(() => robinhoodChain({ rpcUrl: "", chainId: 1 })).toThrow(/RPC_URL/);
    expect(() => robinhoodChain({ rpcUrl: "ftp://x", chainId: 1 })).toThrow(/RPC_URL/);
    expect(() => robinhoodChain({ rpcUrl: "https://ok", chainId: 0 })).toThrow(/CHAIN_ID/);
    expect(() => robinhoodChain({ rpcUrl: "https://ok", chainId: 1.5 })).toThrow(/CHAIN_ID/);
  });

  it("explorer links point at blockscout", () => {
    expect(explorerTxUrl("0xabc")).toBe("https://robinhoodchain.blockscout.com/tx/0xabc");
    expect(explorerAddressUrl("0xdef")).toBe("https://robinhoodchain.blockscout.com/address/0xdef");
  });
});

describe("validateArtifact — the refuse-to-guess gate for real funds", () => {
  const okArtifact = {
    network: { chainId: 4663, rpcUrl: "https://rpc.mainnet.chain.robinhood.com" },
    factoryAddr: "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB",
    lockerAddr: "0x736D76699C26D0d966744cAe304C000d471f7F35",
    factoryAbi: [
      { type: "function", name: "launchToken", stateMutability: "payable", inputs: [], outputs: [] },
      { type: "event", name: "TokenLaunched", inputs: [] },
    ],
    lockerAbi: [
      { type: "function", name: "collectFees", stateMutability: "nonpayable", inputs: [], outputs: [] },
    ],
    launchFunction: "launchToken",
    claimFunction: "collectFees",
    launchEvent: "TokenLaunched",
    launchConfigId: 0,
    dexId: 0,
  };

  it("accepts a complete artifact", () => {
    expect(() => validateArtifact(okArtifact)).not.toThrow();
  });

  it("accepts the REAL research artifact on disk (data/chain/pons-abi.json)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const artifact = JSON.parse(readFileSync(resolve(root, "data/chain/pons-abi.json"), "utf8"));
    const validated = validateArtifact(artifact);
    expect(validated.factoryAddr).toBe("0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB");
    expect(validated.lockerAddr).toBe("0x736D76699C26D0d966744cAe304C000d471f7F35");
    expect(validated.network.chainId).toBe(4663);
    // the launch function's TokenParams tuple must carry the fee wallet (immutable at launch)
    const launchFn = validated.factoryAbi.find(
      (e) => "name" in e && e.name === "launchToken" && e.type === "function",
    ) as { inputs: Array<{ name: string; type: string; components?: Array<{ name: string }> }> };
    expect(launchFn.inputs[0]!.components!.some((c) => c.name === "feeWallet")).toBe(true);
  });

  it("rejects missing fields, empty abis, bad addresses, and functions absent from their abi", () => {
    expect(() => validateArtifact(null)).toThrow(/not an object/);
    expect(() => validateArtifact({ ...okArtifact, factoryAbi: [] })).toThrow(/factoryAbi/);
    expect(() => validateArtifact({ ...okArtifact, lockerAbi: [] })).toThrow(/lockerAbi/);
    expect(() => validateArtifact({ ...okArtifact, factoryAddr: "0x123" })).toThrow(/factoryAddr/);
    expect(() => validateArtifact({ ...okArtifact, network: undefined })).toThrow(/network/);
    expect(() => validateArtifact({ ...okArtifact, launchFunction: "" })).toThrow(/launchFunction/);
    expect(() => validateArtifact({ ...okArtifact, launchFunction: "notInAbi" })).toThrow(/refusing to guess/);
    expect(() => validateArtifact({ ...okArtifact, claimFunction: "launchToken" })).toThrow(/refusing to guess/);
    expect(() => validateArtifact({ ...okArtifact, launchEvent: "Nope" })).toThrow(/refusing to guess/);
    expect(() => validateArtifact({ ...okArtifact, launchConfigId: 1.5 })).toThrow(/launchConfigId/);
  });
});

describe("pure math — weth calldata, chainlink decode, spread estimate", () => {
  it("weth deposit/withdraw calldata are golden", () => {
    expect(encodeWethDeposit()).toBe("0xd0e30db0");
    // withdraw(uint256) selector 0x2e1a7d4d + 1 ETH = 0de0b6b3a7640000 left-padded
    expect(encodeWethWithdraw(1)).toBe(
      "0x2e1a7d4d0000000000000000000000000000000000000000000000000de0b6b3a7640000",
    );
  });

  it("chainlink answers decode at feed decimals; bad decimals throw", () => {
    expect(decodeChainlinkAnswer(19012345678n, 8)).toBeCloseTo(190.12345678, 9);
    expect(decodeChainlinkAnswer(-5n, 0)).toBe(-5);
    expect(() => decodeChainlinkAnswer(1n, -1)).toThrow(RangeError);
    expect(() => decodeChainlinkAnswer(1n, 31)).toThrow(RangeError);
  });

  it("spread estimate: fee tier floor, linear impact, untradeable when empty", () => {
    expect(estimateSpreadBps(0, 1_000_000, 30)).toBe(30);
    expect(estimateSpreadBps(10_000, 1_000_000, 30)).toBeCloseTo(130, 9); // 1% of liquidity = 100bps + fee
    expect(estimateSpreadBps(10_000, 0, 30)).toBe(10_000);
  });

  it("priceFromSqrtX96 round-trips a known price", () => {
    const sqrtPriceX96 = BigInt(Math.round(Math.sqrt(1.5) * 2 ** 96));
    expect(priceFromSqrtX96(sqrtPriceX96)).toBeCloseTo(1.5, 6);
  });
});
