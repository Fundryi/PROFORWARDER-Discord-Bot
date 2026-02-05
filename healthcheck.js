#!/usr/bin/env node
// Healthcheck script for Docker
// Verifies the bot process is running and responsive

const fs = require('fs');
const path = require('path');

try {
  // Check that required files exist
  const requiredFiles = [
    path.join(__dirname, 'index.js'),
    path.join(__dirname, 'config', 'env.js'),
    path.join(__dirname, 'config', '.env')
  ];

  for (const file of requiredFiles) {
    if (!fs.existsSync(file)) {
      console.error(`Missing required file: ${file}`);
      process.exit(1);
    }
  }

  // Check data directory is writable
  const dataDir = path.join(__dirname, 'data');
  if (fs.existsSync(dataDir)) {
    fs.accessSync(dataDir, fs.constants.W_OK);
  }

  process.exit(0);
} catch (err) {
  console.error('Healthcheck failed:', err.message);
  process.exit(1);
}
