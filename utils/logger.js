const chalk = require('chalk');

function formatUser(user) {
  if (!user) return '';
  return `${user.id}(${user.username || user.name || 'unknown'})`;
}

function formatTimestamp() {
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offset = -now.getTimezoneOffset() / 60;
  const offsetStr = offset >= 0 ? `GMT+${offset}` : `GMT${offset}`;
  
  return now.toLocaleString('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }) + ` ${offsetStr}`;
}

function logInfo(message, user = null) {
  const timestamp = chalk.white(`[${formatTimestamp()}]`);
  const userStr = user ? `${formatUser(user)} ` : '';
  console.log(chalk.yellow(`${timestamp} ${userStr}${message}`));
}

function logSuccess(message, user = null) {
  const timestamp = chalk.white(`[${formatTimestamp()}]`);
  const userStr = user ? `${formatUser(user)} ` : '';
  console.log(chalk.green(`${timestamp} ${userStr}${message}`));
}

function logError(message, error = null, user = null) {
  const timestamp = chalk.white(`[${formatTimestamp()}]`);
  const userStr = user ? `${formatUser(user)} ` : '';
  const errorDetails = error ? `: ${error.message || error}` : '';
  console.error(chalk.red(`${timestamp} ${userStr}${message}${errorDetails}`));
}

module.exports = {
  formatUser,
  logInfo,
  logSuccess,
  logError
};