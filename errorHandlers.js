const { logError } = require('./utils/logger');

// Anti Crash System
process.on("unhandledRejection", (reason, promise) => {
  logError('Unhandled Rejection:', reason?.stack || reason, promise);
});

process.on("uncaughtException", (err, origin) => {
  logError('Uncaught Exception:', err?.stack || err, origin);
});

process.on("uncaughtExceptionMonitor", (err, origin) => {
  logError('Uncaught Exception Monitor:', err?.stack || err, origin);
});
