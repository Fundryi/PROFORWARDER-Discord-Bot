FROM node:24-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci && npm cache clean --force

# Production stage
FROM node:24-alpine

WORKDIR /app

# Install runtime dependencies only
RUN apk add --no-cache sqlite

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S botuser -u 1001

# Create required directories
RUN mkdir -p data config && \
    chown -R botuser:nodejs /app

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application files
COPY --chown=botuser:nodejs package*.json ./
COPY --chown=botuser:nodejs index.js ./
COPY --chown=botuser:nodejs healthcheck.js ./
COPY --chown=botuser:nodejs errorHandlers.js ./
COPY --chown=botuser:nodejs readerBot.js ./
COPY --chown=botuser:nodejs utils ./utils
COPY --chown=botuser:nodejs handlers ./handlers
COPY --chown=botuser:nodejs events ./events
COPY --chown=botuser:nodejs commands ./commands
COPY --chown=botuser:nodejs web ./web
COPY --chown=botuser:nodejs config ./config

USER botuser

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD node healthcheck.js

CMD ["node", "index.js"]
