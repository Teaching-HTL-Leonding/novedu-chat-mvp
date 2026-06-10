# Multi-stage build for the Next.js app using `output: "standalone"`.
# The final image contains only the traced server files and runs as a
# non-root user. All configuration (secrets, connection strings) comes
# from runtime environment variables — nothing from .env is baked in.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# auth.ts validates these at module load, which also runs during build-time
# page-data collection. Server code re-reads process.env at runtime, so these
# placeholders are never baked into the output and never reach the final stage.
ENV AZURE_CLIENT_ID=build-placeholder \
    AZURE_CLIENT_SECRET=build-placeholder \
    AZURE_TENANT_ID=build-placeholder \
    TEACHER_GROUP_ID=build-placeholder \
    AUTH_SECRET=build-placeholder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# public/ is empty and not git-tracked, so it is absent in CI checkouts;
# the runner stage COPYs it unconditionally.
RUN mkdir -p public && npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    # Auth.js self-hosted: trust the Host / x-forwarded-* headers set by the
    # reverse proxy in front of the container (Azure App Service, local Docker).
    AUTH_TRUST_HOST=true

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# server.js serves public/ and .next/static/ itself once they are copied in.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
