const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startupCheck: () => ipcRenderer.invoke('startup-check'),
  dbQuery: (sql, params) => ipcRenderer.invoke('db-query', sql, params),
  authLogin: (user, pass) => ipcRenderer.invoke('auth-login', user, pass)
});
