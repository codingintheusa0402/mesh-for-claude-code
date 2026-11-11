// The Code map viewer window (renderer/codemap.html): only what it needs, nothing else of Mesh.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('cmap', {
  status: sid => ipcRenderer.invoke('codemap:status', sid),
  generate: sid => ipcRenderer.invoke('codemap:generate', sid),
  cancel: sid => ipcRenderer.invoke('codemap:cancel', sid),
  reveal: p => ipcRenderer.invoke('codemap:reveal', p),
  browser: p => ipcRenderer.invoke('codemap:browser', p),
  show: (file, top) => ipcRenderer.invoke('codemap:show', file, top),
  onChanged: cb => ipcRenderer.on('codemap:changed', () => cb()),
});
