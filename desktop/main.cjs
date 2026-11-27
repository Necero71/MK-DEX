// MK-DEX desktop shell: the same web build, served from app://mk-dex with WebUSB allowed.
const { app, BrowserWindow, Menu, dialog, net, protocol, session } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ORIGIN = "app://mk-dex";
const ROOT = path.join(__dirname, "web");
const PERMISSIONS = new Set(["usb", "fullscreen", "screen-wake-lock", "keyboardLock"]);

// A custom secure origin: WebUSB, fetch, workers and the stored ADB key all work (file:// breaks them).
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const ours = (url) => typeof url === "string" && (url === ORIGIN || url.startsWith(`${ORIGIN}/`));

function serve(request) {
  const { host, pathname } = new URL(request.url);
  const file = path.join(ROOT, decodeURIComponent(pathname === "/" ? "/index.html" : pathname));
  const relative = path.relative(ROOT, file);
  if (host !== "mk-dex" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return new Response("Not found", { status: 404 });
  }
  return net.fetch(pathToFileURL(file).toString());
}

function allowUsb(ses) {
  ses.setPermissionCheckHandler((_wc, permission, origin) => ours(origin) && PERMISSIONS.has(permission));
  ses.setPermissionRequestHandler((wc, permission, callback) => callback(ours(wc.getURL()) && PERMISSIONS.has(permission)));
  ses.setDevicePermissionHandler((d) => d.deviceType === "usb" && ours(d.origin));

  // Electron has no built-in USB chooser.
  ses.on("select-usb-device", (event, details, callback) => {
    event.preventDefault();
    const devices = details.deviceList;
    if (devices.length <= 1) return callback(devices[0]?.deviceId);
    const names = devices.map((d) => `${d.productName || "USB device"} ${d.serialNumber || ""}`.trim());
    dialog
      .showMessageBox({ type: "question", message: "Which phone?", buttons: [...names, "Cancel"], cancelId: names.length })
      .then(({ response }) => callback(devices[response]?.deviceId));
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 480,
    minHeight: 360,
    backgroundColor: "#1d2116",
    title: "MK-DEX",
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => { if (!ours(url)) event.preventDefault(); });
  // No menu bar, so shortcuts go to the phone; F11 still toggles fullscreen.
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F11") {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });
  void win.loadURL(`${ORIGIN}/index.html`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win?.isMinimized()) win.restore();
    win?.focus();
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    protocol.handle("app", serve);
    allowUsb(session.defaultSession);
    createWindow();
  });
  app.on("window-all-closed", () => app.quit());
}
