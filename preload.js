const { contextBridge, ipcRenderer } = require('electron');


contextBridge.exposeInMainWorld('electron', {
    window: {
        minimize: () => ipcRenderer.send('minimize-window'),
        maximize: () => ipcRenderer.send('maximize-window'),
        close: () => ipcRenderer.send('close-window')
    },
    fileSystem: {
        selectDirectory: () => ipcRenderer.invoke('select-directory'),
        readDirectory: (path) => ipcRenderer.invoke('read-directory', path),
        navigateUp: (currentPath) => ipcRenderer.invoke('navigate-up', currentPath)
    }
});