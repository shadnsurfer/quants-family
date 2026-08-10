SIFONN_PRO.otf goes here.

It is a licensed commercial font and not redistributable, so it is gitignored. Local CLI
builds (`pnpm --filter @quants/site build`, `vercel build --prod`) pick it up from this
directory; without it the brand wordmark falls back to the mono stack.
