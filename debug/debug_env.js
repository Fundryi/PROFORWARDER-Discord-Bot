require('dotenv').config();

console.log('=== Environment Debug ===');
console.log('TELEGRAM_ENABLED from process.env:', process.env.TELEGRAM_ENABLED);
console.log('Type:', typeof process.env.TELEGRAM_ENABLED);
console.log('Strict equality check:', process.env.TELEGRAM_ENABLED === 'true');

console.log('\n=== Config Debug ===');
const config = require('./config/env');
console.log('config.telegram:', config.telegram);
console.log('config.telegram.enabled:', config.telegram.enabled);

console.log('\n=== Attempting Telegram Init ===');
const TelegramHandler = require('./handlers/telegramHandler');
const telegramHandler = new TelegramHandler();

telegramHandler.initialize().then(result => {
  console.log('Init result:', result);
}).catch(error => {
  console.error('Init error:', error);
});