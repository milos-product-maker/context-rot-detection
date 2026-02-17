# ── Stage 1: Build ─────────────────────────────────────────────
FROM node:22-slim AS builder

# Install native build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first (layer caching)
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for tsc)
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Prune devDependencies for production
RUN npm prune --production

# ── Stage 2: Runtime ───────────────────────────────────────────
FROM node:22-slim AS runtime

WORKDIR /app

# Copy production node_modules (with compiled better-sqlite3)
COPY --from=builder /app/node_modules ./node_modules

# Copy compiled JavaScript
COPY --from=builder /app/dist ./dist

# Copy package.json for the bin entry and metadata
COPY --from=builder /app/package.json ./

# Create data directory for SQLite persistence
RUN mkdir -p /data

# Default environment
ENV HEALTH_HISTORY_DB=/data/health.db
ENV LOG_FILE=/data/context-rot.log
ENV NODE_ENV=production

# MCP servers use stdio transport — no HTTP ports
CMD ["node", "dist/index.js"]
