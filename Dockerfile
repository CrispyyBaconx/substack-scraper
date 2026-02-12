FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Final image
FROM base
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/

ENV DATA_DIR=/data
RUN mkdir -p /data

EXPOSE 8946

CMD ["bun", "run", "src/index.ts"]
