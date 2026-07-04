// Singularity Tycoon — desktop shell (production-track item, issue #46).
// The game itself stays a zero-build static site; this wrapper just gives it
// a window, a persistent profile for localStorage saves, and (later) the
// Steamworks bridge. Keep this file boring.
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// In a packaged build the site is copied to app/ beside this file (inside
// app.asar); in dev we load the repo checkout directly (one directory up).
function indexPath() {
  const packaged = path.join(__dirname, 'app', 'index.html');
  if (fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, '..', 'index.html');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#06080f',
    autoHideMenuBar: true,
    title: 'Singularity Tycoon',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // WebAudio starts on the first click (the music prompt) — no autoplay
      // wrestling needed, but keep the policy permissive for the desktop app.
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  // External links (wishlist button, once STEAM_STORE_URL is set) open in the
  // system browser, never inside the game window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadFile(indexPath());
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
