const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  ping: () => ipcRenderer.invoke('ping'),
  dbTest: () => ipcRenderer.invoke('db-test'),
  dbQuery: (sql, params) => ipcRenderer.invoke('db-query', sql, params)
  ,authLogin: (user, pass) => ipcRenderer.invoke('auth-login', user, pass)
});
