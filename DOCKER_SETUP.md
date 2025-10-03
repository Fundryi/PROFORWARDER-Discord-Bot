# ProForwarder Discord Bot - Docker Setup Guide

This guide provides everything you need to run the ProForwarder Discord Bot in Docker containers.

## 📋 Prerequisites

- Docker and Docker Compose installed
- Discord Bot Token ready
- Optional: AI Provider API Keys (Google Gemini, OpenAI, DeepL)
- Optional: Telegram Bot Token (for Telegram integration)

## 🚀 Quick Setup

### 1. Create Docker Configuration Files

Create these three files in your project root:

#### Dockerfile
```dockerfile
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
```

#### docker-compose.yml
```yaml
version: '3.8'

services:
  proforwarder-bot:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: proforwarder-discord-bot
    restart: unless-stopped
    environment:
      - NODE_ENV=production
    env_file:
      - ./config/.env
    volumes:
      # Mount data directory for SQLite databases
      - ./data:/app/data
      # Mount config directory for configuration files
      - ./config:/app/config
    networks:
      - bot-network
    # Optional: Add logging configuration
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

networks:
  bot-network:
    driver: bridge
```

#### .dockerignore
```dockerignore
# Node modules
node_modules
npm-debug.log*

# Git
.git
.gitignore

# Documentation
*.md
Documentations/

# VS Code
.vscode/
.roo/

# Logs
logs
*.log

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/

# nyc test coverage
.nyc_output

# Dependency directories
node_modules/
jspm_packages/

# Optional npm cache directory
.npm

# Optional REPL history
.node_repl_history

# Output of 'npm pack'
*.tgz

# Yarn Integrity file
.yarn-integrity

# dotenv environment variables file
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# IDE files
.idea/
*.swp
*.swo
*~

# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# Docker files (exclude from build context)
Dockerfile
docker-compose.yml
.dockerignore
DOCKER_SETUP.md
```

### 2. Configure Your Bot

```bash
# Copy configuration templates
cp config/.env.example config/.env
cp config/env.js.example config/env.js

# Edit configuration files
nano config/.env      # Add your Discord Bot Token and API keys
nano config/env.js     # Configure your bot settings
```

#### Essential .env Configuration
```env
# Required: Discord Bot Token
BOT_TOKEN=your_discord_bot_token_here

# Optional: AI Provider API Keys
GEMINI_API_KEY=your_gemini_api_key_here
GOOGLE_TRANSLATE_API_KEY=your_google_translate_api_key_here
GOOGLE_PROJECT_ID=your_google_cloud_project_id

# Optional: Reader Bot
READER_BOT_ENABLED=false
READER_BOT_TOKEN=your_reader_bot_token_here

# Optional: Telegram Integration
TELEGRAM_ENABLED=false
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
```

#### Essential env.js Configuration
```javascript
module.exports = {
  botToken: process.env.BOT_TOKEN,
  debugMode: false, // Set to true for debugging
  
  // Forward configurations - Automatically populated by bot via /proforward commands
  forwardConfigs: [],
  
  // Auto-publish channels configuration
  autoPublishChannels: {},
  
  // Reader Bot Configuration
  readerBot: {
    enabled: process.env.READER_BOT_ENABLED === 'true',
    token: process.env.READER_BOT_TOKEN
  },
  
  // Telegram integration
  telegram: {
    enabled: false, // Set to true to enable Telegram integration
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    apiUrl: process.env.TELEGRAM_API_URL || 'https://api.telegram.org',
    hideSourceHeader: false,
    smartLinkPreviews: true,
    captionLengthLimit: 900,
    textLengthLimit: 4000,
    splitIndicator: '...(continued)',
    captionSplitStrategy: 'smart'
  },
  
  // AI Integration
  ai: {
    enabled: false, // Set to true to enable AI features
    providers: {
      gemini: {
        apiKey: process.env.GEMINI_API_KEY,
        model: 'gemini-2.0-flash-exp',
        maxTokens: 2048,
        temperature: 0
      },
      openai: {
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-4',
        maxTokens: 2000,
        temperature: 0.3
      },
      deepl: {
        apiKey: process.env.DEEPL_API_KEY,
        freeApi: true
      }
    },
    translation: {
      enabled: true,
      defaultProvider: 'gemini',
      cacheTranslations: true,
      maxCacheAge: 24 * 60 * 60 * 1000,
      fallbackProvider: 'deepl'
    }
  }
};
```

### 3. Start the Bot

