# syntax=docker/dockerfile:1.7
# One image for both Fly process groups (`api`, `worker`; see fly.toml), and the release command.
# `@kotori/backend:deploy` depends on `build`, so Nx compiles (or restores from cache) each
# package's `dist/` before `flyctl deploy` runs. The runtime stage installs production dependencies
# in a cached layer before copying the compiled artifacts and migrations.

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
RUN corepack enable
WORKDIR /app

FROM base AS stage
COPY . .
# Split workspace manifests (/out/deps) from build outputs (/out/app) so code-only deploys reuse
# the cached `pnpm install --prod` layer in the runtime stage.
RUN test -f apps/backend/dist/entrypoints/http.js \
 && mkdir -p /out/deps /out/app \
 && find . -name package.json -not -path '*/node_modules/*' -not -path '*/dist/*' | tar -cf - -T - | tar -xf - -C /out/deps \
 && cp pnpm-lock.yaml pnpm-workspace.yaml /out/deps/ \
 && for p in apps/backend packages/*; do \
      if [ -d "$p/dist" ]; then mkdir -p "/out/app/$p" && cp -r "$p/dist" "/out/app/$p/dist"; fi; \
      if [ -d "$p/migrations" ]; then mkdir -p "/out/app/$p" && cp -r "$p/migrations" "/out/app/$p/migrations"; fi; \
    done

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=stage /out/deps /app
# The workspace uses the hoisted linker for Metro, but that linker ignores
# --filter and would install the Expo app's dependencies too. The isolated
# (default) linker honours the filter; Node resolves through its symlinks fine.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --store-dir /pnpm/store \
      --config.node-linker=isolated \
      --filter "@kotori/backend..." \
 && mkdir -p data && chown node:node data
COPY --from=stage /out/app /app
USER node
EXPOSE 8080
CMD ["node", "apps/backend/dist/entrypoints/http.js"]
