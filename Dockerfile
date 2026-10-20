FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
FROM deps AS builder
WORKDIR /app
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
COPY . .
RUN npm run build
FROM deps AS production-deps
RUN npm prune --omit=dev --ignore-scripts
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder --chown=node:node /app/.next/standalone ./
# The custom server is outside Next's traced entrypoint. Include its full
# production dependency graph, not only the partially traced packages.
COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
RUN node --input-type=module -e "await Promise.all(['next', 'socket.io', '@clerk/backend', 'mongodb'].map(name => import(name)))"
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/server.mjs ./server.mjs
COPY --from=builder --chown=node:node /app/runtime ./runtime
USER node
EXPOSE 3000
CMD ["node","server.mjs"]
