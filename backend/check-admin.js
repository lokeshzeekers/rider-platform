require('dotenv').config();

const { query, pool } = require('./db/pool');

async function main() {
  try {
    const result = await query(`
      SELECT id, username, name, email, phone, role, status, org_id
      FROM users
      WHERE role = 'super_admin'
    `);

    console.table(result.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

main();