const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;
let goBackend;

// Add this before creating the window
if (process.platform === 'win32') {
    app.commandLine.appendSwitch('high-dpi-support', '1');
    app.commandLine.appendSwitch('force-device-scale-factor', '1');
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        frame: false,
        icon: path.join(__dirname, 'assets/icon.ico'),
        backgroundColor: '#1a365d',
        useContentSize: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            preload: path.join(__dirname, 'preload.js'),
            zoomFactor: 1.0,
            enableWebgl: true,
            spellcheck: false,
            enableBlinkFeatures: 'HighDPISupport'
        }
    });

    mainWindow.loadFile('src/index.html');
    mainWindow.setIcon(path.join(__dirname, 'assets/icon.ico'));

    // Start the Go backend process
    startGoBackend();

    // Add DPI handling
    mainWindow.webContents.setZoomFactor(1.0);
    mainWindow.webContents.setVisualZoomLevelLimits(1, 1);
}

function startGoBackend() {
    // Get the correct path for the backend executable
    const isDev = !app.isPackaged;  // Better way to check if we're in development
    let backendPath;
    
    if (isDev) {
        // Development: backend is in the backend directory
        backendPath = path.join(__dirname, 'backend', 'main.exe');
    } else {
        // Production: backend is in the app.getAppPath() directory
        backendPath = path.join(app.getAppPath(), 'backend', 'main.exe');
    }

    // Check if the file exists before trying to spawn it
    if (!fs.existsSync(backendPath)) {
        console.error(`Backend executable not found at: ${backendPath}`);
        // Try alternate location
        const altPath = path.join(process.resourcesPath, 'backend', 'main.exe');
        if (fs.existsSync(altPath)) {
            backendPath = altPath;
        } else {
            console.error(`Backend executable not found at alternate path: ${altPath}`);
            throw new Error('Backend executable not found');
        }
    }

    console.log('Starting backend from:', backendPath);
    
    try {
        goBackend = spawn(backendPath);
        
        goBackend.stdout.on('data', (data) => {
            console.log(`Backend output: ${data}`);
        });
        
        goBackend.stderr.on('data', (data) => {
            console.error(`Backend error: ${data}`);
        });

        goBackend.on('error', (error) => {
            console.error('Failed to start backend:', error);
            app.quit();  // Quit the app if backend fails to start
        });

        goBackend.on('exit', (code, signal) => {
            console.log(`Backend process exited with code ${code} and signal ${signal}`);
            if (code !== 0) {
                app.quit();  // Quit the app if backend exits unexpectedly
            }
        });
    } catch (error) {
        console.error('Error spawning backend:', error);
        app.quit();
    }
}

// IPC Handlers
ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    return result.filePaths[0];
});

ipcMain.handle('read-directory', async (event, dirPath) => {
    try {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        return entries.map(entry => ({
            name: entry.name,
            isDirectory: entry.isDirectory(),
            path: path.join(dirPath, entry.name)
        }));
    } catch (error) {
        console.error('Error reading directory:', error);
        throw error;
    }
});

ipcMain.handle('navigate-up', async (event, currentPath) => {
    try {
        const parentPath = path.dirname(currentPath);
        // Check if we can actually read the parent directory
        await fs.promises.access(parentPath, fs.constants.R_OK);
        return parentPath;
    } catch (error) {
        console.error('Error navigating up:', error);
        return currentPath; // Return current path if we can't go up
    }
});

ipcMain.on('minimize-window', () => {
    mainWindow.minimize();
});

ipcMain.on('maximize-window', () => {
    if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
    } else {
        mainWindow.maximize();
    }
});

ipcMain.on('close-window', () => {
    mainWindow.close();
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        if (goBackend) {
            goBackend.kill();
        }
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    if (goBackend) {
        goBackend.kill();
    }
    app.quit();
});