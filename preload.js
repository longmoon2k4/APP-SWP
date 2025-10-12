const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startupCheck: () => ipcRenderer.invoke('startup-check'),
  dbQuery: (sql, params) => ipcRenderer.invoke('db-query', sql, params),
  authLogin: (user, pass) => ipcRenderer.invoke('auth-login', user, pass),
  // extended login: accepts a payload { identifier, phone, fullname, store, role, password, options }
  authLoginEx: (payload) => ipcRenderer.invoke('auth-login-ex', payload),
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
});
