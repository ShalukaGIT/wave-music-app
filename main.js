const { app, BrowserWindow, Tray, Menu, nativeImage, screen } = require('electron');
const { execSync, exec } = require('child_process');
const path = require('path');

let mainWindow;
let tray;

const WAVE_HEIGHT = 130;

function getScreenBounds() {
  return screen.getPrimaryDisplay().bounds;
}

// ── Volume helpers via osascript ─────────────
// Works even when Multi-Output Device disables system volume keys
function getVolume() {
  try {
    return parseInt(execSync('osascript -e "output volume of (get volume settings)"').toString().trim());
  } catch { return 50; }
}

function setVolume(level) {
  const clamped = Math.max(0, Math.min(100, level));
  exec(`osascript -e "set volume output volume ${clamped}"`);
}

function isMuted() {
  try {
    return execSync('osascript -e "output muted of (get volume settings)"').toString().trim() === 'true';
  } catch { return false; }
}

function toggleMute() {
  const muted = isMuted();
  exec(`osascript -e "set volume ${muted ? 'without' : 'with'} output muted"`);
}

function buildMenu() {
  const vol = getVolume();
  const muted = isMuted();
  const volBar = '▪'.repeat(Math.round(vol / 10)) + '▫'.repeat(10 - Math.round(vol / 10));

  return Menu.buildFromTemplate([
    { label: '🌊 Wave', enabled: false },
    { type: 'separator' },

    // Volume display + controls
    { label: `🔊 Volume: ${muted ? 'Muted' : vol + '%'}  ${muted ? '' : volBar}`, enabled: false },
    {
      label: '▲  Volume +5',
      click: () => { setVolume(getVolume() + 5); setTimeout(() => tray.setContextMenu(buildMenu()), 150); },
    },
    {
      label: '▼  Volume −5',
      click: () => { setVolume(getVolume() - 5); setTimeout(() => tray.setContextMenu(buildMenu()), 150); },
    },
    { type: 'separator' },
    { label: '🔇  Mute / Unmute', click: () => { toggleMute(); setTimeout(() => tray.setContextMenu(buildMenu()), 150); } },
    { type: 'separator' },

    // Quick volume presets
    { label: '25%',  click: () => { setVolume(25);  setTimeout(() => tray.setContextMenu(buildMenu()), 150); } },
    { label: '50%',  click: () => { setVolume(50);  setTimeout(() => tray.setContextMenu(buildMenu()), 150); } },
    { label: '75%',  click: () => { setVolume(75);  setTimeout(() => tray.setContextMenu(buildMenu()), 150); } },
    { label: '100%', click: () => { setVolume(100); setTimeout(() => tray.setContextMenu(buildMenu()), 150); } },
    { type: 'separator' },

    { label: 'Quit Wave', click: () => app.quit() },
  ]);
}

function createWindow() {
  const b = getScreenBounds();

  mainWindow = new BrowserWindow({
    width: b.width,
    height: WAVE_HEIGHT,
    x: 0,
    y: b.height - WAVE_HEIGHT,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  mainWindow.loadFile('renderer/index.html');

  mainWindow.once('ready-to-show', () => {
    const bounds = getScreenBounds();
    mainWindow.setBounds({ x: 0, y: bounds.height - WAVE_HEIGHT, width: bounds.width, height: WAVE_HEIGHT });
    mainWindow.show();
  });

  mainWindow.on('blur', () => mainWindow.setAlwaysOnTop(true, 'screen-saver'));

  screen.on('display-metrics-changed', () => {
    const bounds = getScreenBounds();
    mainWindow.setBounds({ x: 0, y: bounds.height - WAVE_HEIGHT, width: bounds.width, height: WAVE_HEIGHT });
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-icon.png'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Wave — Music Visualizer');
  tray.setContextMenu(buildMenu());
  // Refresh volume display every time tray is clicked
  tray.on('click', () => tray.setContextMenu(buildMenu()));
}

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
