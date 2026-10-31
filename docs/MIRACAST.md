# Phase 2 — Miracast receiver mode

**Goal:** make a device show up in the phone's own **DeX → Wireless** list, no cable, no USB debugging.

Since One UI 8, Samsung's Wireless DeX targets Miracast receivers (smart TVs, Windows "Wireless Display"). So MK-DEX needs to act as a **Miracast sink**.

## Why it's phase 2

| | USB mode (v0.1) | Miracast mode |
|---|---|---|
| Phone setup | USB debugging once | None — uses the DeX menu |
| Transport | ADB over USB | Wi-Fi Direct (P2P) + RTSP + MPEG-TS/H.264 |
| Runs in a browser | ✅ WebUSB | ❌ browsers can't do Wi-Fi Direct or raw sockets |
| Android APK | ✅ | ⚠️ Wi-Fi Display *sink* APIs are hidden/system-only on stock Android |
| Linux box | ✅ (Chrome) | ✅ if the Wi-Fi card supports P2P (`iw list` → "P2P-GO") |
| Windows | ✅ (Chrome/Edge) | Already built in: *Settings → System → Projecting to this PC* |

## Plan

1. **Linux sink first** (the DH55TC / CasaOS box, a Pi, a Mint laptop):
   - `wpa_supplicant` P2P group owner with WFD IEs advertised (`wfd_subelem_set`).
   - RTSP M1–M7 handshake (capability negotiation, `wfd_video_formats`, UIBC for mouse/keyboard).
   - GStreamer: `udpsrc ! tsdemux ! h264parse ! vah264dec/avdec_h264 ! autovideosink`.
   - Reference implementations: `lazycast` (Pi), `MiracleCast` `miracle-sinkctl`, `gnome-network-displays` (source side, useful for protocol details).
   - Ship as a Docker container (`--net=host --privileged` for the Wi-Fi interface) so it fits the CasaOS setup.
2. **Detect the Windows built-in receiver** and just show setup steps in the app.
3. **Android sink** only if a non-root path appears; rooted / custom-ROM devices can use the system WFD sink.

## Open questions

- Does One UI 8 Wireless DeX require Samsung-specific RTSP parameters beyond standard WFD R2? Needs a packet capture against a Samsung TV.
- UIBC (input back-channel) support — without it the receiver is display-only and input stays on the phone.
