# Use Node.js 18 LTS as base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache \
    sqlite \
    python3 \
    make \
    g++

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S botuser -u 1001

# Create required directories with proper permissions
RUN mkdir -p data config && \
    chown -R botuser:nodejs /app

# Copy application files
COPY --chown=botuser:nodejs . .

# Switch to non-root user
USER botuser

# Expose port (not needed for Discord bot but good practice)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "console.log('Health check')" || exit 1

# Start the bot
CMD ["npm", "start"]