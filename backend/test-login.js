require('dotenv').config();

const bcrypt = require('bcryptjs');
const { query, pool } = require('./db/pool');

async function main() {
  try {
    const identifier = 'superadmin';
    const password = '123@Zeekersteam';

    console.log('1. Checking database connection...');

    const result = await query(
      `SELECT id, username, name, email, phone, password_hash, role, status, org_id
       FROM users
       WHERE role = 'super_admin'
       AND (username = $1 OR email = $1)`,
      [identifier]
    );

    console.log('2. Users found:', result.rows.length);

    if (result.rows.length === 0) {
      console.log('ERROR: Super Admin was not found.');
      return;
    }

    const user = result.rows[0];

    console.log('3. User found:');
    console.table([{
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      status: user.status,
      org_id: user.org_id
    }]);

    console.log('4. Testing bcrypt password...');

    const passwordValid = await bcrypt.compare(
      password,
      user.password_hash
    );

    console.log('5. Password valid:', passwordValid);

    if (!passwordValid) {
      console.log('ERROR: Password does not match the stored password hash.');
      return;
    }

    console.log('6. Testing token module...');

    const {
      signAccessToken,
      issueRefreshToken
    } = require('./utils/tokens');

    const authUser = {
      id: user.id,
      org_id: null,
      role: user.role,
      username: user.username
    };

    console.log('7. Auth user:', authUser);

    const accessToken = signAccessToken(authUser);

    console.log('8. Access token created:', !!accessToken);

    const refresh = await issueRefreshToken(user.id, {
      userAgent: 'diagnostic-test',
      ip: '127.0.0.1'
    });

    console.log('9. Refresh token created:', !!refresh);
    console.log('10. TEST PASSED');

  } catch (err) {
    console.error('');
    console.error('========== ACTUAL ERROR ==========');
    console.error(err);
    console.error('===================================');
  } finally {
    await pool.end();
  }
}

main();