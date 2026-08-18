require('dotenv').config();

const bcrypt = require('bcryptjs');
const { query, pool } = require('./db/pool');
const {
  signAccessToken,
  issueRefreshToken
} = require('./utils/tokens');
const { serializeUser } = require('./utils/helpers');

async function main() {
  try {
    const identifier = 'superadmin';
    const password = '123@Zeekersteam';

    console.log('1. Looking up Super Admin...');

    const result = await query(
      `SELECT * FROM users
       WHERE role = 'super_admin'
       AND (username = $1 OR email = $1)`,
      [identifier]
    );

    console.log('User found:', result.rows.length);

    if (!result.rows[0]) {
      throw new Error('SUPER ADMIN NOT FOUND');
    }

    const user = result.rows[0];

    console.log({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      status: user.status,
      org_id: user.org_id
    });

    console.log('2. Checking password...');

    const passwordOk = await bcrypt.compare(
      password,
      user.password_hash
    );

    console.log('Password valid:', passwordOk);

    if (!passwordOk) {
      throw new Error('PASSWORD DOES NOT MATCH');
    }

    const authUser = {
      id: user.id,
      org_id: null,
      role: user.role,
      username: user.username
    };

    console.log('3. Creating access token...');

    const accessToken = signAccessToken(authUser);

    console.log('Access token created:', !!accessToken);

    console.log('4. Creating refresh token...');

    const refresh = await issueRefreshToken(
      user.id,
      {
        userAgent: 'diagnostic',
        ip: '127.0.0.1'
      }
    );

    console.log('Refresh token created:', !!refresh.raw);
    console.log('Refresh ID:', refresh.id);

    console.log('5. Serializing user...');

    const serialized = await serializeUser(user, authUser);

    console.log('Serialized user:');
    console.dir(serialized, { depth: null });

    console.log('');
    console.log('======================================');
    console.log('SUPER ADMIN LOGIN FLOW WORKS');
    console.log('======================================');

  } catch (err) {
    console.error('');
    console.error('======================================');
    console.error('LOGIN FLOW FAILED');
    console.error('======================================');
    console.error(err);
    console.error(err.stack);
  } finally {
    await pool.end();
  }
}

main();