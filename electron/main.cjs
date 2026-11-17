const { app, BrowserWindow, shell, ipcMain, Tray, Menu, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { createWhatsAppService } = require("./whatsapp-service.cjs");

// Preserve the existing Windows browser profile, linked WhatsApp session, message queue and caches
// after the visible product is renamed AXIVESTRA. productName otherwise changes Electron userData.
const previousProductDataPath = path.join(app.getPath("appData"), "EstateFlow");
fs.mkdirSync(previousProductDataPath, { recursive: true });
app.setPath("userData", previousProductDataPath);

// One desktop process owns the shared WhatsApp linked-device auth directory.
// A second process can otherwise create a competing socket and disconnect the first.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

let mainWindow = null;
let tray = null;
let whatsappService = null;
let isQuitting = false;


// Native backup/export dialogs keep PC file transfer out of renderer Blob URLs.
function assertTrustedBackupSender(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    throw new Error("AXIVESTRA file access is available only to the application window.");
  }
}

ipcMain.handle("axivestra:save-file", async (event, payload = {}) => {
  assertTrustedBackupSender(event);
  const requestedName = String(payload.fileName || "axivestra-export.json").slice(0, 180);
  const safeName = path.basename(requestedName).replace(/[<>:"\/\\|?*]+/g, "_") || "axivestra-export.json";
  const encoding = payload.encoding === "base64" ? "base64" : "utf8";
  const contents = typeof payload.contents === "string" ? payload.contents : "";
  const buffer = Buffer.from(contents, encoding);
  if (buffer.byteLength > 150 * 1024 * 1024) throw new Error("This export exceeds the 150 MB file limit.");
  const extension = path.extname(safeName).replace(/^\./, "").toLowerCase() || "json";
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Save AXIVESTRA file",
    defaultPath: path.join(app.getPath("downloads"), safeName),
    filters: [{ name: "AXIVESTRA file", extensions: [extension] }, { name: "All files", extensions: ["*"] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.promises.writeFile(result.filePath, buffer);
  return { canceled: false, fileName: path.basename(result.filePath), bytesWritten: buffer.byteLength };
});

ipcMain.handle("axivestra:open-text-file", async event => {
  assertTrustedBackupSender(event);
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose AXIVESTRA JSON backup",
    properties: ["openFile"],
    filters: [{ name: "JSON backup", extensions: ["json"] }, { name: "All files", extensions: ["*"] }]
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const filePath = result.filePaths[0];
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) throw new Error("The selected path is not a file.");
  if (stat.size > 150 * 1024 * 1024) throw new Error("This JSON backup exceeds the 150 MB import limit.");
  const contents = await fs.promises.readFile(filePath, "utf8");
  return { canceled: false, fileName: path.basename(filePath), contents };
});

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 1440, height: 940, minWidth: 980, minHeight: 700,
    show: false, autoHideMenuBar: true, title: "AXIVESTRA — Asset Intelligence",
    icon: path.join(__dirname, "..", "build", "axivestra.ico"),
    backgroundColor: "#071525",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  mainWindow = win;
  // A Windows logon launch starts the sender hidden so schedules can keep running
  // without opening a visible window; the tray menu can always restore the window.
  const launchHidden = process.argv.includes("--hidden");
  win.once("ready-to-show", () => { if (!launchHidden) win.show(); });
  win.on("closed", () => { if (mainWindow === win) mainWindow = null; });
  win.on("close", event => {
    if (!isQuitting && process.platform === "win32") {
      event.preventDefault();
      win.hide();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

async function createTray() {
  try {
    const icon = await app.getFileIcon(process.execPath, { size: "small" });
    tray = new Tray(icon);
    tray.setToolTip("AXIVESTRA — Asset Intelligence running");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Open AXIVESTRA", click: () => createWindow() },
      { label: "Background sender is running", enabled: false },
      { type: "separator" },
      { label: "Exit AXIVESTRA (stops scheduled sending)", click: () => {
        const { dialog } = require("electron");
        const choice = dialog.showMessageBoxSync({
          type: "warning",
          buttons: ["Keep running in background", "Exit anyway"],
          defaultId: 0,
          cancelId: 0,
          title: "Stop scheduled WhatsApp messages?",
          message: "Exiting AXIVESTRA stops scheduled delivery on this PC.",
          detail: "To keep messages sending, leave AXIVESTRA in the system tray. Windows must be powered on, awake and online, with WhatsApp still linked."
        });
        if (choice === 1) { isQuitting = true; if (whatsappService) whatsappService.stop(); app.quit(); }
      } }
    ]));
    tray.on("double-click", () => createWindow());
  } catch (_) {}
}

app.on("second-instance", () => {
  if (!hasSingleInstanceLock) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else if (app.isReady()) {
    createWindow();
  }
});

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  // Opt into run-at-login for the packaged Windows app. The background process starts
  // hidden and is controlled through its tray icon; Exit AXIVESTRA stops scheduling.
  if (process.platform === "win32" && app.isPackaged) {
    try {
      app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, args: ["--hidden"] });
    } catch (_) {}
  }
  whatsappService = createWhatsAppService({
    app, ipcMain,
    notify: payload => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send("estateflow:wa:update", payload);
      }
    }
  });
  createWindow();
  void createTray();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow) createWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  if (whatsappService) whatsappService.stop();
});
app.on("window-all-closed", () => {});
