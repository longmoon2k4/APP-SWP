const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const fs = require('fs').promises;
const crypto = require('crypto');
const cp = require('child_process');
const os = require('os');
// Track active downloads by requestId for cancel support
const downloadControllers = new Map();
// Track launched child processes to terminate when parent app exits
const launchedChildren = new Set();

function spawnTracked(exe, args = [], options = {}){
  const opts = Object.assign({ windowsHide: true, stdio: 'ignore', detached: false }, options || {});
  const child = cp.spawn(exe, args, opts);
  try {
    launchedChildren.add(child);
    child.on('exit', () => { launchedChildren.delete(child); });
  } catch {}
  return child;
}

function killProcessTree(pid){
  if (!pid) return;
  if (process.platform === 'win32') {
    try { cp.execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {}); } catch {}
  } else {
    try { process.kill(-pid, 'SIGTERM'); } catch {}
    try { process.kill(pid, 'SIGTERM'); } catch {}
  }
}

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
    width: 1024,
    height: 768,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
    ,
    // hide the menu bar by default; user can press Alt to show it if needed
    autoHideMenuBar: true,
    menuBarVisible: false
  });

  win.loadFile('index.html');
  win.setTitle('Bán Hàng Rong');
  // ensure application menu is removed and per-window menu bar hidden
  try {
    Menu.setApplicationMenu(null);
  } catch (e) {}
  try { win.setMenuBarVisibility(false); win.setAutoHideMenuBar(true); } catch(e) {}
  // win.webContents.openDevTools();
}

app.whenReady().then(() => {
  // remove the app menu globally
  try { Menu.setApplicationMenu(null); } catch (e) {}
  // set application user model id so Windows shows correct app name
  try { if (process.platform === 'win32') app.setAppUserModelId('com.banhangrong.app'); } catch(e) {}
  createWindow();
});


//Connect to database and create pool
async function createPool() {
  if (pool) return pool;
  const cfg = {
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT || '10000', 10),
  };
  pool = mysql.createPool(cfg);
  return pool;
}

// Startup check: used by loading screen to verify DB connectivity before showing login
ipcMain.handle('startup-check', async () => {
  try {
    await createPool();
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    return { ok: true, message: 'connected' };
  } catch (err) {
    // ensure pool is null so next attempt will recreate
    try { if (pool && pool.end) await pool.end(); } catch(e){}
    pool = null;
    return { ok: false, message: err.message };
  }
});

ipcMain.handle('db-query', async (_e, sql, params) => {
  await createPool();
  const [rows] = await pool.execute(sql, params || []);
  return rows;
});

