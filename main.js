const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

let pool;

async function initDbPool() {
  try {
    const cfg = {
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT || '10000', 10),
      // mysql2 uses acquireTimeout and connectTimeout; socket timeout handled per query
    };
    pool = mysql.createPool(cfg);
    // test one connection
    const conn = await pool.getConnection();
    conn.release();
    console.log('DB pool initialized');
  } catch (err) {
    console.error('Failed to initialize DB pool', err);
    pool = null;
  }
}

function createWindow () {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile('index.html');
  // win.webContents.openDevTools();
}

app.whenReady().then(createWindow);

// initialize DB pool (non-blocking)
initDbPool();

// IPC handlers
ipcMain.handle('ping', async () => {
  return 'pong';
});

ipcMain.handle('db-test', async () => {
  if (!pool) {
    return { ok: false, message: 'DB pool not initialized' };
  }
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    return { ok: true, message: 'connected' };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

ipcMain.handle('db-query', async (_e, sql, params) => {
  if (!pool) throw new Error('DB pool not initialized');
  const [rows] = await pool.execute(sql, params || []);
  return rows;
});

// Authentication: verify user by username or email, then update last_login
ipcMain.handle('auth-login', async (_e, identifier, password) => {
  if (!pool) throw new Error('DB pool not initialized');
  try {
    const sql = 'SELECT user_id, username, email, password FROM users WHERE username = ? OR email = ? LIMIT 1';
    const [rows] = await pool.execute(sql, [identifier, identifier]);
    if (!rows || rows.length === 0) return { ok: false, message: 'User not found' };
    const user = rows[0];
    const hashed = user.password;
    const match = await bcrypt.compare(password, hashed);
    if (!match) return { ok: false, message: 'Invalid credentials' };
    // update last_login
    await pool.execute('UPDATE users SET last_login = NOW() WHERE user_id = ?', [user.user_id]);
    // return user info without password
    return { ok: true, user: { user_id: user.user_id, username: user.username, email: user.email } };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
