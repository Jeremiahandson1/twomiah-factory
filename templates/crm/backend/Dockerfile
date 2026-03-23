FROM oven/bun:1-alpine AS base
WORKDIR /app
RUN apk add --no-cache curl

FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile

FROM base AS builder
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .

FROM base AS runner
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 appgroup
RUN adduser --system --uid 1001 appuser

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/db ./db
COPY --from=builder /app/package.json ./
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts

RUN mkdir -p uploads logs && chown -R appuser:appgroup uploads logs

USER appuser

EXPOSE 10000

CMD ["bun", "run", "start"]
