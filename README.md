# MK-DEX // Display Link

**Turn any screen into a Samsung DeX display.** Plug your Galaxy into a Windows PC (web or `.exe`), a Linux box, an Android tablet or an old phone with one USB-C cable, and get the full DeX desktop on that screen — mouse, keyboard and touch included.

Built by **Mavro Kinetic · #71**.

## How it works

One UI 8 rebuilt DeX on Android 16's desktop mode, which can run on a **virtual display**. MK-DEX:

1. Talks ADB to the phone over USB (via [Tango](https://tangoapp.dev), a TypeScript ADB client),
2. Pushes the open-source [scrcpy](https://github.com/Genymobile/scrcpy) server (v3.3.3) and asks it for a new virtual display sized to *this* screen,
3. DeX starts on that display, gets encoded on the phone (H.264/H.265), decoded here with WebCodecs, and drawn full-screen,
4. Mouse, touch, scroll and keyboard go back to the phone.

No root. Nothing to install on the phone.

## Where it runs

| Display device | How | USB access |
|---|---|---|
| Windows / macOS / Linux / ChromeOS | Open the web app in **Chrome or Edge** (installable as a PWA) | WebUSB |
| Windows (desktop app) | **MK-DEX .exe** (portable or installer) | WebUSB |
| Android tablet / phone | **Chrome** (web app) *or* the **MK-DEX APK** | WebUSB / native UsbManager plugin |
| Firefox / Safari / iOS | ❌ no WebUSB | — |

Web app: deployed to GitHub Pages from `main`. Windows `.exe`: see [Windows app](#windows-app). APK: download from the **Actions → Android APK** run (artifact) or a `v*` release.

## Requirements

- **DeX phone:** Galaxy on **One UI 8+** (Android 16). Older One UI can't put DeX on a virtual display — you'd get a stock-Android desktop or a blank screen.
- **USB debugging** on: Settings → About phone → Software information → tap *Build number* 7×, then Developer options → USB debugging. Accept the RSA prompt (tick *Always allow*).
- **Phone-to-tablet/phone:** the display device must be USB **host**. If it doesn't see the phone, swipe down on the display device → USB notification → *USB controlled by: this device*. A USB-C OTG cable/adapter helps.
- **On a PC:** close anything else holding ADB (`adb kill-server`, Android Studio, desktop scrcpy) — only one program can own the USB interface.

## Use

1. Open MK-DEX on the display device.
2. Pick resolution (**Auto** matches the screen), UI scale, bitrate.
3. **Connect phone** → select it → accept the prompt on the phone. Next time, hit **Reconnect**.
4. DeX appears. Side toolbar: Back / Home / Recents / type text / fullscreen / disconnect. Drag `⋮` to move it.

## Wi-Fi mode (Android app)

Cable-free after a one-time USB step. Only works in the **APK**, because browsers can't open raw TCP sockets.

1. Plug the phone in and tap **Enable Wi-Fi (needs USB once)**. MK-DEX reads the phone's Wi-Fi IP and switches ADB to port 5555.
2. Unplug, then tap **Connect over Wi-Fi**. The IP is remembered.
3. Do it again after the phone reboots or USB debugging is toggled.

- **No router?** Turn on the phone's hotspot and join it from the display device. MK-DEX picks the hotspot address automatically.
- **Already ran `adb tcpip 5555` from a PC?** Type the phone's IP in and connect.
- **Latency:** 5 GHz Wi-Fi works best. Drop to 8 Mbps / 30 fps if it stutters.
- **Security:** while it's on, anyone on the same network can request ADB access. The phone still asks before trusting a new key. Reboot the phone to switch it off.

## Reconnect and toolbar

- **Reconnect** on the setup screen links the last phone in one tap.
- **Auto-reconnect** retries a dropped link 5 times (about 30 s of waiting). Untick it to switch it off.
- **Toolbar:** drag `⋮` to move it, tap it to hide or show. Both are remembered.

## Windows app

Get it from **Actions → Windows EXE** (artifact) or a `v*` release. To build it yourself on Windows:

```bash
npm install
cd desktop
npm install
npm run dist      # .exe files land in desktop/out/
```

- USB only; Wi-Fi mode is still Android-app only.
- The `.exe` isn't code-signed, so SmartScreen may warn: **More info → Run anyway**.
- Close other ADB users first (`adb kill-server`).

## Develop

```bash
npm install          # also downloads scrcpy-server 3.3.3
npm run dev          # http://localhost:5173 (WebUSB needs localhost or https)
npm test
npm run build

# Windows desktop shell (Electron)
cd desktop && npm install && npm start
cd ..

# Android
npm run android:sync # build + copy into android/
npm run android:open # Android Studio → Run
```

```
src/
  main.ts            UI, session lifecycle, auto-reconnect
  reconnect.ts       last-phone memory + retry backoff
  toolbar.ts         draggable, collapsible toolbar
  dex/session.ts     ADB auth → push server → virtual display → decode
  dex/input.ts       pointer / wheel / keyboard → scrcpy control messages
  dex/display.ts     resolution + DPI maths
  usb/index.ts       picks WebUSB or the native bridge
  usb/native-usb.ts  WebUSB-compatible shim over the MkUsb plugin
  net/adb-stream.ts  ADB packet framing over a TCP byte stream
  net/native-tcp.ts  MkTcp plugin → socket → PhoneLink
  net/wifi.ts        enable tcpip 5555 over USB, pick the phone's IP
desktop/
  main.cjs           Electron shell: app:// origin, USB permissions
  copy-web.cjs       copies dist/ into the desktop app
android/app/src/main/java/com/mavrokinetic/mkdex/
  MkUsbPlugin.java   UsbManager ↔ JS (permission, claim, bulk transfers)
  MkTcpPlugin.java   raw TCP sockets ↔ JS (ADB over Wi-Fi)
```

## Roadmap

- [x] v0.1 — USB mode: web/PWA + Android APK
- [ ] Audio forwarding (Opus → WebAudio)
- [x] v0.2 — Wi-Fi mode in the APK (enable over USB once, then cable-free)
- [ ] Wi-Fi pairing with no cable at all (Android 11+ Wireless debugging + TLS)
- [x] v0.3 — Windows desktop app (Electron, WebUSB)
- [ ] Desktop: bundled adb for one-click, Wi-Fi mode
- [ ] **Miracast receiver mode** so the device shows up under DeX → Wireless — see [docs/MIRACAST.md](docs/MIRACAST.md)

## Credits & licence

MIT. Uses [scrcpy](https://github.com/Genymobile/scrcpy) (Apache-2.0) by Genymobile/rom1v and [Tango / ya-webadb](https://github.com/yume-chan/ya-webadb) (MIT) by Simon Chan. Not affiliated with Samsung; "DeX" is a Samsung trademark.
