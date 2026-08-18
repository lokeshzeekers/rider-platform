const logger = require('./logger');

/**
 * Stub email sender for self-service password/username recovery links. Swap for a real
 * provider (SES, Postmark, SMTP) in production. Callers treat this as best-effort and
 * never rely on the return value to decide what to tell the requester (the API response
 * is always the same generic message regardless of whether the account exists, to avoid
 * account enumeration).
 */
async function sendEmail(to, subject, body) {
  logger.info({ to, subject }, 'Email (no provider configured) -- logged only, not actually sent');
  return { sent: false, reason: 'no_provider_configured' };
}

module.exports = { sendEmail };
