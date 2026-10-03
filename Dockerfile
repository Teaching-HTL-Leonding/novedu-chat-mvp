# Multi-stage build for the Next.js app using `output: "standalone"`.
# The final image contains only the traced server files and runs as a
# non-root user. All configuration (secrets, connection strings) comes
# from runtime environment variables — nothing from .env is baked in.

FROM node:24-alpine AS deps
WORKDIR /app
# The workspaces (cli, teacher-docs) stay out: nothing in the image needs them.
# The teacher guide is a separate static site (docs/teacher-docs.md).
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# auth.ts (the better-auth instance) and the database pool are both constructed
# at module load, which also runs during build-time page-data collection: the
# drizzle adapter needs a DATABASE_URL to construct, and auth.ts validates the
# AZURE_*/TEACHER_GROUP_ID/AUTH_SECRET vars the same way. The pool itself never
# connects during a build — no query runs — so a placeholder connection string
# is enough. Server code re-reads process.env at runtime, so none of these
# placeholders are baked into the output or reach the final stage.
ENV AZURE_CLIENT_ID=build-placeholder \
    AZURE_CLIENT_SECRET=build-placeholder \
    AZURE_TENANT_ID=build-placeholder \
    TEACHER_GROUP_ID=build-placeholder \
    AUTH_SECRET=build-placeholder \
    DATABASE_URL=postgresql://build:placeholder@localhost:5432/build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# public/ is not git-tracked, so it is absent in CI checkouts; the runner stage
# COPYs it unconditionally.
RUN mkdir -p public && npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Build identity, surfaced at runtime by /api/version and the /health dashboard
# (lib/version.ts) for deployment triage. Fed by docker-publish.yml --build-arg;
# defaults keep local `docker build` and `npm run dev` reading "dev"/"unknown".
ARG APP_VERSION=dev
ARG APP_GIT_SHA=unknown
ARG APP_BUILD_TIME=unknown
ENV APP_VERSION=$APP_VERSION \
    APP_GIT_SHA=$APP_GIT_SHA \
    APP_BUILD_TIME=$APP_BUILD_TIME

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# server.js serves public/ and .next/static/ itself once they are copied in.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Drizzle SQL migrations: read at startup (instrumentation.ts) via
# process.cwd()/drizzle — output tracing does not pick them up by itself.
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
