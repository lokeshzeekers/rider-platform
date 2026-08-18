const { validationResult } = require('express-validator');

// Runs after an array of express-validator checks; short-circuits with a 400 listing
// every field error if any check failed, otherwise calls next().
function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map((e) => ({ field: e.path, message: e.msg }))
    });
  }
  next();
}

module.exports = { handleValidation };
