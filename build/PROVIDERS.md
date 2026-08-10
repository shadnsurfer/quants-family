# A2 — Provider decision (one page, decision not code)

Status: **DECIDED (2026-08-02, Charles).** Decisions recorded below; the volume/cost math stays for reference.

## Decisions

1. **Budget: no fixed ceiling.** LLM spend is funded by each agent's own collected fees — an agent
   that can't cover its compute burns into starvation and dies (that rule is the budget enforcer,
   not an alarm). The per-quant daily token budget in code becomes fee-derived per agent, not flat.
2. **Providers: Anthropic for text** (reasoning gate, posts, replies). **Media: Gemini or GPT for
   images, Higgsfield (MCP) for video** — final pick at the C1 bake-off. New scope recorded for the
   live runtime: the agent oversees its own actions (propose → self-review → act, logged), keeps a
   persistent personality, and creates posts **and replies** on X with awareness of social events
   (feeds B2 gate design and B4 X work; the social read-path is an injection surface — see ROADMAP
   standing notes).
3. **Tweet guard: removed — confirmed by Charles 2026-08-02.** Scope: the §5.3 content guard on
   posts only; the §4.2 trading guardrails (max position, daily-loss halt, slippage cap, whitelist)
   stay frozen. Implementation lands with B4 behind a config flag; risk note delivered (the legal
   consult may still re-open it).
4. **Media: two pipelines.** (a) Profile image at creation — one generated portrait per agent as
   its identity, written to `avatarUrl` (UI already wired). **Charles provides the base style
   reference images — ask him for them when C1 starts.** (b) Separate image generation for X posts,
   on demand. Identicons remain the fallback when no `avatarUrl` exists.
5. **Custody: EigenCompute + Turnkey (2026-08-09, Charles).** Agent execution will run in
   EigenCompute TEEs (Intel TDX; the deployed Docker image digest is attested on-chain). Quant
   keys live in Turnkey Nitro Enclaves — created and signing inside the enclave, raw key material
   unexportable by anyone, operator included; disaster recovery is policy-constrained API access,
   never key export. `CUSTODY_MODE` routes local-keystore (season-0 default) vs turnkey; provision
   ids with `scripts/turnkey-provision.mjs` before flipping. The daemon's TEE image is
   `Dockerfile.daemon`. Public custody claims ship only when live and verifiable — the /proof
   page lands with the deploy, not before.

## Call sites (from the code, not the spec)

| # | Site | Module | Today | When LLM plugs in |
|---|------|--------|-------|-------------------|
| 1 | trade reasoning gate | `packages/brain/src/gate.ts` (`GateBackend`) | deterministic heuristic | live mode (B2) |
| 2 | tweet voice | `packages/brain/src/composer.ts` | persona templates | live mode (B4/M6+) |
| 3 | tweet guard — LLM second check | `packages/brain/src/guard.ts` | deny-list only | with #2 |
| 4 | agent zero's species voice | apps/warden (events → posts) | templates | with #2 |
| 5 | media gen (avatars → `avatarUrl`, card images, clips) | future `packages/foundry` (C1) | identicon placeholder (already wired in UI) | C1 |

## Volume & cost math (season-0 scale: ~10 living quants)

- Gate: signal-driven, not every loop. Upper bound ~20 calls/day/active quant → ≤200/day.
  ~2K tokens in / ~150 out per call.
- Tweets: `postsPerDay` ≈ 6 × 10 quants + mother ≈ 70/day. ~800 in / ~80 out.
- Guard check: one per post ≈ 70/day. ~400 in / ~10 out.
- **Monthly total ≈ 15M input / 1.2M output tokens.**

Cost at placeholder list prices (**confirm current prices before locking**):
- flagship sonnet-class (~$3/M in, $15/M out): ≈ **$60–65/mo**
- light haiku-class (~$1/M in, $5/M out): ≈ **$20/mo**

Either fits the compute-burn target ($8–15/mo/quant ≈ $80–150/mo all-in for 10 quants,
including VPS share). Cost is not the constraint at season-0 scale — voice quality is.

## Latency tolerance

Gate: loop cadence is minutes — seconds of latency irrelevant. Tweets: delay-tolerant.
Media: batch/offline — quality over speed. **No call site needs a fast/cheap model for latency reasons.**

## Fallback order (per site)

1. Gate: flagship → **deterministic heuristic (already built)**. Trading never blocks on LLM outage; guardrails bound it either way.
2. Composer: flagship → **template composer (already built)**. Voice degrades, feed never dies.
3. Guard: **removed (owner decision).** Outgoing posts are unfiltered. X platform rules and the
   legal posture are the operator's exposure; the config flag keeps a path back.
4. Media: generated image → deterministic identicon (already the UI default when `avatarUrl` is null).
