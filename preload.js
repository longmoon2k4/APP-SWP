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
  // ensure product is installed then launch it (Windows: exe/msi). Saves chosen exe path for next time
  openOrInstallProduct: async (payload) => ipcRenderer.invoke('open-or-install-product', payload),
  // download progress events for product installer
  onProductDownloadProgress: (handler) => {
    const cb = (_e, data) => handler && handler(data);
    ipcRenderer.on('product-download-progress', cb);
    return () => ipcRenderer.removeListener('product-download-progress', cb);
  },
  onProductDownloadComplete: (handler) => {
    const cb = (_e, data) => handler && handler(data);
    ipcRenderer.on('product-download-complete', cb);
    return () => ipcRenderer.removeListener('product-download-complete', cb);
  },
  onProductDownloadError: (handler) => {
    const cb = (_e, data) => handler && handler(data);
    ipcRenderer.on('product-download-error', cb);
    return () => ipcRenderer.removeListener('product-download-error', cb);
  },
  onProductInstallStarted: (handler) => {
    const cb = (_e, data) => handler && handler(data);
    ipcRenderer.on('product-install-started', cb);
    return () => ipcRenderer.removeListener('product-install-started', cb);
  },
  onProductInstallClosed: (handler) => {
    const cb = (_e, data) => handler && handler(data);
    ipcRenderer.on('product-install-closed', cb);
    return () => ipcRenderer.removeListener('product-install-closed', cb);
  },
  cancelProductDownload: async (requestId) => ipcRenderer.invoke('cancel-product-download', requestId),
  revealFile: async (filePath) => ipcRenderer.invoke('reveal-file', filePath),
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
});
