require('dotenv').config();

const crypto = require('crypto');
const { query, pool } = require('./db/pool');

async function main() {
  const userId = 'faab698c-4fc3-4b89-85fa-adcffce8447f';

  try {
    console.log('1. Creating refresh token...');

    const raw = crypto.randomBytes(48).toString('hex');
    const token_hash = crypto
      .createHash('sha256')
      .update(raw)
      .digest('hex');

    const expires_at = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000
    );

    console.log('2. Inserting into refresh_tokens...');

    const result = await query(
      `INSERT INTO refresh_tokens
       (user_id, token_hash, user_agent, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        userId,
        token_hash,
        'diagnostic-test',
        '127.0.0.1',
        expires_at
      ]
    );

    console.log('3. INSERT SUCCESS');
    console.log(result.rows);

  } catch (err) {
    console.log('');
    console.log('========== ACTUAL DATABASE ERROR ==========');
    console.error(err);
    console.log('===========================================');
  } finally {
    await pool.end();
  }
}

main();