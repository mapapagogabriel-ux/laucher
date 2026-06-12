const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { launchGame, GAME_DIR } = require('./launcher');
const { autoUpdater } = require('electron-updater');

// Configure autoUpdater
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

// Disable GPU acceleration issues on some systems
app.disableHardwareAcceleration();

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 580,
    resizable: false,
    maximizable: false,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0a0c',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    show: false
  });

  mainWindow.loadFile('index.html');

  // Smooth show after content loads
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Check for updates if running from the packaged executable
    if (app.isPackaged) {
      setTimeout(() => {
        autoUpdater.checkForUpdates().catch(err => console.error("Update check failed:", err));
      }, 3000); // Give the UI a little time to load before checking
    }
  });

  // Open DevTools in dev mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ===== Window Control IPC =====
ipcMain.on('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.close();
});

// ===== Auto-Updater IPC & Events =====
autoUpdater.on('checking-for-update', () => {
  if (mainWindow) mainWindow.webContents.send('update:status', { status: 'checking' });
});

autoUpdater.on('update-available', (info) => {
  if (mainWindow) mainWindow.webContents.send('update:status', { status: 'available', version: info.version });
});

autoUpdater.on('update-not-available', (info) => {
  if (mainWindow) mainWindow.webContents.send('update:status', { status: 'not-available' });
});

autoUpdater.on('error', (err) => {
  if (mainWindow) mainWindow.webContents.send('update:status', { status: 'error', error: err.message });
});

autoUpdater.on('download-progress', (progressObj) => {
  if (mainWindow) mainWindow.webContents.send('update:progress', progressObj);
});

autoUpdater.on('update-downloaded', (info) => {
  if (mainWindow) mainWindow.webContents.send('update:status', { status: 'downloaded', version: info.version });
});

ipcMain.handle('update:install', () => {
  autoUpdater.quitAndInstall();
});

// ===== Shell IPC =====
ipcMain.handle('shell:openPath', async (event, folderPath) => {
  const targetPath = folderPath || GAME_DIR;
  const fs = require('fs');
  fs.mkdirSync(targetPath, { recursive: true });
  return shell.openPath(targetPath);
});

ipcMain.handle('mods:list', async () => {
  const fs = require('fs');
  const modsDir = path.join(GAME_DIR, 'mods');
  fs.mkdirSync(modsDir, { recursive: true });
  try {
    const files = fs.readdirSync(modsDir);
    return files.filter(f => f.endsWith('.jar')).map(f => {
      const stats = fs.statSync(path.join(modsDir, f));
      return { name: f.replace('.jar', ''), file: f, size: (stats.size / 1048576).toFixed(1) };
    });
  } catch { return []; }
});

// ===== Game Launch IPC =====
let isLaunching = false;

ipcMain.handle('game:launch', async (event, { username, ram }) => {
  if (isLaunching) {
    return { success: false, message: 'O jogo já está sendo iniciado.' };
  }

  isLaunching = true;

  try {
    await launchGame({
      username: username || 'NinjaPlayer',
      ram: ram || 4,
      window: mainWindow
    });
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  } finally {
    isLaunching = false;
  }
});

// Get game directory path
ipcMain.handle('game:getDir', () => {
  return GAME_DIR;
});

// ===== Config IPC =====
const fs = require('fs');
const CONFIG_PATH = path.join(GAME_DIR, 'config.json');

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (e) { /* ignore */ }
  return null;
}

function saveConfig(data) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  const existing = readConfig() || {};
  const merged = { ...existing, ...data };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

ipcMain.handle('config:read', () => {
  return readConfig();
});

ipcMain.handle('config:save', (event, data) => {
  return saveConfig(data);
});
