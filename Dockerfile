FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Final image
FROM base
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock tsconfig.json config.json ./
COPY src/ ./src/
COPY public/ ./public/

EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
