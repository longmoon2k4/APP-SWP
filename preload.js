const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startupCheck: () => ipcRenderer.invoke('startup-check'),
  dbQuery: (sql, params) => ipcRenderer.invoke('db-query', sql, params),
  authLogin: (user, pass) => ipcRenderer.invoke('auth-login', user, pass),
  // extended login: accepts a payload { identifier, phone, fullname, store, role, password, options }
  authLoginEx: (payload) => ipcRenderer.invoke('auth-login-ex', payload),
  checkKey: (payload) => ipcRenderer.invoke('check-key', payload),
  // return a stable machine id persisted by the main process
  getMachineId: async () => {
    try {
      return await ipcRenderer.invoke('get-machine-id');
    } catch (err) {
      return null;
    }
  },
  // return basic system info from main (hostname, platform, cpu, ram, macs, ipv4s)
  getSystemInfo: async () => {
    try {
      return await ipcRenderer.invoke('get-system-info');
    } catch (err) {
      return null;
    }
  },
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
});