// open external URLs from renderer via preload
ipcMain.handle('open-external', async (_e, url) => {
  try {
    if (!url) throw new Error('No URL provided');
    await shell.openExternal(url);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

// Check license/key handler
ipcMain.handle('check-key', async (_e, payload) => {
  if (!pool) throw new Error('DB pool not initialized');
  try {
    const p = payload || {};
    const key = (p.key || '').trim();
    const userId = p.user_id || null; // might be null if client didn't resolve
    const deviceIdentifier = p.device_identifier || null;

    if (!key) return { ok: false, message: 'No key provided' };

  // parse PRD or PRN formats. Accept date as YYYY-MM-DD or YYYYMMDD
  // examples: PRN123-2025-12-31-ABCDE  or PRD1-20251029-FBD808634891
  const m = key.match(/^(?:PRN|PRD)(\d+)-(?:(\d{4}-\d{2}-\d{2})|(\d{8}))-(.+)$/i);
  if (!m) return { ok: false, message: 'Key format invalid' };
  const productId = parseInt(m[1], 10);
  const expiryRaw = m[2] || m[3];
  // normalize expiry to YYYY-MM-DD for response and for strict parsing
  const expiryNormalized = m[2] ? m[2] : (m[3] ? (m[3].slice(0,4) + '-' + m[3].slice(4,6) + '-' + m[3].slice(6,8)) : null);

    // lookup license by exact license_key (unique)
    const [rows] = await pool.execute('SELECT license_id, order_item_id, user_id, license_key, is_active, activation_date, last_used_date, device_identifier FROM product_licenses WHERE license_key = ? LIMIT 1', [key]);
    if (!rows || rows.length === 0) return { ok: false, message: 'Key not found' };
    const lic = rows[0];

    // check ownership if userId provided
    if (userId && lic.user_id !== userId) return { ok: false, message: 'Key does not belong to current user' };

    // check active flag
    if (!lic.is_active) return { ok: false, message: 'Key is inactive' };

    // check expiry strictly using normalized date in UTC (end of day)
    if (!expiryNormalized || !/^\d{4}-\d{2}-\d{2}$/.test(expiryNormalized)) {
      return { ok: false, message: 'Key expiry invalid' };
    }
    const [ey, em, ed] = expiryNormalized.split('-').map(n => parseInt(n, 10));
    const expDate = new Date(Date.UTC(ey, em - 1, ed, 23, 59, 59));
    if (isNaN(expDate.getTime())) return { ok: false, message: 'Key expiry invalid' };
    const now = new Date();
    if (expDate.getTime() < now.getTime()) return { ok: false, message: 'Key expired' };

    // update device_identifier, last_used_date and set activation_date on first successful use
    // activation_date will only be set to NOW() if it is currently NULL
    try {
      await pool.execute(
        'UPDATE product_licenses SET device_identifier = ?, last_used_date = NOW(), activation_date = IFNULL(activation_date, NOW()) WHERE license_id = ?',
        [deviceIdentifier, lic.license_id]
      );
    } catch (err) {
      console.error('Failed to update device_identifier/activation_date', err);
    }

    // NOTE: license usage log will be inserted after product info is resolved below

    // fetch product info for the order_item
    const [items] = await pool.execute('SELECT product_id FROM order_items WHERE order_item_id = ? LIMIT 1', [lic.order_item_id]);
    const productIdFromItem = (items && items[0] && items[0].product_id) ? items[0].product_id : null;

    // fetch product details
    let product = null;
    if (productIdFromItem) {
      const [prows] = await pool.execute('SELECT product_id, name, download_url FROM products WHERE product_id = ? LIMIT 1', [productIdFromItem]);
      if (prows && prows[0]) product = prows[0];
    }

    // write a usage log into license_usage_logs for auditing
    // action = 'activate' if activation_date was previously NULL, otherwise 'use'
    try {
      const action = lic.activation_date ? 'use' : 'activate';
      const metaObj = { productIdFromItem };
      if (product && product.name) metaObj.productName = product.name;
      const meta = JSON.stringify(metaObj);
      await pool.execute(
        'INSERT INTO license_usage_logs (license_id, event_time, action, user_id, ip, device, meta) VALUES (?, NOW(), ?, ?, ?, ?, ?)',
        [lic.license_id, action, lic.user_id || null, null, deviceIdentifier, meta]
      );
    } catch (err) {
      // log but don't fail the key check
      console.error('Failed to insert license_usage_logs', err);
    }

  return { ok: true, message: 'Key valid', license: { license_id: lic.license_id }, product, expiry: expiryNormalized };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

// Authentication: verify user by username or email, then update last_login
ipcMain.handle('auth-login', async (_e, identifier, password) => {
  if (!pool) throw new Error('DB pool not initialized');
  try {
    const sql = 'SELECT user_id, username, email, password FROM users WHERE username = ? OR email = ? LIMIT 1';
  console.log('[auth-login] sql:', sql, 'params:', [identifier, identifier]);
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

// Extended authentication: accept a payload with more query fields and options
ipcMain.handle('auth-login-ex', async (_e, payload) => {
  if (!pool) throw new Error('DB pool not initialized');
  try {
    const p = payload || {};
    const identifier = (p.identifier || '').trim();
  // accept both legacy 'phone' and DB column 'phone_number'
  const phone = (p.phone_number || p.phone || '').trim();
    const fullname = (p.fullname || '').trim();
    const store = (p.store || '').trim();
    const role = (p.role || '').trim();
    const password = p.password || '';
    const options = p.options || {};

    const clauses = [];
    const params = [];

    // If method explicitly 'phone', try an exact phone_number match first (faster and avoids mixing with username/email)
    if (p.method === 'phone' && phone) {
      try {
        const phoneSql = 'SELECT user_id, username, email, password FROM users WHERE phone_number = ? LIMIT 1';
        console.log('[auth-login-ex-phone-first] sql:', phoneSql, 'params:', [phone]);
        const [pr] = await pool.execute(phoneSql, [phone]);
        if (pr && pr.length) {
          const user = pr[0];
          const match = await bcrypt.compare(password, user.password);
          if (!match) return { ok: false, message: 'Invalid credentials' };
          await pool.execute('UPDATE users SET last_login = NOW() WHERE user_id = ?', [user.user_id]);
          return { ok: true, user: { user_id: user.user_id, username: user.username, email: user.email } };
        }
        // if not found, fall through to existing behavior (which may use LIKE); optionally we could return not found
      } catch (err) {
        return { ok: false, message: err.message };
      }
    }

    if (identifier) {
      if (options.strict) {
        clauses.push('(username = ? OR email = ?)');
        params.push(identifier, identifier);
      } else {
        clauses.push('(username LIKE ? OR email LIKE ?)');
        params.push('%' + identifier + '%', '%' + identifier + '%');
      }
    }
    if (phone) {
      if (options.strict) { clauses.push('phone_number = ?'); params.push(phone); }
      else { clauses.push('phone_number LIKE ?'); params.push('%' + phone + '%'); }
    }
    if (fullname) {
      if (options.strict) { clauses.push('fullname = ?'); params.push(fullname); }
      else { clauses.push('fullname LIKE ?'); params.push('%' + fullname + '%'); }
    }
    if (store) { clauses.push('store_id = ?'); params.push(store); }
    if (role) { clauses.push('role = ?'); params.push(role); }

    // Build SQL; if no specialized clauses provided, fall back to username/email behavior
    let sql = 'SELECT user_id, username, email, password FROM users';
    if (clauses.length) {
      sql += ' WHERE ' + clauses.join(' AND ');
    } else if (identifier && p.method !== 'phone') {
      // only fall back to username/email search when method is not explicitly 'phone'
      sql += ' WHERE username = ? OR email = ?';
      params.push(identifier, identifier);
    }

    if (options.orderByLastLogin) sql += ' ORDER BY last_login DESC';
    sql += ' LIMIT 1';

  console.log('[auth-login-ex] sql:', sql, 'params:', params, 'payload:', p);
  const [rows] = await pool.execute(sql, params);
    if (!rows || rows.length === 0) return { ok: false, message: 'User not found', details: 'No user matched query' };
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return { ok: false, message: 'Invalid credentials' };
    await pool.execute('UPDATE users SET last_login = NOW() WHERE user_id = ?', [user.user_id]);
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

// Ensure all spawned child processes are terminated when the app quits
app.on('before-quit', () => {
  try {
    for (const child of Array.from(launchedChildren)) {
      try { killProcessTree(child.pid); } catch {}
    }
  } catch {}
});

app.on('will-quit', () => {
  try {
    for (const child of Array.from(launchedChildren)) {
      try { killProcessTree(child.pid); } catch {}
    }
  } catch {}
});

// Provide a stable, persisted machine id for the renderer.
// The id is stored in the app userData folder so it survives restarts and updates.
ipcMain.handle('get-machine-id', async () => {
  try {
    const file = path.join(app.getPath('userData'), 'machine_id');
    try {
      const existing = await fs.readFile(file, 'utf8');
      if (existing) return existing.trim();
    } catch (readErr) {
      // file not found or unreadable - we'll create one
    }
    const id = (crypto && typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, id, 'utf8');
    } catch (writeErr) {
      console.error('Failed to persist machine id', writeErr);
    }
    return id;
  } catch (err) {
    console.error('get-machine-id error', err);
    return null;
  }
});

// Provide basic system information (non-sensitive) to renderer on demand.
// Returns hostname, platform, arch, release, cpu model/count, total/freemem, MACs and IPv4 addresses (non-internal).
ipcMain.handle('get-system-info', async () => {
  try {
    const os = require('os');
    const nets = os.networkInterfaces() || {};
    const macs = [];
    const ipv4s = [];
    for (const name of Object.keys(nets)) {
      for (const ni of nets[name]) {
        if (!ni.internal) {
          if (ni.mac) macs.push(ni.mac);
          if (ni.family === 'IPv4' && ni.address) ipv4s.push(ni.address);
        }
      }
    }
    const cpus = os.cpus() || [];
    return {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      cpu: { model: cpus[0] ? cpus[0].model : null, count: cpus.length },
      totalmem: os.totalmem(),
      freemem: os.freemem(),
      macs: Array.from(new Set(macs)).filter(m => m && m !== '00:00:00:00:00:00'),
      ipv4s: Array.from(new Set(ipv4s))
    };
  } catch (err) {
    console.error('get-system-info error', err);
    return null;
  }
});

// --- Install/launch helpers ---
async function pathExists(p){ try { await fs.access(p); return true; } catch { return false; } }

function normalizeName(s){ return (s || '').toString().toLowerCase().replace(/[^a-z0-9]/g,''); }

// helper: simple normalize for fuzzy compare
function _norm(s){ return (s || '').toString().toLowerCase().replace(/[^a-z0-9]/g,''); }

// Extract VersionInfo and Authenticode publisher from a Windows executable using PowerShell
async function getWinExeInfo(filePath){
  if (process.platform !== 'win32') return {};
  try {
    const ps = (
      "$ErrorActionPreference = 'SilentlyContinue';\n" +
      "$path = '" + filePath.replace(/'/g, "''") + "';\n" +
      "if (!(Test-Path -LiteralPath $path)) { '{}' | ConvertTo-Json -Compress; exit 0 }\n" +
      "$fi = Get-Item -LiteralPath $path;\n" +
      "$vi = $fi.VersionInfo;\n" +
      "$sig = Get-AuthenticodeSignature -LiteralPath $path;\n" +
      "$pub = $null; $subj = $null;\n" +
      "if ($sig -and $sig.SignerCertificate) {\n" +
      "  $subj = $sig.SignerCertificate.Subject;\n" +
      "  try { $pub = $sig.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) } catch {}\n" +
      "}\n" +
      "[PSCustomObject]@{ FileName = $fi.Name; OriginalFilename = $vi.OriginalFilename; ProductName = $vi.ProductName; FileDescription = $vi.FileDescription; CompanyName = $vi.CompanyName; FileVersion = $vi.FileVersion; ProductVersion = $vi.ProductVersion; SignerSubject = $subj; Publisher = $pub } | ConvertTo-Json -Compress"
    );
    const out = await new Promise((resolve) => {
      cp.execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 10000, maxBuffer: 1024*1024 }, (err, stdout) => {
        if (err) return resolve('{}');
        resolve(stdout || '{}');
      });
    });
    try { return JSON.parse(out); } catch { return {}; }
  } catch { return {}; }
}

// Validate whether a picked exe matches the intended product using fields from DB (if provided)
async function validateExeForProduct(exePath, product){
  try {
    const base = path.basename(exePath || '');
    const info = await getWinExeInfo(exePath);
    const expectedExe = (product.executable_name || product.exe || '').toString().trim();
    const expectedPublisher = (product.expected_publisher || product.publisher || '').toString().trim();
    const expectedProductName = (product.expected_product_name || product.name || '').toString().trim();

    const reasons = [];

    // Name/OriginalFilename check
    if (expectedExe) {
      const byBase = base.toLowerCase() === expectedExe.toLowerCase();
      const byOriginal = info.OriginalFilename && info.OriginalFilename.toLowerCase() === expectedExe.toLowerCase();
      if (!(byBase || byOriginal)) reasons.push('Tên file không khớp executable_name');
    } else if (expectedProductName) {
      const goal = _norm(expectedProductName);
      const fields = [base, info.ProductName, info.FileDescription, info.OriginalFilename].filter(Boolean).map(_norm);
      const anyHit = fields.some(f => f.includes(goal));
      if (!anyHit) reasons.push('Thông tin VersionInfo không khớp tên sản phẩm');
    }

    // Publisher / Company check (if configured)
    if (expectedPublisher) {
      const want = _norm(expectedPublisher);
      const company = _norm(info.CompanyName || '');
      const publisher = _norm(info.Publisher || info.SignerSubject || '');
      if (!(company.includes(want) || publisher.includes(want))) {
        reasons.push('Nhà phát hành/Chữ ký số không khớp');
      }
    }

    return { ok: reasons.length === 0, reason: reasons.join('; '), info };
  } catch (e) {
    return { ok: false, reason: e.message || 'Không xác định' };
  }
}

// Heuristic to detect if a file is likely an installer rather than the main app binary
function isLikelyInstaller(exePath, info){
  try {
    const ext = path.extname(exePath || '').toLowerCase();
    if (ext === '.msi') return true;
    const base = (path.basename(exePath || '').toLowerCase());
    const dirLower = (path.dirname(exePath || '').toLowerCase());
    const s = (t)=> (t||'').toString().toLowerCase();
    const fields = [info?.ProductName, info?.FileDescription, info?.CompanyName, info?.OriginalFilename, info?.Publisher, info?.SignerSubject].map(s).join(' ');
    const setupKeywords = ['setup','installer','install','bootstrapper','uninstall','update','updater','installshield','inno setup','nsis','squirrel'];
    const baseHit = setupKeywords.some(k => base.includes(k));
    const metaHit = setupKeywords.some(k => fields.includes(k));
    const pathHit = dirLower.includes('downloads') || dirLower.includes('temp') || dirLower.includes('tmp');
    // If located under Program Files or Local\Programs, it's more likely an installed app
    const isProgramFiles = dirLower.includes('program files') || dirLower.includes(path.join('appdata','local','programs').toLowerCase());
    if (baseHit || metaHit) return true;
    if (pathHit && !isProgramFiles) return true;
    return false;
  } catch { return false; }
}

// Resolve Windows .lnk shortcut target path via PowerShell (best-effort, capped by callers)
async function resolveShortcutTarget(lnkPath){
  if (process.platform !== 'win32') return null;
  try {
    const ps = (
      "$ErrorActionPreference='SilentlyContinue';\n"+
      "$w = New-Object -ComObject WScript.Shell;\n"+
      "$s = $w.CreateShortcut('" + lnkPath.replace(/'/g, "''") + "');\n"+
      "if ($s -and $s.TargetPath) { $s.TargetPath }"
    );
    const out = await new Promise((resolve)=>{
      cp.execFile('powershell.exe', ['-NoProfile','-NonInteractive','-Command', ps], { windowsHide: true, timeout: 6000 }, (err, stdout)=>{
        if (err) return resolve('');
        resolve((stdout||'').trim());
      });
    });
    return out || null;
  } catch { return null; }
}

async function findInstalledExe(productName, exeHint){
  // Quick heuristic: search common install locations for an .exe whose normalized name contains product name or matches exeHint
  const candidates = new Set();
  if (exeHint && exeHint.endsWith('.exe')) candidates.add(exeHint);
  const pf = process.env['ProgramFiles'];
  const pf86 = process.env['ProgramFiles(x86)'];
  const localPrograms = path.join(os.homedir(), 'AppData', 'Local', 'Programs');
  const startMenu = path.join(process.env['ProgramData'] || 'C://ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const roots = [pf, pf86, localPrograms, startMenu].filter(Boolean);
  const targetNorm = normalizeName(productName);
  const maxFiles = 8000;
  const maxDepth = 3;
  let lnkResolved = 0;
  let scanned = 0;
  async function walk(dir, depth){
    if (depth > maxDepth) return null;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch { return null; }
    for (const ent of entries){
      if (scanned > maxFiles) return null;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()){
        // Skip some heavy folders
        const name = ent.name.toLowerCase();
        if (name.startsWith('windowsapps') || name === 'windows' || name === '$recycle.bin') continue;
        const found = await walk(full, depth+1);
        if (found) return found;
      } else if (ent.isFile()){
        scanned++;
        const lower = ent.name.toLowerCase();
        if (lower.endsWith('.exe')){
          const norm = normalizeName(ent.name);
          if ((exeHint && lower === exeHint.toLowerCase()) || (targetNorm && norm.includes(targetNorm))){
            // avoid returning installers if possible
            const info = await getWinExeInfo(full);
            if (!isLikelyInstaller(full, info)) return full;
          }
        } else if (lower.endsWith('.lnk') && lnkResolved < 100) {
          // Resolve a few shortcuts in Start Menu
          lnkResolved++;
          const target = await resolveShortcutTarget(full);
          if (target && target.toLowerCase().endsWith('.exe')){
            const base = path.basename(target);
            const norm = normalizeName(base);
            if ((exeHint && base.toLowerCase() === exeHint.toLowerCase()) || (targetNorm && norm.includes(targetNorm))){
              const info = await getWinExeInfo(target);
              if (!isLikelyInstaller(target, info)) return target;
            }
          }
        }
      }
    }
    return null;
  }
  for (const r of roots){
    const found = await walk(r, 0);
    if (found) return found;
  }
  return null;
}
async function readJsonSafe(filePath, fallback){
  try { const d = await fs.readFile(filePath, 'utf8'); return JSON.parse(d); } catch(e){ return fallback; }
}
async function writeJsonSafe(filePath, obj){
  try { await fs.mkdir(path.dirname(filePath), { recursive: true }); await fs.writeFile(filePath, JSON.stringify(obj, null, 2), 'utf8'); } catch(e){ /* ignore */ }
}
function downloadFile(url, dest, onProgress, controller, requestId, wc){
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? require('https') : require('http');
      const req = mod.get(u, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(downloadFile(res.headers.location, dest, onProgress, controller, requestId, wc));
        }
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
        const total = parseInt(res.headers['content-length'] || '0', 10) || 0;
        let downloaded = 0;
        if (typeof onProgress === 'function') onProgress({ stage: 'start', total });
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (typeof onProgress === 'function') onProgress({ stage: 'progress', downloaded, total, percent: total ? Math.min(100, Math.round(downloaded*100/total)) : null });
        });
        const file = require('fs').createWriteStream(dest);
        if (controller) {
          controller.cancel = () => {
            try { req.destroy(new Error('cancelled')); } catch {}
            try { file.destroy(new Error('cancelled')); } catch {}
            try { require('fs').unlink(dest, ()=>{}); } catch {}
            if (wc) wc.send('product-download-error', { requestId, stage: 'cancelled', productId: controller.productId, file: dest, message: 'Cancelled by user' });
          };
          downloadControllers.set(requestId, controller);
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => {
          if (typeof onProgress === 'function') onProgress({ stage: 'complete', downloaded, total, percent: 100 });
          if (controller) downloadControllers.delete(requestId);
          resolve(dest);
        }));
        file.on('error', (err) => { if (controller) downloadControllers.delete(requestId); reject(err); });
      });
      req.on('error', (err) => {
        if (typeof onProgress === 'function') onProgress({ stage: 'error', message: err.message });
        if (controller) downloadControllers.delete(requestId);
        reject(err);
      });
    } catch (err) { if (typeof onProgress === 'function') onProgress({ stage: 'error', message: err.message }); reject(err); }
  });
}

// IPC: Ensure product is installed and launch it. If not installed, download installer and run it, then optionally prompt for exe path to save for next time.
ipcMain.handle('open-or-install-product', async (_e, payload) => {
  try {
    const p = payload || {};
    const product = p.product || {};
    const productId = product.product_id || product.id || null;
    const productName = (product.name || 'product').toString();
    const downloadUrl = product.download_url || p.download_url || '';
    const requestId = p.requestId || ((crypto && typeof crypto.randomUUID==='function') ? crypto.randomUUID() : (Date.now().toString(36)+Math.random().toString(36).slice(2)) );
    const wc = _e?.sender;
    const parentWin = (BrowserWindow.getFocusedWindow ? (BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]) : null) || null;

    if (!productId) return { ok: false, message: 'Missing product_id' };

    const userDir = app.getPath('userData');
    const mapFile = path.join(userDir, 'product_launchers.json');
    const launcherMap = await readJsonSafe(mapFile, {});
    if (p.resetMapping && productId && launcherMap[productId]) {
      delete launcherMap[productId];
      await writeJsonSafe(mapFile, launcherMap);
    }
    let existingPath = launcherMap[productId];
    let bypassInitialAsk = false;

    if (existingPath && await pathExists(existingPath)) {
      try {
        if (p.silentWhenMapped === true && !p.forcePrompt) {
          const val = await validateExeForProduct(existingPath, product);
          if (val.ok) {
            spawnTracked(existingPath, [], { stdio: 'ignore' });
            return { ok: true, launched: true, message: 'Launched existing app', path: existingPath };
          } else {
            delete launcherMap[productId];
            await writeJsonSafe(mapFile, launcherMap);
          }
        } else {
          // Hỏi người dùng dù đã có mapping
          const choiceMapped = await dialog.showMessageBox(parentWin, {
            type: 'question',
            title: 'Mở ứng dụng',
            message: `Đã tìm thấy file chạy đã lưu cho '${productName}'. Bạn muốn làm gì?`,
            detail: existingPath,
            buttons: ['Mở ngay', 'Chọn file .exe', 'Tải và cài đặt', 'Hủy'],
            defaultId: 0,
            cancelId: 3,
            noLink: true
          });
          if (choiceMapped.response === 0) {
            const val = await validateExeForProduct(existingPath, product);
            if (val.ok) {
              spawnTracked(existingPath, [], { stdio: 'ignore' });
              return { ok: true, launched: true, message: 'Launched existing app', path: existingPath };
            } else {
              delete launcherMap[productId];
              await writeJsonSafe(mapFile, launcherMap);
              // tiếp tục sang hỏi/cài đặt
            }
          } else if (choiceMapped.response === 1) {
            // Nhảy vào luồng chọn file
            while (true) {
              const pick = await dialog.showOpenDialog(parentWin, {
                title: 'Chọn file .exe của ' + productName,
                properties: ['openFile'],
                filters: [{ name: 'Executable', extensions: ['exe'] }]
              });
              if (pick.canceled || !pick.filePaths || !pick.filePaths[0]) break;
              const exePath = pick.filePaths[0];
              if (!(await pathExists(exePath))) break;
              const val = await validateExeForProduct(exePath, product);
              const info = await getWinExeInfo(exePath);
              const likelyInstaller = isLikelyInstaller(exePath, info) && !product.is_portable;
              if (val.ok && !likelyInstaller) {
                launcherMap[productId] = exePath;
                await writeJsonSafe(mapFile, launcherMap);
                spawnTracked(exePath, [], { stdio: 'ignore' });
                return { ok: true, launched: true, message: 'Đã mở ứng dụng từ file đã chọn', path: exePath };
              } else if (likelyInstaller) {
                const act = await dialog.showMessageBox(parentWin, {
                  type: 'question',
                  title: 'Bạn đang chọn file cài đặt',
                  message: 'File này có vẻ là bộ cài. Bạn muốn chạy cài đặt rồi chọn lại file chạy?',
                  buttons: ['Chạy cài đặt', 'Chọn lại', 'Hủy'],
                  defaultId: 0, cancelId: 2, noLink: true
                });
                if (act.response === 0) { try { spawnTracked(exePath, [], { stdio: 'ignore' }); } catch {} continue; }
                if (act.response === 2) return { ok: false, message: 'User cancelled' };
              } else {
                const retry = await dialog.showMessageBox(parentWin, {
                  type: 'warning',
                  title: 'File không khớp ứng dụng',
                  message: 'File .exe bạn chọn không khớp với ứng dụng yêu cầu.',
                  detail: val.reason || 'Vui lòng chọn đúng file thực thi của ứng dụng.',
                  buttons: ['Chọn lại', 'Hủy'],
                  defaultId: 0, cancelId: 1, noLink: true
                });
                if (retry.response === 1) return { ok: false, message: 'User cancelled' };
              }
            }
          } else if (choiceMapped.response === 2) {
            // Tải và cài đặt -> bỏ qua prompt ban đầu
            bypassInitialAsk = true;
          } else {
            return { ok: false, message: 'User cancelled' };
          }
        }
      } catch (err) {
        // fall through to re-install
      }
    }

    // Simpler path: ask user if they want to chọn file .exe có sẵn hay tải từ Internet
    try {
      if (bypassInitialAsk) throw new Error('bypass-initial-ask');
      const choice = await dialog.showMessageBox(parentWin, {
        type: 'question',
        title: 'Mở ứng dụng',
        message: `Bạn đã cài '${productName}' chưa?`,
        detail: 'Chọn file .exe nếu ứng dụng đã có sẵn trong máy. Hoặc chọn tải và cài đặt từ Internet.',
        buttons: ['Chọn file .exe', 'Tải và cài đặt', 'Hủy'],
        defaultId: 0,
        cancelId: 2,
        noLink: true
      });
      if (choice.response === 0) {
        // Pick existing exe (loop until valid or cancel)
        while (true) {
          const pick = await dialog.showOpenDialog(parentWin, {
            title: 'Chọn file .exe của ' + productName,
            properties: ['openFile'],
            filters: [{ name: 'Executable', extensions: ['exe'] }]
          });
          if (pick.canceled || !pick.filePaths || !pick.filePaths[0]) break;

          const exePath = pick.filePaths[0];
          if (!(await pathExists(exePath))) break;

          const val = await validateExeForProduct(exePath, product);
          const info = await getWinExeInfo(exePath);
          const likelyInstaller = isLikelyInstaller(exePath, info) && !product.is_portable;
          if (val.ok && !likelyInstaller) {
            launcherMap[productId] = exePath;
            await writeJsonSafe(mapFile, launcherMap);
            spawnTracked(exePath, [], { stdio: 'ignore' });
            return { ok: true, launched: true, message: 'Đã mở ứng dụng từ file đã chọn', path: exePath };
          } else if (likelyInstaller) {
            const act = await dialog.showMessageBox(parentWin, {
              type: 'question',
              title: 'Bạn đang chọn file cài đặt',
              message: 'File bạn chọn có vẻ là bộ cài (installer). Bạn muốn chạy cài đặt và sau đó chọn file chạy của ứng dụng?',
              detail: 'Khuyến nghị: chạy cài đặt để app nằm trong Program Files/AppData rồi chọn đúng file chạy của app.',
              buttons: ['Chạy cài đặt', 'Chọn lại', 'Hủy'],
              defaultId: 0, cancelId: 2, noLink: true
            });
            if (act.response === 0) {
              try { spawnTracked(exePath, [], { stdio: 'ignore' }); } catch {}
              // Sau khi cài, yêu cầu chọn file chạy thật
              continue;
            }
            if (act.response === 2) return { ok: false, message: 'User cancelled' };
            // chọn lại -> lặp tiếp
          } else {
            const retry = await dialog.showMessageBox(parentWin, {
              type: 'warning',
              title: 'File không khớp ứng dụng',
              message: 'File .exe bạn chọn không khớp với ứng dụng yêu cầu.',
              detail: val.reason || 'Vui lòng chọn đúng file thực thi của ứng dụng.',
              buttons: ['Chọn lại', 'Hủy'],
              defaultId: 0,
              cancelId: 1,
              noLink: true
            });
            if (retry.response === 1) return { ok: false, message: 'User cancelled' };
            // if chọn lại -> lặp tiếp
          }
        }
        // if user canceled or invalid, fall through to next steps
      } else if (choice.response === 2) {
        return { ok: false, message: 'User cancelled' };
      }
    } catch (e) { /* ignore dialog errors */ }

    // Try to detect installed app automatically before downloading
    try {
      const hint = product.executable_name || '';
      const auto = await findInstalledExe(productName, hint);
      if (auto && await pathExists(auto)){
        const info = await getWinExeInfo(auto);
        const likelyInstaller = isLikelyInstaller(auto, info) && !product.is_portable;
        if (!likelyInstaller){
          const val = await validateExeForProduct(auto, product);
          if (val.ok) {
            launcherMap[productId] = auto;
            await writeJsonSafe(mapFile, launcherMap);
            spawnTracked(auto, [], { stdio: 'ignore' });
            return { ok: true, launched: true, message: 'Found installed app and launched', path: auto };
          }
        }
      }
    } catch (e) { /* ignore auto-detect errors */ }

    if (!downloadUrl) {
      return { ok: false, message: 'No download_url available for this product' };
    }

  // Download installer to userData/downloads
    const dlDir = path.join(userDir, 'downloads');
    await fs.mkdir(dlDir, { recursive: true });
    let fileName = 'installer';
    try { const u = new URL(downloadUrl); fileName = path.basename(u.pathname) || fileName; } catch {}
    const dest = path.join(dlDir, fileName);

    try {
      const controller = { productId };
      const startedAt = Date.now();
      await downloadFile(downloadUrl, dest, (prog) => {
        if (!wc) return;
        const nowTs = Date.now();
        const elapsedMs = nowTs - startedAt;
        let speedBps = undefined, etaSec = undefined;
        if (prog.downloaded && elapsedMs > 0) {
          speedBps = Math.max(1, Math.floor((prog.downloaded * 1000) / elapsedMs));
          if (prog.total && prog.total > 0) {
            const remaining = Math.max(0, prog.total - prog.downloaded);
            etaSec = Math.floor(remaining / speedBps);
          }
        }
        if (prog.stage === 'start' || prog.stage === 'progress') wc.send('product-download-progress', { requestId, productId, file: dest, speedBps, etaSec, ...prog });
        if (prog.stage === 'complete') wc.send('product-download-complete', { requestId, productId, file: dest, ...prog });
        if (prog.stage === 'error') wc.send('product-download-error', { requestId, productId, file: dest, ...prog });
      }, controller, requestId, wc);
    } catch (err) {
      if (wc) wc.send('product-download-error', { requestId, productId, file: dest, stage: 'error', message: err.message });
      return { ok: false, message: 'Download failed: ' + err.message };
    }

    // Run installer or app depending on extension
    const ext = path.extname(dest).toLowerCase();
    try {
      if (wc) wc.send('product-install-started', { requestId, productId, file: dest, ext });
      let child;
      if (ext === '.msi') {
  child = spawnTracked('msiexec', ['/i', dest], { stdio: 'ignore' });
      } else if (ext === '.exe') {
        // Determine if downloaded exe is an installer or a portable app
        const info = await getWinExeInfo(dest);
        const likelyInstaller = isLikelyInstaller(dest, info) && !product.is_portable;
        if (likelyInstaller) {
          child = spawnTracked(dest, [], { stdio: 'ignore' });
        } else {
          // Treat as portable app: validate and launch, then persist mapping
          const val = await validateExeForProduct(dest, product);
          if (val.ok) {
            launcherMap[productId] = dest;
            await writeJsonSafe(mapFile, launcherMap);
            try { spawnTracked(dest, [], { stdio: 'ignore' }); } catch {}
            return { ok: true, launched: true, message: 'Đã tải và mở ứng dụng dạng portable', path: dest };
          }
          // If validation fails, fallback to showing in folder
          await shell.showItemInFolder(dest);
          return { ok: true, launchedInstaller: false, message: 'Đã tải xong. Vui lòng cài đặt hoặc chọn đúng file chạy của ứng dụng.', path: dest };
        }
      } else {
        // Unknown format: show in folder for manual action
        await shell.showItemInFolder(dest);
        return { ok: true, launchedInstaller: false, message: 'Downloaded. Please install manually.', path: dest };
      }
      if (child && wc) {
        child.on('close', (code) => {
          wc.send('product-install-closed', { requestId, productId, file: dest, code });
        });
      }
    } catch (err) {
      return { ok: false, message: 'Failed to launch installer: ' + err.message, path: dest };
    }

    // After installer launches, prompt user to locate the installed exe (optional but helpful for next launches)
    try {
      while (true) {
        const result = await dialog.showOpenDialog(parentWin, {
          title: 'Chọn file .exe của ' + productName + ' sau khi cài đặt',
          properties: ['openFile'],
          filters: [{ name: 'Executable', extensions: ['exe'] }]
        });
        if (result.canceled || !result.filePaths || !result.filePaths[0]) break;

        const exePath = result.filePaths[0];
        const info = await getWinExeInfo(exePath);
        const likelyInstaller = isLikelyInstaller(exePath, info) && !product.is_portable;
        const val = await validateExeForProduct(exePath, product);
        if (val.ok && !likelyInstaller) {
          launcherMap[productId] = exePath;
          await writeJsonSafe(mapFile, launcherMap);
          // try launch immediately
          try { spawnTracked(exePath, [], { stdio: 'ignore' }); } catch {}
          return { ok: true, installed: true, launched: true, path: exePath };
        } else if (likelyInstaller) {
          const retry = await dialog.showMessageBox(parentWin, {
            type: 'warning',
            title: 'Bạn đang chọn file cài đặt',
            message: 'File này có vẻ là bộ cài. Vui lòng chọn file chạy của ứng dụng sau khi cài (thường ở Program Files / AppData).',
            buttons: ['Chọn lại', 'Bỏ qua'],
            defaultId: 0,
            cancelId: 1,
            noLink: true
          });
          if (retry.response === 1) break;
        } else {
          const retry = await dialog.showMessageBox(parentWin, {
            type: 'warning',
            title: 'File không khớp ứng dụng',
            message: 'File .exe bạn chọn không khớp với ứng dụng yêu cầu.',
            detail: val.reason || 'Vui lòng chọn đúng file thực thi của ứng dụng.',
            buttons: ['Chọn lại', 'Bỏ qua'],
            defaultId: 0,
            cancelId: 1,
            noLink: true
          });
          if (retry.response === 1) break;
        }
      }
    } catch (e) {
      // ignore dialog errors
    }

    return { ok: true, launchedInstaller: true, message: 'Installer launched', path: dest, requestId };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

// Cancel active product download by requestId
ipcMain.handle('cancel-product-download', async (_e, requestId) => {
  const ctrl = downloadControllers.get(requestId);
  if (!ctrl || typeof ctrl.cancel !== 'function') return { ok: false, message: 'No active download' };
  try { ctrl.cancel(); downloadControllers.delete(requestId); return { ok: true, cancelled: true }; } catch (err) { return { ok: false, message: err.message }; }
});

// Reveal file in folder
ipcMain.handle('reveal-file', async (_e, filePath) => {
  try { await shell.showItemInFolder(filePath); return { ok: true }; } catch (err) { return { ok: false, message: err.message }; }
});
