const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rentradar', {
  call: async (method, payload) => {
    const res = await ipcRenderer.invoke('api', method, payload);
    if (!res.ok) throw new Error(res.error);
    return res.data;
  },
  onScanStatus: (fn) => {
    const listener = (_event, status) => fn(status);
    ipcRenderer.on('scan-status', listener);
    return () => ipcRenderer.removeListener('scan-status', listener);
  },
});
