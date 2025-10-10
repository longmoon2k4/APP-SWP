// set_password.js
// Usage: node set_password.js <newPassword> <username_or_email>
// Reads DB config from .env, hashes the new password with bcrypt, and updates the users table.

const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function main() {
  const newPass = process.argv[2];
  const identifier = process.argv[3];

  if (!newPass || !identifier) {
    console.error('Usage: node set_password.js <newPassword> <username_or_email>');
    process.exit(1);
  }

  const hash = bcrypt.hashSync(newPass, 10);

  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0
  });

  try {
    const [result] = await pool.execute(
      'UPDATE users SET password = ? WHERE username = ? OR email = ?',
      [hash, identifier, identifier]
    );

    console.log('AffectedRows:', result.affectedRows);
    if (result.affectedRows > 0) {
      console.log('Password updated successfully for', identifier);
    } else {
      console.log('No user updated. Check that the identifier exists.');
    }
  } catch (err) {
    console.error('Error updating password:', err.message);
    process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

main();
