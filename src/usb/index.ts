import { Capacitor } from "@capacitor/core";
import {
  AdbDaemonWebUsbDevice,
  AdbDaemonWebUsbDeviceManager,
} from "@yume-chan/adb-daemon-webusb";
import { NativeUsb } from "./native-usb";

export type UsbBackend = "webusb" | "native" | "none";

let native: NativeUsb | undefined;

export function usbBackend(): UsbBackend {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") return "native";
  if (typeof navigator !== "undefined" && "usb" in navigator) return "webusb";
  return "none";
}

/**
 * Ask the user to pick the DeX phone.
 * Browser: Chrome's WebUSB chooser. APK: Android's USB permission dialog.
 */
export async function pickPhone(): Promise<AdbDaemonWebUsbDevice | undefined> {
  switch (usbBackend()) {
    case "webusb":
      return AdbDaemonWebUsbDeviceManager.BROWSER!.requestDevice();
    case "native": {
      native ??= new NativeUsb();
      const info = await native.requestAdbDevice();
      if (!info) return undefined;
      const manager = new AdbDaemonWebUsbDeviceManager(native as unknown as USB);
      const devices = await manager.getDevices();
      return devices.find((d) => (d.raw as unknown as { deviceId: number }).deviceId === info.deviceId) ?? devices[0];
    }
    default:
      throw new Error("No USB access here. Use Chrome/Edge on desktop or Android, or the MK-DEX Android app.");
  }
}

export { AdbDaemonWebUsbDevice };
