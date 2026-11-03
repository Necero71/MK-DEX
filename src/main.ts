import "./styles.css";
import { DexSession } from "./dex/session";
import { PRESETS, SCALES, resolveDisplay, type ScaleId } from "./dex/display";
import { pressKey } from "./dex/input";
import { pickPhone, usbBackend } from "./usb";
import type { PhoneLink } from "./link/types";
import { TcpPhone } from "./net/native-tcp";
import { enableWifi, parseHostPort } from "./net/wifi";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  setup: $("setup"),
  live: $("live"),
  screen: $("screen"),
  backend: $("backend"),
  connect: $<HTMLButtonElement>("connect"),
  error: $("error"),
  log: $("log"),
  preset: $<HTMLSelectElement>("preset"),
  scale: $<HTMLSelectElement>("scale"),
  bitrate: $<HTMLSelectElement>("bitrate"),
  fps: $<HTMLSelectElement>("fps"),
  codec: $<HTMLSelectElement>("codec"),
  resolved: $("resolved"),
  hud: $("hud"),
  typebar: $<HTMLFormElement>("typebar"),
  typein: $<HTMLInputElement>("typein"),
  wifi: $("wifi"),
  wifiHost: $<HTMLInputElement>("wifi-host"),
  wifiConnect: $<HTMLButtonElement>("wifi-connect"),
  wifiEnable: $<HTMLButtonElement>("wifi-enable"),
};

const WIFI_KEY = "mk-dex:wifi-host";

// ---------- settings (persisted per browser; storage may be unavailable) ----------
const KEY = "mk-dex:settings";
const fields = ["preset", "scale", "bitrate", "fps", "codec"] as const;

PRESETS.forEach((p) => ui.preset.add(new Option(p.label, p.id)));
SCALES.forEach((s) => ui.scale.add(new Option(s.label, s.id, s.id === "normal", s.id === "normal")));

try {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, string>;
  for (const f of fields) if (saved[f]) ui[f].value = saved[f];
} catch { /* no storage */ }

function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(fields.map((f) => [f, ui[f].value]))));
  } catch { /* no storage */ }
}

function currentDisplay() {
  return resolveDisplay(ui.preset.value, ui.scale.value as ScaleId, {
    cssWidth: window.screen.width,
    cssHeight: window.screen.height,
    pixelRatio: window.devicePixelRatio || 1,
  });
}

function showResolved() {
  const d = currentDisplay();
  ui.resolved.textContent = `Virtual display: ${d.width}×${d.height} @ ${d.dpi} dpi`;
}
fields.forEach((f) => ui[f].addEventListener("change", () => { saveSettings(); showResolved(); }));
showResolved();

// ---------- log ----------
function log(line: string) {
  const t = new Date().toLocaleTimeString([], { hour12: false });
  ui.log.textContent += `${t}  ${line}\n`;
  ui.log.scrollTop = ui.log.scrollHeight;
}

function showError(msg?: string) {
  ui.error.hidden = !msg;
  ui.error.textContent = msg ?? "";
}

// ---------- backend chip ----------
const backend = usbBackend();
ui.backend.textContent = { webusb: "WEBUSB", native: "ANDROID APP", none: "NO USB" }[backend];
ui.backend.dataset.state = backend;
if (backend === "none") {
  ui.connect.disabled = true;
  showError("This browser can't reach USB. Use Chrome or Edge (desktop or Android), or install the MK-DEX Android app.");
}

// ---------- session ----------
let session: DexSession | undefined;
let wakeLock: WakeLockSentinel | undefined;

async function startSession(getLink: () => Promise<PhoneLink | undefined>) {
  showError();
  setBusy(true);
  try {
    const link = await getLink();
    if (!link) {
      log("No phone selected.");
      return;
    }
    session = new DexSession(link, {
      display: currentDisplay(),
      bitRate: Number(ui.bitrate.value),
      maxFps: Number(ui.fps.value),
      codec: ui.codec.value as "h264" | "h265",
      log,
    });
    ui.setup.hidden = true;
    ui.live.hidden = false;
    await session.start(ui.screen);
    void keepAwake();
    void session.closed.then(endSession);
  } catch (e) {
    const msg = describeError(e);
    log(`✕ ${msg}`);
    showError(msg);
    await session?.stop();
    endSession();
  } finally {
    setBusy(false);
  }
}

