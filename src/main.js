const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    icon: path.join(__dirname, '../assets/icon.ico'),
    webPreferences: {
        nodeIntegration: true,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
    }
}); 