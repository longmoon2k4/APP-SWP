const status = document.getElementById('status');
const pingBtn = document.getElementById('ping');
const dbStatus = document.getElementById('dbstatus');
const dbTestBtn = document.getElementById('dbtest');

pingBtn.addEventListener('click', async () => {
  status.textContent = 'Status: Pinging...';
  try {
    // If main process had a handler this would call it. Example kept for extension.
    if (window.electronAPI?.ping) {
      const res = await window.electronAPI.ping();
      status.textContent = 'Status: ' + (res ?? 'pong');
    } else {
      status.textContent = 'Status: electronAPI not available (running in browser?)';
    }
  } catch (err) {
    status.textContent = 'Status: Error - ' + err.message;
  }
});

dbTestBtn.addEventListener('click', async () => {
  dbStatus.textContent = 'DB: Testing...';
  try {
    if (window.electronAPI?.dbTest) {
      const res = await window.electronAPI.dbTest();
      dbStatus.textContent = 'DB: ' + (res?.message ?? JSON.stringify(res));
    } else {
      dbStatus.textContent = 'DB: electronAPI not available';
    }
  } catch (err) {
    dbStatus.textContent = 'DB: Error - ' + err.message;
  }
});

// Login handling
const loginBtn = document.getElementById('login-btn');
const loginIdentifier = document.getElementById('login-identifier');
const loginPassword = document.getElementById('login-password');
const loginStatus = document.getElementById('login-status');

loginBtn.addEventListener('click', async () => {
  loginStatus.textContent = 'Logging in...';
  try {
    if (!window.electronAPI?.authLogin) {
      loginStatus.textContent = 'authLogin not available';
      return;
    }
    const id = loginIdentifier.value.trim();
    const pw = loginPassword.value;
    const res = await window.electronAPI.authLogin(id, pw);
    if (res?.ok) {
      loginStatus.textContent = 'Logged in as ' + res.user.username;
    } else {
      loginStatus.textContent = 'Login failed: ' + (res?.message ?? 'unknown');
    }
  } catch (err) {
    loginStatus.textContent = 'Error: ' + err.message;
  }
});
