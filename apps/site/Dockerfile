# quants.family — the site container. Build context is the REPO ROOT (the site
# reads data/content at request time and traces files across the workspace):
#
#   docker build -f apps/site/Dockerfile -t quants-site .
#   docker run -p 4321:4321 quants-site
#
# In compose this is the `site` service; Caddy fronts it on quants.family.

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
# the site imports workspace packages (@quants/brain, @quants/core) which resolve
# to dist/ — build the site together with all its workspace deps, in topo order
RUN DOCKER_BUILD=1 pnpm --filter "@quants/site..." build

FROM node:22-alpine AS run
ENV NODE_ENV=production
WORKDIR /app
# standalone server (traced from the repo root, hence the nested path) + assets
COPY --from=build /repo/apps/site/.next/standalone ./
COPY --from=build /repo/apps/site/.next/static ./apps/site/.next/static
COPY --from=build /repo/apps/site/public ./apps/site/public
# request-time content the docs page reads via lib/data.ts (repoRoot() finds
# pnpm-workspace.yaml and resolves ./data/content from here)
COPY --from=build /repo/data/content ./data/content
COPY --from=build /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml
EXPOSE 4321
CMD ["node", "apps/site/server.js"]
