/**
 * Usage: node scripts/create-super-admin.js <username> <name> <phone> <email> <password>
 * Creates the platform-level Super Admin (org_id = NULL, role = 'super_admin').
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query, pool } = require('../db/pool');

async function main() {
  const [, , username, name, phone, email, password] = process.argv;
  if (!username || !name || !phone || !email || !password) {
    console.log('Usage: node scripts/create-super-admin.js <username> <name> <phone> <email> <password>');
    process.exit(1);
  }
  if (password.length < 8) {
    console.log('Password must be at least 8 characters.');
    process.exit(1);
  }

  const existing = await query(`SELECT id FROM users WHERE role = 'super_admin' AND (username = $1 OR email = $2)`, [username, email]);
  if (existing.rows.length > 0) {
    console.log(`A super admin with that username/email already exists (id ${existing.rows[0].id}).`);
    await pool.end();
    return;
  }

  const password_hash = await bcrypt.hash(password, 12);
  const res = await query(
    `INSERT INTO users (org_id, username, name, phone, email, password_hash, role) VALUES (NULL, $1, $2, $3, $4, $5, 'super_admin') RETURNING id`,
    [username, name, phone, email, password_hash]
  );

  console.log(`Super Admin created: ${username} (id ${res.rows[0].id})`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
