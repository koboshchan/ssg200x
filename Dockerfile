FROM node:24.22.1-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
FROM deps AS builder
WORKDIR /app
# No Clerk keys exist at build time. Both keys are supplied only as container runtime environment.
COPY . .
RUN npm run build
FROM deps AS production-deps
RUN npm prune --omit=dev --ignore-scripts
FROM node:24.22.1-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
# The custom server needs the complete production graph. Copy it first so
# Next's traced standalone files (including external aliases) remain authoritative.
COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next/standalone ./
# SWC is build-only; source maps are unnecessary in the production runtime.
RUN find node_modules -type f -name '*.map' -delete && rm -rf node_modules/@next/swc-*
RUN node --input-type=module -e "await Promise.all(['next', 'socket.io', '@clerk/backend', 'mongodb'].map(name => import(name)))"
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/server.mjs ./server.mjs
COPY --from=builder --chown=node:node /app/runtime ./runtime
USER node
EXPOSE 3000
CMD ["node","server.mjs"]
