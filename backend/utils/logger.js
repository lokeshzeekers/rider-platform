const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      '*.password',
      '*.password_hash',
      '*.new_password',
      '*.token',
      '*.access_token',
      '*.refresh_token',
      '*.reset_token',
      '*.token_hash'
    ],
    censor: '[REDACTED]'
  },
  timestamp: pino.stdTimeFunctions.isoTime
});

module.exports = logger;
