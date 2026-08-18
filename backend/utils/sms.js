const logger = require('./logger');

const PROVIDER = process.env.SMS_PROVIDER || 'none';

/**
 * Sends an SMS notification (e.g. to an org admin: "user X requested a password reset").
 * Never used to send the password or reset token itself -- only a notification that a
 * request exists, per the "passwords/tokens are never sent via SMS" requirement.
 *
 * Swap the body of this function for a real provider (Twilio, MSG91, etc.) when ready;
 * every caller already treats this as fire-and-forget / best-effort.
 */
async function sendSms(toPhone, message) {
  if (PROVIDER === 'none') {
    logger.info({ toPhone: maskPhone(toPhone), message }, 'SMS (no provider configured) -- logged only');
    return { sent: false, reason: 'no_provider_configured' };
  }

  // Example shape for a real provider integration:
  // const res = await fetch(`https://api.${PROVIDER}.example/send`, { ... });

  logger.warn({ provider: PROVIDER }, 'SMS provider configured but integration not implemented yet');
  return { sent: false, reason: 'provider_not_implemented' };
}

function maskPhone(phone) {
  if (!phone || phone.length < 4) return '****';
  return phone.slice(0, -4).replace(/./g, '*') + phone.slice(-4);
}

module.exports = { sendSms };
