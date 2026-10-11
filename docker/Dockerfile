# co-newbiz web production image (ADR-0069 stack: Next.js Route Handlers +
# App Router on the Bun runtime — db/client.ts imports bun:sqlite, so the
# server MUST run under bun, never bare Node).
#
# Build context is the REPOSITORY ROOT, not app/web-next/ — the app imports
# the shared SQLite layer from ../../db AND parts of the root scripts/ tree
# (build-time imports plus runtime spawns like report.ts / newbiz.ts
# calibrate), so the image carries scripts/ and root node_modules too.
# The build therefore always runs as:
#   docker build -f docker/Dockerfile -t co-newbiz-web .
# (docker-compose.yml and .github/workflows/docker.yml already pass these.)

FROM oven/bun:1 AS deps
WORKDIR /repo
# Root workspace deps — runtime-spawned scripts under scripts/ import these.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
# App deps — build stage needs devDependencies (typescript, prisma CLI).
COPY app/web-next/package.json app/web-next/package.json
COPY app/web-next/bun.lock app/web-next/bun.lock
# --ignore-scripts: the slim oven/bun image has no node-gyp toolchain, and
# better-sqlite3's install script (prebuild-install || node-gyp rebuild) is
# the one dep that wants one. Nothing in the app imports better-sqlite3 or
# @prisma/adapter-better-sqlite3 at runtime — db/client.ts uses bun:sqlite —
# and no remaining dependency needs a postinstall (verified by the boot +
# /api/health smoke test after every build).
RUN cd app/web-next && bun install --frozen-lockfile --ignore-scripts

FROM deps AS build
# Governance trees the app reads at build (page-data collection) and at
# runtime (proc-resolve / _committees.yaml / flow.spec.yaml / docs/adr admin
# route) — walk-up locators expect them under /repo.
COPY db ./db
COPY scripts ./scripts
COPY procedures ./procedures
COPY process ./process
COPY docs ./docs
COPY mcp ./mcp
COPY packages ./packages
COPY glossary ./glossary
COPY config ./config
COPY app/web-next ./app/web-next
# prisma.config.ts reads app/web-next/.env only when DATABASE_URL is unset —
# provide a build-time value so `prisma generate` never needs a (gitignored,
# absent) .env file inside the image build.
ENV DATABASE_URL="file:/tmp/prisma-build.db"
RUN cd app/web-next && bun run prisma:generate && bun run build

FROM oven/bun:1 AS runtime
LABEL org.opencontainers.image.source=https://github.com/5throck/co-newbiz
LABEL org.opencontainers.image.description="co-newbiz web + API (Next.js on Bun)"
ENV NODE_ENV=production
# Boot applies pending migrations and bootstraps the first admin account
# automatically (app/web-next/instrumentation.ts). Do NOT point
# CO_NEWBIZ_DB_PATH outside the repo layout: db/client.ts derives DB_DIR
# (and the migrations location) as the parent of the DB's parent, so the
# volume is mounted at the app's own <repo>/db/data directory instead.
ENV CO_NEWBIZ_BOOTSTRAP_MIGRATIONS=auto
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/db ./db
COPY --from=build /repo/scripts ./scripts
COPY --from=build /repo/procedures ./procedures
COPY --from=build /repo/process ./process
COPY --from=build /repo/docs ./docs
COPY --from=build /repo/mcp ./mcp
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/glossary ./glossary
COPY --from=build /repo/config ./config
COPY --from=build /repo/app/web-next/node_modules ./app/web-next/node_modules
COPY --from=build /repo/app/web-next/.next ./app/web-next/.next
COPY --from=build /repo/app/web-next/public ./app/web-next/public
COPY --from=build /repo/app/web-next/package.json ./app/web-next/package.json
COPY --from=build /repo/app/web-next/next.config.ts ./app/web-next/next.config.ts
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
  && mkdir -p /repo/db/data /backups \
  && chown -R bun:bun /repo /backups
USER bun
VOLUME /repo/db/data
EXPOSE 7749
WORKDIR /repo/app/web-next
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["bun", "--bun", "next", "start", "-p", "7749"]
