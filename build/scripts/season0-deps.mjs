/**
 * season0-deps.mjs — shared wiring for the season-0 genesis + daemon scripts.
 * Builds the Season0Deps object (apps/system season0.ts) from the built packages:
 * live prices, the real Pons launcher (dust key), on-chain fee reads/claims with
 * custody-aware signing, custody birth wallets (CUSTODY_MODE: local keystore or Turnkey
 * enclave), and the dust budget reader.
 *
 * SPENDS REAL (dust) FUNDS through PonsLive — gated by build/state/DUST_OK, which the
 * caller must verify before calling buildDeps({ allowSpend: true }).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnv(ROOT) {
  const envPath = resolve(ROOT, ".env");
  const out = { ...process.env };
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(?:#.*)?$/);
      if (m && !(m[1] in process.env)) out[m[1]] = m[2];
    }
  }
  return out;
}

export async function buildDeps({ ROOT, env, log = (s) => console.log(s) }) {
  const chain = await import(new URL("../../packages/chain/dist/index.js", import.meta.url));
  const missing = ["RPC_URL", "CHAIN_ID", "DUST_PRIVATE_KEY"].filter((k) => !env[k]);
  if (missing.length) throw new Error(`.env incomplete for season 0: missing ${missing.join(", ")}`);

  const chainEnv = { rpcUrl: env.RPC_URL, chainId: Number(env.CHAIN_ID) };
  const abiPath = resolve(ROOT, "data/chain/pons-abi.json");
  const artifact = chain.validateArtifact(JSON.parse(readFileSync(abiPath, "utf8")));

  const publicClient = chain.chainPublicClient(chainEnv);
  const prices = new chain.LivePrices(publicClient);
  const dust = chain.walletOps({ ...chainEnv, privateKey: env.DUST_PRIVATE_KEY });
  const ponsDust = new chain.PonsLive({ ...chainEnv, artifact, privateKey: env.DUST_PRIVATE_KEY });

  const KEYSTORE_DIR = resolve(ROOT, "data/keystore");
  // local custody only: birth-time wallet minting must never block on a human — env secret if
  // set, else the machine secret file. turnkey custody needs no secret: keys live in enclaves.
  const localCustody = chain.custodyMode(env) === "local";
  const passphrase = localCustody ? chain.ensureKeystoreSecret(KEYSTORE_DIR, env.KEYSTORE_PASSPHRASE) : undefined;
  log(`custody mode: ${chain.custodyMode(env)}${localCustody ? ` (secret: ${env.KEYSTORE_PASSPHRASE ? "env KEYSTORE_PASSPHRASE" : "machine secret file"})` : " — keys created + signing inside Turnkey enclaves"}`);

  // token USD valuation for fee reads: each quant token's own Pons pool (token/WETH), cached token0
  const token0Cache = new Map();
  async function tokenPriceUsd(tokenAddr, poolAddr) {
    try {
      const state = await chain.readPoolState(publicClient, poolAddr);
      let token0 = token0Cache.get(poolAddr);
      if (!token0) {
        token0 = await publicClient.readContract({
          address: poolAddr,
          abi: [{ type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }],
          functionName: "token0",
        });
        token0Cache.set(poolAddr, token0);
      }
      const info = { pool: poolAddr, feeBps: 100, liquidity: state.liquidity, sqrtPriceX96: state.sqrtPriceX96, token0 };
      const perWeth = chain.midPriceFromPool(info, tokenAddr); // token price in WETH
      return perWeth * prices.ethUsd;
    } catch {
      return 0; // valueless until the pool is readable — fees then count only their WETH leg
    }
  }

  /** custody is decided by the genesis probe and stored in the world state */
  let custody = "unknown";

  async function readFeesRaw(q) {
    // try the dust seat first, then impersonate the fee wallet (eth_call — free, keyless)
    try {
      return await ponsDust.readCreatorFees(q.tokenAddr);
    } catch {
      return await ponsDust.readCreatorFees(q.tokenAddr, q.walletAddr);
    }
  }

  async function feesToUsd(q, fees) {
    const wethUsd = fees.wethFees * prices.ethUsd;
    const tokUsd = fees.tokenFees > 0 ? fees.tokenFees * (await tokenPriceUsd(q.tokenAddr, q.poolAddr)) : 0;
    return wethUsd + tokUsd;
  }

  // B4: the X layer. LIVE only when build/state/X_LIVE_OK exists; per-account creds come from
  // env (X_ACCT_<HANDLE>="key:secret:token:secret"). Otherwise a dry-run client records every
  // would-be post to build/logs/x-dryrun.jsonl — the full social pipeline runs with no accounts.
  const social = await import(new URL("../../packages/social/dist/index.js", import.meta.url));
  const X_LIVE = existsSync(resolve(ROOT, "build/state/X_LIVE_OK"));
  let x, xAccounts;
  if (X_LIVE) {
    const credsFor = social.credsFromEnv(env);
    x = new social.XApiClient(credsFor);
    const handles = Object.keys(env)
      .filter((k) => k.startsWith("X_ACCT_") && credsFor(k.slice(7)))
      .map((k) => k.slice(7).toLowerCase());
    xAccounts = (h) => handles.includes(String(h).toLowerCase());
    log(`X LIVE: ${handles.length} account(s) with credentials${handles.length === 0 ? " — X_LIVE_OK present but no X_ACCT_* env!" : ""}`);
  } else {
    x = new social.DryRunXClient(resolve(ROOT, "build/logs/x-dryrun.jsonl"));
    xAccounts = () => true; // dry-run: every agent "has" an account
    log("X dry-run (no X_LIVE_OK): posts record to build/logs/x-dryrun.jsonl");
  }
  // the content guard retires only by explicit env (owner decision 2026-08-02 — default stays
  // guarded until the env flips it)
  const tweetGuard = env.QUANTS_TWEET_GUARD !== "0";
  log(`tweet guard: ${tweetGuard ? "ON" : "OFF (retired by env)"}`);

  const deps = {
    prices,
    birthPons: {
      launch: (meta, feeWallet, devBuyEth) => ponsDust.launch(meta, feeWallet, devBuyEth),
    },
    // B3: the live flow desk — real on-chain order flow (Swap/Transfer logs) into the
    // research genes. Pools resolve lazily through a self-warming cache (sync interface):
    // a miss returns null (zero-confidence read, the gate ignores it) and resolves async
    // for the next tick; failures retry after 10 min, successes re-verify daily.
    flowDesk: new chain.LiveFlowDesk(publicClient, (() => {
      const cache = new Map(); // symbol → { value: {pool,token,tokenIsToken0}|null, atMs }
      const resolvePool = async (key) => {
        const token = chain.stockTokenAddr(key);
        if (!token) return null;
        const info = (await chain.findDeepestPool(publicClient, token, chain.RWA_INFRA.usdg))
          ?? (await chain.findDeepestPool(publicClient, token, chain.RWA_INFRA.weth));
        if (!info) return null;
        return { pool: info.pool, token, tokenIsToken0: info.token0.toLowerCase() === token.toLowerCase() };
      };
      return (symbol) => {
        const key = symbol.toUpperCase();
        const hit = cache.get(key);
        const now = Date.now();
        const stale = !hit || (hit.value === null && now - hit.atMs > 10 * 60_000) || (hit.value !== null && now - hit.atMs > 24 * 3_600_000);
        if (stale) {
          cache.set(key, { value: hit?.value ?? null, atMs: now });
          resolvePool(key)
            .then((v) => { if (v) cache.set(key, { value: v, atMs: Date.now() }); })
            .catch(() => {});
        }
        return cache.get(key)?.value ?? null;
      };
    })()),
    async readFeesUsd(q) {
      const fees = await readFeesRaw(q);
      return feesToUsd(q, fees);
    },
    async claimFees(q) {
      const fees = await readFeesRaw(q);
      const claimedUsd = await feesToUsd(q, fees);
      if (custody === "quant-key-claims") {
        // the locker pays the caller → the claim MUST be signed by the quant's own wallet
        // (resolved under the active CUSTODY_MODE — local keystore or Turnkey enclave)
        const account = chain.resolveCustodyAccount(q.id, { keystoreDir: KEYSTORE_DIR, passphrase, env });
        const quantOps = chain.walletOps({ ...chainEnv, account });
        if ((await quantOps.balanceEth()) < 0.00003) {
          await dust.sendEth(q.walletAddr, 0.0001);
          log(`gas top-up 0.0001 ETH → ${q.id}`);
        }
        const ponsQuant = new chain.PonsLive({ ...chainEnv, artifact, account });
        const claim = await ponsQuant.claimFees(q.tokenAddr);
        return { tx: claim.tx, claimedUsd };
      }
      const claim = await ponsDust.claimFees(q.tokenAddr);
      return { tx: claim.tx, claimedUsd };
    },
    dustBalanceEth: () => dust.balanceEth(),
    walletFor: (quantId) => chain.birthCustodyWallet(quantId, { keystoreDir: KEYSTORE_DIR, passphrase, env }),
    reserveEth: 0.005,
    x,
    xAccounts,
    tweetGuard,
    log,
    // extras the scripts use directly (not part of Season0Deps proper)
    _internals: { chain, publicClient, dust, ponsDust, artifact, chainEnv, setCustody: (c) => { custody = c; }, erc20BalanceOf: chain.erc20BalanceOf },
  };
  return deps;
}