function setBusy(busy: boolean) {
  ui.connect.disabled = busy || backend === "none";
  ui.wifiEnable.disabled = busy || backend === "none";
  ui.wifiConnect.disabled = busy;
}

ui.connect.addEventListener("click", () => void startSession(pickPhone));

// ---------- Wi-Fi (APK only: needs native TCP sockets) ----------
if (backend === "native") {
  ui.wifi.hidden = false;
  try { ui.wifiHost.value = localStorage.getItem(WIFI_KEY) ?? ""; } catch { /* no storage */ }
}

function rememberHost(host: string) {
  ui.wifiHost.value = host;
  try { localStorage.setItem(WIFI_KEY, host); } catch { /* no storage */ }
}

ui.wifiEnable.addEventListener("click", async () => {
  showError();
  setBusy(true);
  try {
    const link = await pickPhone();
    if (!link) return log("No phone selected.");
    const ip = await enableWifi(link, log);
    rememberHost(ip);
    log(`✓ Wi-Fi ready. Unplug the cable, then hit “Connect over Wi-Fi” (${ip}).`);
  } catch (e) {
    const msg = describeError(e);
    log(`✕ ${msg}`);
    showError(msg);
  } finally {
    setBusy(false);
  }
});

ui.wifiConnect.addEventListener("click", () => {
  const target = parseHostPort(ui.wifiHost.value);
  if (!target) {
    showError("Enter the phone's IP, e.g. 192.168.0.12 (find it under Settings → Connections → Wi-Fi → ⚙ on your network).");
    ui.wifiHost.focus();
    return;
  }
  rememberHost(ui.wifiHost.value.trim());
  void startSession(async () => new TcpPhone(target.host, target.port));
});

function endSession() {
  session = undefined;
  void wakeLock?.release().catch(() => {});
  wakeLock = undefined;
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  ui.screen.replaceChildren();
  ui.typebar.hidden = true;
  ui.live.hidden = true;
  ui.setup.hidden = false;
}

function describeError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  const msg = e instanceof Error ? e.message : String(e);
  if (name === "DeviceBusyError" || /busy|claim/i.test(msg)) {
    return "USB interface is busy — another ADB (Android Studio, scrcpy, adb server) has the phone. Run `adb kill-server` and retry.";
  }
  if (/Can't reach|ECONNREFUSED|refused|timed out|EHOSTUNREACH|ENETUNREACH/i.test(msg)) {
    return `${msg}. Phone not listening on Wi-Fi — it was rebooted or USB debugging was toggled. Plug in and hit “Enable Wi-Fi” again, and check both devices are on the same network.`;
  }
  if (/Permission|denied/i.test(msg)) return "USB permission was denied. Unplug, replug, and allow access.";
  return msg;
}

async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { /* not allowed */ }
}
document.addEventListener("visibilitychange", () => {
  if (session && document.visibilityState === "visible") void keepAwake();
});

// ---------- HUD ----------
ui.hud.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button");
  if (!btn || !session) return;
  const key = btn.dataset.key as "back" | "home" | "recents" | undefined;
  if (key && session.controller) void pressKey(session.controller, key);
});

$("disconnect").addEventListener("click", () => void session?.stop());

$("fs").addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await ui.live.requestFullscreen({ navigationUI: "hide" });
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })
        .lock?.("landscape").catch(() => {});
    }
  } catch { /* fullscreen not allowed */ }
});

$("hud-toggle").addEventListener("click", () => ui.hud.classList.toggle("collapsed"));

$("kbd").addEventListener("click", () => {
  ui.typebar.hidden = !ui.typebar.hidden;
  if (!ui.typebar.hidden) ui.typein.focus();
});

ui.typebar.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = ui.typein.value;
  if (text && session) await session.typeText(text);
  ui.typein.value = "";
});

log(`MK-DEX ready · USB backend: ${backend}${backend === "native" ? " · Wi-Fi: available" : ""}`);
