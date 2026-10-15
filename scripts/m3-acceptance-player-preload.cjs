const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('m3OwnedFixture', {
  state: value => ipcRenderer.send('m3-state', value),
  video: bytes => ipcRenderer.send('m3-video', bytes),
  artwork: () => ipcRenderer.invoke('m3-cover'),
});
