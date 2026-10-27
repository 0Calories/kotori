# syntax=docker/dockerfile:1.7
# One image for both Fly process groups (`api`, `worker`; see fly.toml). The build
# stage compiles with tsc --build; the runtime stage installs production
# dependencies only, from the same lockfile, and carries no sources.

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
# Only the two apps, their workspace dependencies and the root toolchain (nx, tsc).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store \
      --filter kotori --filter "@kotori/api..." --filter "@kotori/worker..."
RUN NX_DAEMON=false pnpm nx run-many -t build -p @kotori/api @kotori/worker --skip-nx-cache --outputStyle=static
# Deploy layout: every package.json (so the lockfile still describes the whole
# workspace), each project's dist/, the database migrations, and the workspace files. No sources.
RUN mkdir -p /out \
 && find . -name package.json -not -path '*/node_modules/*' -not -path '*/dist/*' | tar -cf - -T - | tar -xf - -C /out \
 && for p in apps/api apps/worker packages/*; do \
      if [ -d "$p/dist" ]; then mkdir -p "/out/$p" && cp -r "$p/dist" "/out/$p/dist"; fi; \
      if [ -d "$p/migrations" ]; then mkdir -p "/out/$p" && cp -r "$p/migrations" "/out/$p/migrations"; fi; \
    done \
 && cp pnpm-lock.yaml pnpm-workspace.yaml /out/

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /out /app
# The workspace uses the hoisted linker for Metro, but that linker ignores
# --filter and would install the Expo app's dependencies too. The isolated
# (default) linker honours the filter; Node resolves through its symlinks fine.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --store-dir /pnpm/store \
      --config.node-linker=isolated \
      --filter "@kotori/api..." --filter "@kotori/worker..." \
 && mkdir -p data && chown node:node data
USER node
EXPOSE 8080
CMD ["node", "apps/api/dist/main.js"]
