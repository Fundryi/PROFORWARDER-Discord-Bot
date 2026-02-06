const { logInfo, logSuccess, logError } = require('../../utils/logger');
const https = require('https');

/**
 * Telegram API Handler - Pure API communication layer
 * Handles bot initialization, token validation, and raw API calls
 */
class TelegramAPI {
  constructor() {
    this.botToken = null;
    this.apiUrl = 'https://api.telegram.org';
    this.initialized = false;
  }

  /**
   * Initialize Telegram API with bot token
   */
  async initialize() {
    try {
      const config = require('../../config/config');
      
      if (!config.telegram?.enabled) {
        logInfo('Telegram integration disabled in config');
        return false;
      }

      if (!config.telegram.botToken) {
        logError('Telegram bot token not provided');
        return false;
      }

      this.botToken = config.telegram.botToken;
      this.apiUrl = config.telegram.apiUrl || 'https://api.telegram.org';

      // Test the bot token by calling getMe
      const botInfo = await this.callTelegramAPI('getMe');
      if (botInfo && botInfo.ok) {
        logSuccess(`Telegram bot initialized: @${botInfo.result.username} (${botInfo.result.first_name})`);
        this.initialized = true;
        return true;
      } else {
        logError('Failed to initialize Telegram bot - invalid token or API error');
        return false;
      }
    } catch (error) {
      logError('Error initializing Telegram handler:', error);
      return false;
    }
  }

  /**
   * Make API call to Telegram Bot API
   */
  async callTelegramAPI(method, params = {}) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(params);
      
      const options = {
        hostname: this.apiUrl.replace('https://', '').replace('http://', ''),
        port: 443,
        path: `/bot${this.botToken}/${method}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            resolve(response);
          } catch (error) {
            reject(new Error('Invalid JSON response from Telegram API'));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Get Telegram bot information
   */
  async getBotInfo() {
    if (!this.initialized) {
      return { error: 'Telegram API not initialized' };
    }

    try {
      const result = await this.callTelegramAPI('getMe');
      return result;
    } catch (error) {
      logError('Error getting bot info:', error);
      return { error: error.message };
    }
  }

  /**
   * Test Telegram API functionality
   */
  async testTelegram(chatId) {
    if (!this.initialized) {
      return { error: 'Telegram API not initialized' };
    }

    try {
      const testMessage = {
        chat_id: chatId,
        text: '🤖 **Test message** from ProForwarder!\n\nThis is a test of the Telegram API connection.',
        parse_mode: 'Markdown'
      };

      const result = await this.callTelegramAPI('sendMessage', testMessage);
      if (result && result.ok) {
        return { success: true, messageId: result.result.message_id };
      } else {
        return { error: result ? result.description : 'Unknown error' };
      }
    } catch (error) {
      logError('Telegram API test failed:', error);
      return { error: error.message };
    }
  }

  /**
   * Check if API is initialized
   */
  isInitialized() {
    return this.initialized;
  }

  /**
   * Get bot token (for internal use by other modules)
   */
  getBotToken() {
    return this.botToken;
  }

  /**
   * Get API URL (for internal use by other modules)
   */
  getApiUrl() {
    return this.apiUrl;
  }
}

module.exports = TelegramAPI;