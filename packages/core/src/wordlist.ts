/**
 * Curated quant-lore wordlist for child names (PROJECT.md §4.4): greeks, statisticians,
 * distributions. Genesis names are reserved. Tickers derive from the name (uppercased, ≤6 chars),
 * so names must be unique case-insensitively.
 */

export const GENESIS_NAMES = Object.freeze([
  // eve — the gen-0 progenitor (2026-07-24 lineage model); the rest were the retired 8-brood genesis
  "eve", "kelly", "sharpe", "monte", "bayes", "theta", "gauss", "vega", "mandel",
] as const);

export const QUANT_WORDLIST: readonly string[] = Object.freeze([
  // statisticians & probabilists
  "ito", "wiener", "markov", "laplace", "cauchy", "dirac", "euler", "fermat",
  "pearson", "gosset", "levy", "pareto", "poisson", "fisher", "borel", "doob",
  "feller", "erdos", "chernoff", "hurst", "kalman", "riemann", "hilbert", "banach",
  "cholesky", "hermite", "jacobi", "lagrange", "sortino", "wick",
  // distributions
  "frechet", "gumbel", "weibull", "copula", "logit", "probit",
  // greeks (vega/theta are genesis, excluded)
  "sigma", "delta", "gamma", "kappa", "lambda", "omega", "zeta", "tau", "rho", "phi",
]);
