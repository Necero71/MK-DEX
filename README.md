# MK-DEX // Display Link

**Turn any screen into a Samsung DeX display.** Plug your Galaxy into a laptop, a Linux box, an Android tablet or an old phone with one USB-C cable, and get the full DeX desktop on that screen — mouse, keyboard and touch included.

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
| Android tablet / phone | **Chrome** (web app) *or* the **MK-DEX APK** | WebUSB / native UsbManager plugin |
| Firefox / Safari / iOS | ❌ no WebUSB | — |

Web app: deployed to GitHub Pages from `main`. APK: download from the **Actions → Android APK** run (artifact) or a `v*` release.

## Requirements

- **DeX phone:** Galaxy on **One UI 8+** (Android 16). Older One UI can't put DeX on a virtual display — you'd get a stock-Android desktop or a blank screen.
- **USB debugging** on: Settings → About phone → Software information → tap *Build number* 7×, then Developer options → USB debugging. Accept the RSA prompt (tick *Always allow*).
- **Phone-to-tablet/phone:** the display device must be USB **host**. If it doesn't see the phone, swipe down on the display device → USB notification → *USB controlled by: this device*. A USB-C OTG cable/adapter helps.
- **On a PC:** close anything else holding ADB (`adb kill-server`, Android Studio, desktop scrcpy) — only one program can own the USB interface.

## Use

1. Open MK-DEX on the display device.
2. Pick resolution (**Auto** matches the screen), UI scale, bitrate.
3. **Connect phone** → select it → accept the prompt on the phone.
4. DeX appears. Side toolbar: Back / Home / Recents / type text / fullscreen / disconnect.

## Develop

```bash
npm install          # also downloads scrcpy-server 3.3.3
npm run dev          # http://localhost:5173 (WebUSB needs localhost or https)
npm test
npm run build

# Android
npm run android:sync # build + copy into android/
npm run android:open # Android Studio → Run
```

```
src/
  dex/session.ts     ADB auth → push server → virtual display → decode
  dex/input.ts       pointer / wheel / keyboard → scrcpy control messages
  dex/display.ts     resolution + DPI maths
  usb/index.ts       picks WebUSB or the native bridge
  usb/native-usb.ts  WebUSB-compatible shim over the MkUsb plugin
android/app/src/main/java/com/mavrokinetic/mkdex/
  MkUsbPlugin.java   UsbManager ↔ JS (permission, claim, bulk transfers)
```

## Roadmap

- [x] v0.1 — USB mode: web/PWA + Android APK
- [ ] Audio forwarding (Opus → WebAudio)
- [ ] Wi-Fi mode (Wireless debugging pairing, native TCP in the APK)
- [ ] Desktop build (Electron/Tauri) with bundled adb for one-click
- [ ] **Miracast receiver mode** so the device shows up under DeX → Wireless — see [docs/MIRACAST.md](docs/MIRACAST.md)

## Credits & licence

MIT. Uses [scrcpy](https://github.com/Genymobile/scrcpy) (Apache-2.0) by Genymobile/rom1v and [Tango / ya-webadb](https://github.com/yume-chan/ya-webadb) (MIT) by Simon Chan. Not affiliated with Samsung; "DeX" is a Samsung trademark.
