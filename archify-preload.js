// The Archify viewer window (renderer/archify.html): only what it needs, nothing else of Mesh.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('arch', {
  status: sid => ipcRenderer.invoke('archify:status', sid),
  generate: sid => ipcRenderer.invoke('archify:generate', sid),
  cancel: sid => ipcRenderer.invoke('archify:cancel', sid),
  reveal: p => ipcRenderer.invoke('archify:reveal', p),
  browser: p => ipcRenderer.invoke('archify:browser', p),
  show: (file, top) => ipcRenderer.invoke('archify:show', file, top),
  onChanged: cb => ipcRenderer.on('archify:changed', () => cb()),
});