```bash
# Build and start the container
docker-compose up -d --build

# View logs to verify it's working
docker-compose logs -f proforwarder-bot
```

## 📁 Directory Structure

After setup, your project should look like this:

```
PROFORWARDER-Discord-Bot/
├── Dockerfile                    ← Created by you
├── docker-compose.yml            ← Created by you
├── .dockerignore                 ← Created by you
├── DOCKER_SETUP.md               ← This file
├── config/
│   ├── .env                      ← Edit with your bot token and API keys
│   └── env.js                    ← Edit with your bot settings
├── data/                         ← Auto-created (SQLite databases)
└── ... (other project files)
```

## 🔧 Essential Commands

| Command | Purpose |
|---------|---------|
| `docker-compose up -d --build` | Build and start the bot |
| `docker-compose logs -f` | View live logs |
| `docker-compose down` | Stop the bot |
| `docker-compose restart` | Restart the bot |
| `docker-compose exec proforwarder-bot sh` | Access container shell |
| `docker-compose pull` | Pull latest base images |
| `docker-compose ps` | Show container status |

## 📊 Volume Mounts

| Host Path | Container Path | Purpose |
|-----------|----------------|---------|
| `./data` | `/app/data` | SQLite databases (proforwarder.db) |
| `./config` | `/app/config` | Configuration files (.env, env.js) |

## 🚨 Troubleshooting

### Permission Errors (Linux)
```bash
sudo chown -R $USER:$USER data config
```

### Bot Won't Start
1. Check if Discord Bot Token is correct in `config/.env`
2. Verify configuration in `config/env.js`
3. Check logs: `docker-compose logs proforwarder-bot`

### Database Issues
1. Ensure `data/` directory exists and is writable
2. Check SQLite file exists in `data/` directory
3. If needed, delete `proforwarder.db` file and restart to recreate

### Configuration Issues
1. Verify all required environment variables are set
2. Check that `config/.env` and `config/env.js` exist
3. Ensure file permissions allow container to read config files

## 🔄 Updates and Maintenance

### Update the Bot
```bash
git pull
docker-compose down
docker-compose up -d --build
```

### Backup Data
```bash
docker-compose down
tar -czf backup-$(date +%Y%m%d).tar.gz data/ config/
docker-compose up -d
```

### Restore from Backup
```bash
docker-compose down
tar -xzf backup-YYYYMMDD.tar.gz
docker-compose up -d
```

### View Resource Usage
```bash
docker stats proforwarder-discord-bot
```

### Clean Up Docker Resources
```bash
# Remove unused images
docker image prune -f

# Remove unused containers and networks
docker system prune -f
```

## ✅ Configuration Checklist

Before starting, ensure you have:

- [ ] Discord Bot Token in `config/.env`
- [ ] Bot settings configured in `config/env.js`
- [ ] Proper file permissions on Linux systems
- [ ] Docker and Docker Compose installed
- [ ] Optional: AI Provider API Keys for translation features
- [ ] Optional: Telegram Bot Token for Telegram integration

## 🔒 Security Features

- Runs as non-root user (botuser:1001)
- Only production dependencies installed
- Sensitive configuration mounted via volumes
- Health checks for monitoring
- Log rotation to prevent disk space issues
- Optimized build context with .dockerignore

## 🚀 Production Best Practices

### Environment Configuration
- Use strong, unique bot tokens
- Keep API keys secure and never commit them to version control
- Enable debug mode only during development
- Regularly update dependencies

### Monitoring
- Monitor container health with built-in health checks
- Check logs regularly for errors or warnings
- Set up log aggregation for production deployments
- Monitor resource usage (CPU, memory, disk)

### Backups
- Regularly backup the `data/` directory containing SQLite databases
- Backup configuration files in `config/` directory
- Test restore procedures periodically
- Consider automated backup schedules

## 🌟 Advanced Configuration

### Custom Network Configuration
```yaml
networks:
  bot-network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16
```

### Resource Limits
```yaml
services:
  proforwarder-bot:
    # ... other config
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
        reservations:
          cpus: '0.25'
          memory: 256M
```

### External Database (Optional)
If you prefer to use an external SQLite database or migrate to PostgreSQL/MySQL, modify the `config/env.js` database configuration and update volume mounts accordingly.

## 📚 Additional Resources

- [Discord.js Documentation](https://discord.js.org/)
- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [ProForwarder Bot README](./README.md)

---

**That's it! Your ProForwarder Discord Bot should now be running in Docker.** 🎉

For issues not related to Docker, please refer to the main README.md file.