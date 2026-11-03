import type { AdbDaemonConnection } from "@yume-chan/adb";

/**
 * Anything MK-DEX can talk ADB to: a phone on USB (WebUSB / MkUsb)
 * or a phone on Wi-Fi (MkTcp). DexSession doesn't care which.
 */
export interface PhoneLink {
  readonly serial: string;
  readonly name: string | undefined;
  /** "usb" or "wifi" — only used for log/UI wording. */
  readonly kind: "usb" | "wifi";
  connect(): Promise<AdbDaemonConnection>;
}
