const rateLimit = require('express-rate-limit');

// General API traffic
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' }
});

// Login / register — tighter, to blunt brute-force and credential stuffing
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' }
});

// Password/username recovery — abuse-prone (enumeration, SMS-bombing)
const recoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many recovery attempts. Please try again later.' }
});

module.exports = { apiLimiter, authLimiter, recoveryLimiter };
