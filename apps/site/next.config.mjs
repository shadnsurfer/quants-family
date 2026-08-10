/** @type {import('next').NextConfig} */
const nextConfig = {
  // let a local dev server coexist with a prod server on the same checkout:
  // NEXT_DIST_DIR=.next-dev next dev keeps prod's .next build untouched
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // slim deploy artifact for the site container — only for image builds
  // (DOCKER_BUILD=1, see apps/site/Dockerfile); plain `next dev`/`next start`
  // run in the default mode ("next start" does not work with standalone).
  ...(process.env.DOCKER_BUILD === "1" ? { output: "standalone" } : {}),
  // the site reads build/logs/*.json + data/* from the repo root at request time
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
  // serverless file tracing can't see readFileSync(resolve(repoRoot(), "data/..."))
  // — explicitly ship the content the public routes read (never data/keystore)
  outputFileTracingIncludes: {
    "/": ["../../data/content/**/*", "../../data/genesis/**/*"],
    "/docs": ["../../data/content/**/*", "../../data/genesis/**/*"],
  },
};
export default nextConfig;
